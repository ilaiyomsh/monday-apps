// Admin API (spec §9) — the ONLY place the secret is readable, always behind
// the sessionToken middleware. Board/column pickers do NOT go through here
// (the admin SPA calls monday.api() client-side with seamless auth).

import express from 'express';
import { generateSecret, maskSecret } from '../services/secret.js';
import { renderSnippet } from '../helpers/snippet.js';
import { logError } from '../helpers/logger.js';

function firstInvalidField(body) {
  if (typeof body !== 'object' || body === null) return 'body';
  if (typeof body.boardId !== 'string' || !/^\d+$/.test(body.boardId)) return 'boardId';
  if (typeof body.statusColumnId !== 'string' || body.statusColumnId.length === 0) return 'statusColumnId';
  if (!Number.isInteger(body.fromIndex) || body.fromIndex < 0) return 'fromIndex';
  if (!Number.isInteger(body.toIndex) || body.toIndex < 0) return 'toIndex';
  if (body.fromIndex === body.toIndex) return 'toIndex';
  if (typeof body.fromLabel !== 'string' || body.fromLabel.length === 0) return 'fromLabel';
  if (typeof body.toLabel !== 'string' || body.toLabel.length === 0) return 'toLabel';
  if (body.peopleColumnId !== null && body.peopleColumnId !== undefined &&
      (typeof body.peopleColumnId !== 'string' || body.peopleColumnId.length === 0)) return 'peopleColumnId';
  if (body.expiryDateColumnId !== null && body.expiryDateColumnId !== undefined &&
      (typeof body.expiryDateColumnId !== 'string' || body.expiryDateColumnId.length === 0)) return 'expiryDateColumnId';
  const grace = body.expiryGraceDays ?? 0;
  if (!Number.isInteger(grace) || grace < 0) return 'expiryGraceDays';
  return null;
}

/**
 * Build the /api router (all routes behind the injected session middleware).
 * Behavioral contract: stub JSDoc (git history) + tests/admin-api.test.js.
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ baseUrl: string }} deps.env
 * @param {import('express').RequestHandler} deps.requireSession
 * @returns {import('express').Router}
 */
export function createAdminRouter({ storage, api, env, requireSession }) {
  const router = express.Router();
  router.use('/api', requireSession);

  function guarded(handler) {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        logError('admin_api', 'handler failed', {
          path: req.path,
          error: String(err?.message ?? err),
        });
        res.status(500).json({ error: 'internal_error' });
      }
    };
  }

  router.get(
    '/api/state',
    guarded(async (_req, res) => {
      const [config, linkSecret, token] = await Promise.all([
        storage.getConfig(),
        storage.getLinkSecret(),
        storage.getOauthToken(),
      ]);

      let oauth;
      if (!token) {
        oauth = { status: 'disconnected' };
      } else {
        try {
          const me = await api.fetchMe({ token });
          oauth = { status: 'connected', name: me.name };
        } catch (err) {
          // No refresh tokens exist — ANY failure here means reconnect (§8).
          logError('admin_api', 'oauth liveness probe failed', {
            error: String(err?.message ?? err),
          });
          oauth = { status: 'broken' };
        }
      }

      res.json({ config, secret: maskSecret(linkSecret), oauth, baseUrl: env.baseUrl });
    })
  );

  router.put(
    '/api/config',
    guarded(async (req, res) => {
      const body = req.body;
      const invalidField = firstInvalidField(body);
      if (invalidField) {
        res.status(400).json({ error: 'invalid_config', field: invalidField });
        return;
      }

      await storage.setConfig({
        boardId: body.boardId,
        statusColumnId: body.statusColumnId,
        fromIndex: body.fromIndex,
        fromLabel: body.fromLabel,
        toIndex: body.toIndex,
        toLabel: body.toLabel,
        peopleColumnId: body.peopleColumnId ?? null,
        expiryDateColumnId: body.expiryDateColumnId ?? null,
        expiryGraceDays: body.expiryGraceDays ?? 0,
      });
      res.json({ ok: true });
    })
  );

  router.post(
    '/api/secret/rotate',
    guarded(async (_req, res) => {
      const secret = generateSecret();
      await storage.setLinkSecret(secret);
      // Returned in FULL exactly once — the admin view regenerates the snippet.
      res.json({ secret });
    })
  );

  router.get(
    '/api/snippet',
    guarded(async (_req, res) => {
      const secret = await storage.getLinkSecret();
      if (!secret) {
        res.status(409).json({ error: 'no_secret' });
        return;
      }
      res.json({ snippet: renderSnippet({ baseUrl: env.baseUrl, secret }) });
    })
  );

  return router;
}

// Admin API v2 — the ONLY place the secret is readable, always behind the
// sessionToken middleware. Board/column pickers stay client-side
// (monday.api() seamless auth).
//
// v2 config contract (PUT /api/config), validated field-by-field — respond
// 400 { error: 'invalid_config', field } naming the FIRST offending field:
// - boardId: digits string (required)
// - peopleColumnId: non-empty string or null
// - buttons: array 1..20, each:
//     id: /^b_[A-Za-z0-9_-]{4,16}$/ — client MAY pre-generate; when absent
//         the SERVER generates one; duplicates → 400 (field 'buttons')
//     name: string 1..40
//     statusColumnId: non-empty string
//     targetIndex: integer >= 0 (0 is a valid label id)
//     targetLabel: string 1..40
//     style: { color: /^#[0-9a-fA-F]{6}$/, icon: string 0..4 chars
//              (optional, default ''), size: 'sm'|'md'|'lg' }
// - templates: array 0..10, each:
//     id: /^t_[A-Za-z0-9_-]{4,16}$/ (server-generated when absent; dupes → 400)
//     name: string 1..40
//     blocks: array 1..30 of either
//       { type:'text', text: string 1..5000, direction:'rtl'|'ltr',
//         font: ALLOWED_FONTS (email-template.js), fontSize: int 10..32,
//         align:'right'|'center'|'left' }
//       { type:'buttons', buttonIds: non-empty array of ids that exist in
//         buttons (after generation) }
// Valid → storage.setConfig(normalized) → 200 { ok: true, config } (the
// normalized config INCLUDING generated ids — the client re-syncs from it).
//
// GET /api/snippet?btn=<id>   → 200 {snippet}; 400 missing btn; 409 no
//                               secret; 404 unknown button
// GET /api/email-template?tpl=<id> → 200 {html} (renderEmailTemplate); same
//                               400/409/404 semantics (404 unknown template)
// GET /api/state + POST /api/secret/rotate — unchanged from v1.

import crypto from 'node:crypto';
import express from 'express';
import { generateSecret, maskSecret } from '../services/secret.js';
import { renderSnippet } from '../helpers/snippet.js';
import { renderEmailTemplate, ALLOWED_FONTS } from '../helpers/email-template.js';
import { logError } from '../helpers/logger.js';

const BUTTON_ID_RE = /^b_[A-Za-z0-9_-]{4,16}$/;
const TEMPLATE_ID_RE = /^t_[A-Za-z0-9_-]{4,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').slice(0, 8)}`;
}

const isNonEmptyString = (v, max = Infinity) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Validate + normalize the v2 config. Returns { field } on the FIRST
 * violation (nested style fields named 'style.<key>'; array-level problems
 * named 'buttons'/'templates') or { config } with server-generated ids and
 * normalized defaults.
 */
function validateConfig(body) {
  if (typeof body !== 'object' || body === null) return { field: 'body' };
  if (typeof body.boardId !== 'string' || !/^\d+$/.test(body.boardId)) return { field: 'boardId' };
  if (body.peopleColumnId !== null && body.peopleColumnId !== undefined && !isNonEmptyString(body.peopleColumnId)) {
    return { field: 'peopleColumnId' };
  }

  if (!Array.isArray(body.buttons) || body.buttons.length < 1 || body.buttons.length > 20) {
    return { field: 'buttons' };
  }
  const buttons = [];
  for (const raw of body.buttons) {
    if (typeof raw !== 'object' || raw === null) return { field: 'buttons' };
    if (raw.id !== undefined && !(typeof raw.id === 'string' && BUTTON_ID_RE.test(raw.id))) {
      return { field: 'id' };
    }
    if (!isNonEmptyString(raw.name, 40)) return { field: 'name' };
    if (!isNonEmptyString(raw.statusColumnId)) return { field: 'statusColumnId' };
    if (!Number.isInteger(raw.targetIndex) || raw.targetIndex < 0) return { field: 'targetIndex' };
    if (!isNonEmptyString(raw.targetLabel, 40)) return { field: 'targetLabel' };
    const style = raw.style;
    if (typeof style !== 'object' || style === null || typeof style.color !== 'string' || !COLOR_RE.test(style.color)) {
      return { field: 'style.color' };
    }
    const icon = style.icon ?? '';
    if (typeof icon !== 'string' || icon.length > 4) return { field: 'style.icon' };
    if (!['sm', 'md', 'lg'].includes(style.size)) return { field: 'style.size' };
    buttons.push({
      id: raw.id ?? generateId('b'),
      name: raw.name,
      statusColumnId: raw.statusColumnId,
      targetIndex: raw.targetIndex,
      targetLabel: raw.targetLabel,
      style: { color: style.color, icon, size: style.size },
    });
  }
  if (new Set(buttons.map((b) => b.id)).size !== buttons.length) return { field: 'buttons' };
  const buttonIds = new Set(buttons.map((b) => b.id));

  const rawTemplates = body.templates ?? [];
  if (!Array.isArray(rawTemplates) || rawTemplates.length > 10) return { field: 'templates' };
  const templates = [];
  for (const raw of rawTemplates) {
    if (typeof raw !== 'object' || raw === null) return { field: 'templates' };
    if (raw.id !== undefined && !(typeof raw.id === 'string' && TEMPLATE_ID_RE.test(raw.id))) {
      return { field: 'id' };
    }
    if (!isNonEmptyString(raw.name, 40)) return { field: 'name' };
    if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 30) {
      return { field: 'blocks' };
    }
    const blocks = [];
    for (const block of raw.blocks) {
      if (typeof block !== 'object' || block === null) return { field: 'blocks' };
      if (block.type === 'text') {
        if (!isNonEmptyString(block.text, 5000)) return { field: 'text' };
        if (!['rtl', 'ltr'].includes(block.direction)) return { field: 'direction' };
        if (!ALLOWED_FONTS.includes(block.font)) return { field: 'font' };
        if (!Number.isInteger(block.fontSize) || block.fontSize < 10 || block.fontSize > 32) {
          return { field: 'fontSize' };
        }
        if (!['right', 'center', 'left'].includes(block.align)) return { field: 'align' };
        blocks.push({
          type: 'text',
          text: block.text,
          direction: block.direction,
          font: block.font,
          fontSize: block.fontSize,
          align: block.align,
        });
      } else if (block.type === 'buttons') {
        if (!Array.isArray(block.buttonIds) || block.buttonIds.length < 1) {
          return { field: 'buttonIds' };
        }
        if (!block.buttonIds.every((id) => buttonIds.has(id))) return { field: 'buttonIds' };
        blocks.push({ type: 'buttons', buttonIds: [...block.buttonIds] });
      } else {
        return { field: 'blocks' };
      }
    }
    templates.push({ id: raw.id ?? generateId('t'), name: raw.name, blocks });
  }
  if (new Set(templates.map((t) => t.id)).size !== templates.length) return { field: 'templates' };

  return {
    config: {
      boardId: body.boardId,
      peopleColumnId: body.peopleColumnId ?? null,
      buttons,
      templates,
    },
  };
}

/**
 * Build the /api router (all routes behind the injected session middleware).
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
    guarded(async (req, res) => {
      const scoped = storage.forAccount(req.session.accountId);
      const [config, linkSecret, token] = await Promise.all([
        scoped.getConfig(),
        scoped.getLinkSecret(),
        scoped.getOauthToken(),
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
      const result = validateConfig(req.body);
      if (result.field) {
        res.status(400).json({ error: 'invalid_config', field: result.field });
        return;
      }
      await storage.forAccount(req.session.accountId).setConfig(result.config);
      // The normalized config (incl. generated ids) — the client re-syncs from it.
      res.json({ ok: true, config: result.config });
    })
  );

  router.post(
    '/api/secret/rotate',
    guarded(async (req, res) => {
      const secret = generateSecret();
      await storage.forAccount(req.session.accountId).setLinkSecret(secret);
      // Returned in FULL exactly once — the admin view regenerates snippets.
      res.json({ secret });
    })
  );

  router.get(
    '/api/snippet',
    guarded(async (req, res) => {
      const btnId = req.query.btn;
      if (typeof btnId !== 'string' || btnId.length === 0) {
        res.status(400).json({ error: 'missing_btn' });
        return;
      }
      const scoped = storage.forAccount(req.session.accountId);
      const secret = await scoped.getLinkSecret();
      if (!secret) {
        res.status(409).json({ error: 'no_secret' });
        return;
      }
      const config = await scoped.getConfig();
      const button = config?.buttons?.find((b) => b.id === btnId) ?? null;
      if (!button) {
        res.status(404).json({ error: 'unknown_button' });
        return;
      }
      res.json({
        snippet: renderSnippet({ baseUrl: env.baseUrl, secret, button, accountId: req.session.accountId }),
      });
    })
  );

  router.get(
    '/api/email-template',
    guarded(async (req, res) => {
      const tplId = req.query.tpl;
      if (typeof tplId !== 'string' || tplId.length === 0) {
        res.status(400).json({ error: 'missing_tpl' });
        return;
      }
      const scoped = storage.forAccount(req.session.accountId);
      const secret = await scoped.getLinkSecret();
      if (!secret) {
        res.status(409).json({ error: 'no_secret' });
        return;
      }
      const config = await scoped.getConfig();
      const template = config?.templates?.find((t) => t.id === tplId) ?? null;
      if (!template) {
        res.status(404).json({ error: 'unknown_template' });
        return;
      }
      res.json({
        html: renderEmailTemplate({
          baseUrl: env.baseUrl,
          secret,
          template,
          buttons: config?.buttons ?? [],
          accountId: req.session.accountId,
        }),
      });
    })
  );

  return router;
}

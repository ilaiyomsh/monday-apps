/**
 * guard-routes — the guard's HTTP surface (DI factory, mounted by app.js).
 *
 * POST /api/guard/webhook?account=<accountId>
 *   monday's webhook delivery endpoint — see routes/guard-webhook.js, mounted
 *   below as this router's first statement.
 *
 * POST /api/guard/enroll   { boardId, columnId }
 *   Called by the settings screen after a save. Authorization: monday
 *   sessionToken (client secret). Verdict order: 401 → 409 not_activated →
 *   403 not_board_owner → 200 (idempotent: an existing enrollment answers
 *   without a second create). Owner = user owner ∪ owning-team member — the
 *   same rule the settings gate uses client-side, enforced server-side here.
 *
 * GET /api/guard/status?boardId&columnId — sessionToken-auth'd probe for the
 *   settings screen: { activated, enrolled }.
 */

import express from 'express';
import { normalizeOwners } from '../../../src/domain/columnOwners.js';
import { verifySessionToken } from '../middlewares/auth.js';
import { createWebhookRouter } from './guard-webhook.js';

const TAG = 'guard-routes';

export function createGuardRouter({ handleEvent, tokenStore, enrollmentStore, rulesStore, bypassLog, api, env, logger }) {
  const router = express.Router();

  router.use(createWebhookRouter({ handleEvent, env, logger }));

  const requireSession = (req, res) => {
    const session = verifySessionToken(req.get('authorization'), env.clientSecret, logger);
    if (!session) res.status(401).json({ error: 'unauthorized' });
    return session;
  };

  // Answers 409 itself and returns a falsy reader, so every caller must
  // `if (!reader) return;` — /api/guard/status deliberately does NOT use this (it
  // answers 200 with an all-false body instead; see the comment there).
  const requireReader = async (accountId, res) => {
    const reader = await tokenStore.getReaderToken(accountId);
    if (!reader) res.status(409).json({ error: 'not_activated' });
    return reader;
  };

  const isBoardOwner = async (token, boardId, userId) => {
    const { ownerIds, teamOwnerIds } = await api.getBoardOwnership(token, boardId);
    if (ownerIds.includes(String(userId))) return true;
    if (teamOwnerIds.length === 0) return false;
    const userTeamIds = await api.getUserTeamIds(token, userId);
    return userTeamIds.some((teamId) => teamOwnerIds.includes(String(teamId)));
  };

  router.post('/api/guard/enroll', async (req, res) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;
      const boardId = String(req.body?.boardId ?? '').trim();
      const columnId = String(req.body?.columnId ?? '').trim();
      if (boardId === '' || columnId === '') {
        res.status(400).json({ error: 'bad_request' });
        return;
      }

      const reader = await requireReader(session.accountId, res);
      if (!reader) return;
      if (!(await isBoardOwner(reader.token, boardId, session.userId))) {
        res.status(403).json({ error: 'not_board_owner' });
        return;
      }

      const existing = await enrollmentStore.get(session.accountId, boardId, columnId);
      if (existing) {
        res.status(200).json({ ok: true, webhookId: existing });
        return;
      }

      const url = `${env.baseUrl}/api/guard/webhook?account=${encodeURIComponent(session.accountId)}`;
      const webhookId = await api.createColumnWebhook(reader.token, boardId, columnId, url);
      await enrollmentStore.set(session.accountId, boardId, columnId, webhookId);
      logger.info('column enrolled', TAG, { accountId: session.accountId, boardId, columnId, webhookId });
      res.status(200).json({ ok: true, webhookId });
    } catch (err) {
      logger.error(`enroll failed: ${String(err?.message ?? err)}`, TAG, { error: String(err?.message ?? err) });
      res.status(502).json({ error: 'enroll_failed' });
    }
  });

  // The monitor's data: bypass events for a column in a date window. Owner-only
  // (a listed COLUMN owner — the same authority the settings screen enforces).
  router.get('/api/guard/bypasses', async (req, res) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;
      const boardId = String(req.query.boardId ?? '').trim();
      const columnId = String(req.query.columnId ?? '').trim();
      const fromMs = Number(req.query.from);
      const toMs = Number(req.query.to);
      if (boardId === '' || columnId === '' || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        res.status(400).json({ error: 'bad_request' });
        return;
      }

      const reader = await requireReader(session.accountId, res);
      if (!reader) return;
      // Authorize against the column's own owner list (read from the rules blob).
      const rules = await rulesStore.getRules(reader.token, boardId, columnId);
      const owners = normalizeOwners(rules?.owners);
      if (!owners || !owners.ownerIds.includes(String(session.userId))) {
        res.status(403).json({ error: 'not_column_owner' });
        return;
      }

      const events = await bypassLog.queryRange(session.accountId, boardId, columnId, fromMs, toMs);
      res.status(200).json({ count: events.length, events });
    } catch (err) {
      logger.error(`bypasses query failed: ${String(err?.message ?? err)}`, TAG, { error: String(err?.message ?? err) });
      res.status(502).json({ error: 'bypasses_failed' });
    }
  });

  router.get('/api/guard/status', async (req, res) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;
      const boardId = String(req.query.boardId ?? '').trim();
      const columnId = String(req.query.columnId ?? '').trim();

      const reader = await tokenStore.getReaderToken(session.accountId);
      if (!reader) {
        // No reader ⇒ no owner anywhere has authorized, the requester included.
        res.status(200).json({ activated: false, enrolled: false, primaryAuthorized: false, meAuthorized: false });
        return;
      }
      let enrolled = false;
      // round327 — `activated` is ACCOUNT-level (any owner authorized), but reverts
      // are written with the COLUMN's primary owner's token. Report that owner's
      // authorization specifically, so the settings line cannot say "connected"
      // while the guard would skip every revert. null = unknowable (no rules /
      // no owners yet — a fresh column bootstraps the current user as primary).
      let primaryAuthorized = null;
      if (boardId !== '' && columnId !== '') {
        enrolled = (await enrollmentStore.get(session.accountId, boardId, columnId)) != null;
        const rules = await rulesStore.getRules(reader.token, boardId, columnId);
        const owners = normalizeOwners(rules?.owners);
        if (owners?.primaryOwnerId != null) {
          primaryAuthorized = (await tokenStore.getOwnerToken(session.accountId, String(owners.primaryOwnerId))) != null;
        }
      }
      // round327 review (Codex P2) — the settings line renders only when the
      // DRAFT primary owner is the requesting user, and a draft crowning is not
      // saved yet, so `primaryAuthorized` (the STORED primary) can be stale for
      // it. "Is the REQUESTER authorized" is the exact question that line asks,
      // and it is column-independent.
      const meAuthorized = (await tokenStore.getOwnerToken(session.accountId, String(session.userId))) != null;
      res.status(200).json({ activated: true, enrolled, primaryAuthorized, meAuthorized });
    } catch (err) {
      logger.error(`status probe failed: ${String(err?.message ?? err)}`, TAG, { error: String(err?.message ?? err) });
      res.status(502).json({ error: 'status_failed' });
    }
  });

  return router;
}

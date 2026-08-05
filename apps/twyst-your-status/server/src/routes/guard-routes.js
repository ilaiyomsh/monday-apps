/**
 * guard-routes — the guard's HTTP surface (DI factory, mounted by app.js).
 *
 * POST /api/guard/webhook?account=<accountId>
 *   monday's webhook delivery endpoint. Response policy (fail-soft,
 *   retry-storm safe — telemetry-dashboard's proven shape):
 *     { challenge } handshake → 200 echo BEFORE auth (the only unauth'd path);
 *     bad/missing JWT         → 401 (fail-closed; ALLOW_UNSIGNED_WEBHOOKS=true
 *                               env escape for sandbox bring-up, wired HERE so
 *                               the exception is visible in one place);
 *     missing ?account / body → 400;
 *     authenticated           → 202 { ok: true } IMMEDIATELY, then the handler
 *                               runs off-request via setImmediate — monday never
 *                               waits on board IO and never sees a 5xx.
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
import { verifySessionToken, verifyWebhookJwt } from '../middlewares/auth.js';

const TAG = 'guard-routes';

export function createGuardRouter({ handleEvent, tokenStore, enrollmentStore, rulesStore, bypassLog, api, env, logger }) {
  const router = express.Router();

  router.post('/api/guard/webhook', (req, res) => {
    // Developer registration handshake — echoed before auth, by contract.
    if (typeof req.body?.challenge === 'string') {
      res.status(200).json({ challenge: req.body.challenge });
      return;
    }

    const verified = env.allowUnsignedWebhooks
      ? {}
      : verifyWebhookJwt(req.get('authorization'), env.signingSecret, logger);
    if (!verified) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const accountId = typeof req.query.account === 'string' ? req.query.account.trim() : '';
    const event = req.body?.event;
    if (accountId === '' || !event || typeof event !== 'object') {
      res.status(400).json({ error: 'bad_request' });
      return;
    }

    // Trace the delivery entering the guard — one greppable line per status
    // change, so the change→verdict→revert path is followable in `code:logs`.
    logger.info(
      `webhook received board=${event.boardId} col=${event.columnId} item=${event.pulseId} actor=${event.userId}`,
      TAG,
      { accountId, boardId: String(event.boardId), columnId: String(event.columnId) },
    );
    // Ack first — monday must never wait on board IO, and must never receive
    // a retry-storm-inducing 5xx after auth.
    res.status(202).json({ ok: true });
    setImmediate(() => {
      Promise.resolve(handleEvent({
        accountId,
        userId: event.userId,
        boardId: event.boardId,
        pulseId: event.pulseId,
        pulseName: event.pulseName,
        columnId: event.columnId,
        value: event.value ?? null,
        previousValue: event.previousValue ?? null,
        // `pulseName`/`app` ride the change_status_column_value payload — item
        // name for the record, app for the honest api-vs-native surface guess.
        itemName: event.pulseName ?? '',
        app: event.app,
      })).catch((err) => {
        // handleEvent is fail-soft by contract; this is the last-resort funnel
        // so a rejection can never become an unhandledRejection.
        logger.error(`webhook dispatch failed: ${String(err?.message ?? err)}`, TAG, {
          accountId,
          boardId: String(event.boardId),
          error: String(err?.message ?? err),
        });
      });
    });
  });

  const requireSession = (req, res) => {
    const session = verifySessionToken(req.get('authorization'), env.clientSecret, logger);
    if (!session) res.status(401).json({ error: 'unauthorized' });
    return session;
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

      const reader = await tokenStore.getReaderToken(session.accountId);
      if (!reader) {
        res.status(409).json({ error: 'not_activated' });
        return;
      }
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

      const reader = await tokenStore.getReaderToken(session.accountId);
      if (!reader) {
        res.status(409).json({ error: 'not_activated' });
        return;
      }
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

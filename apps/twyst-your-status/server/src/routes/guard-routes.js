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
import { verifySessionToken, verifyWebhookJwt } from '../middlewares/auth.js';

const TAG = 'guard-routes';

export function createGuardRouter({ handleEvent, tokenStore, enrollmentStore, api, env, logger }) {
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

    // Ack first — monday must never wait on board IO, and must never receive
    // a retry-storm-inducing 5xx after auth.
    res.status(202).json({ ok: true });
    setImmediate(() => {
      Promise.resolve(handleEvent({
        accountId,
        userId: event.userId,
        boardId: event.boardId,
        pulseId: event.pulseId,
        columnId: event.columnId,
        value: event.value ?? null,
        previousValue: event.previousValue ?? null,
      })).catch((err) => {
        // handleEvent is fail-soft by contract; this is the last-resort funnel
        // so a rejection can never become an unhandledRejection.
        logger.error('webhook dispatch failed', TAG, {
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

      const activation = await tokenStore.getActivation(session.accountId);
      if (!activation) {
        res.status(409).json({ error: 'not_activated' });
        return;
      }
      if (!(await isBoardOwner(activation.token, boardId, session.userId))) {
        res.status(403).json({ error: 'not_board_owner' });
        return;
      }

      const existing = await enrollmentStore.get(session.accountId, boardId, columnId);
      if (existing) {
        res.status(200).json({ ok: true, webhookId: existing });
        return;
      }

      const url = `${env.baseUrl}/api/guard/webhook?account=${encodeURIComponent(session.accountId)}`;
      const webhookId = await api.createColumnWebhook(activation.token, boardId, columnId, url);
      await enrollmentStore.set(session.accountId, boardId, columnId, webhookId);
      logger.info('column enrolled', TAG, { accountId: session.accountId, boardId, columnId, webhookId });
      res.status(200).json({ ok: true, webhookId });
    } catch (err) {
      logger.error('enroll failed', TAG, { error: String(err?.message ?? err) });
      res.status(502).json({ error: 'enroll_failed' });
    }
  });

  router.get('/api/guard/status', async (req, res) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;
      const boardId = String(req.query.boardId ?? '').trim();
      const columnId = String(req.query.columnId ?? '').trim();

      const activation = await tokenStore.getActivation(session.accountId);
      if (!activation) {
        res.status(200).json({ activated: false, enrolled: false });
        return;
      }
      const enrolled = boardId !== '' && columnId !== ''
        ? (await enrollmentStore.get(session.accountId, boardId, columnId)) != null
        : false;
      res.status(200).json({ activated: true, enrolled });
    } catch (err) {
      logger.error('status probe failed', TAG, { error: String(err?.message ?? err) });
      res.status(502).json({ error: 'status_failed' });
    }
  });

  return router;
}

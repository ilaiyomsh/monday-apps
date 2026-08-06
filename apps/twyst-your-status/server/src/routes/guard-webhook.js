/**
 * guard-webhook — the guard's webhook surface (DI factory, mounted FIRST by
 * guard-routes so path resolution order is unchanged).
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
 */

import express from 'express';
import { verifyWebhookJwt } from '../middlewares/auth.js';

// Unchanged on purpose: these lines are the same greppable delivery trace in
// `code:logs` as before this route moved out of guard-routes.js.
const TAG = 'guard-routes';

export function createWebhookRouter({ handleEvent, env, logger }) {
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

  return router;
}

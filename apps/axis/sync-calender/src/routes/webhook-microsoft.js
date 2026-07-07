// Microsoft Graph push-notification webhook for the Custom Object path.
// Two distinct payload shapes share this endpoint:
//
//   1. Subscription validation handshake (one-shot, fires when we create or
//      renew a subscription): POST with ?validationToken=<token> in the URL,
//      empty body. We must respond within 10 seconds:
//        - status: 200
//        - Content-Type: text/plain
//        - body: the raw URL-decoded token
//
//   2. Notification (every change to me/events): JSON body
//        { value: [{ subscriptionId, clientState, changeType,
//                    resource, resourceData: { id }, ... }] }
//      We validate clientState matches the expected `microsoft:<configId>`
//      shape (defense against spoofed callers) and dispatch to the shared
//      runWebhookSync — which loads the config + policy and calls the
//      sync-engine. Always 200 (Graph marks endpoints unhealthy on 5xx).

import express from 'express';
import { isMicrosoftEnabled } from '../services/provider.js';
import { runWebhookSync } from './webhook-config.js';
import logger, { shortId } from '../services/logger.js';

const TAG = 'webhook';
const router = express.Router();

const CLIENT_STATE_PREFIX = 'microsoft:';

// Parse `microsoft:<configId>` → configId. Returns null on mismatch (defends
// against spoofed payloads or stale subscriptions from a previous deploy).
function parseClientState(clientState) {
  if (typeof clientState !== 'string') return null;
  if (!clientState.startsWith(CLIENT_STATE_PREFIX)) return null;
  const configId = clientState.slice(CLIENT_STATE_PREFIX.length);
  return configId || null;
}

router.post('/webhook/microsoft', async (req, res) => {
  // Disabled-flag mode: refuse late-arriving notifications cleanly. If the
  // env vars get removed after a deploy, Graph might still send us a few
  // notifications before the stored subscription expires.
  if (!isMicrosoftEnabled()) {
    logger.warn('microsoft_disabled', TAG, { prv: 'microsoft' });
    return res.status(410).end();
  }

  // Validation handshake: respond with the raw token. Microsoft sends this
  // synchronously when we POST /subscriptions, and the create call fails if
  // we don't respond within 10s.
  if (typeof req.query.validationToken === 'string' && req.query.validationToken.length > 0) {
    logger.debug('handshake', TAG, { prv: 'microsoft' });
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(req.query.validationToken);
  }

  // Notification batch. Always ACK 200 — failures are logged and surfaced
  // via syncConfig.lastError + status, but Graph marks endpoints unhealthy
  // on 5xx so we never propagate downstream errors as HTTP failures.
  try {
    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];

    // Group by configId so we trigger at most one sync per config per batch.
    const configIds = new Set();
    let unknown = 0;
    for (const n of notifications) {
      const configId = parseClientState(n?.clientState);
      if (!configId) { unknown++; continue; }
      configIds.add(configId);
    }
    if (unknown > 0) {
      logger.warn('unknown_clientState', TAG, { prv: 'microsoft', unknown });
    }

    if (configIds.size === 0) return res.status(200).end();

    // Per-configId received trace at DEBUG; the canonical INFO line is the
    // sync_done (trigger=webhook) emitted by runSyncForConfig, which joins on
    // `cfg` and carries both arrival and outcome.
    for (const configId of configIds) {
      logger.debug('webhook_received', TAG, { cfg: shortId(configId), prv: 'microsoft' });
    }

    // Fire syncs sequentially — Graph batches multiple changes into one POST.
    for (const configId of configIds) {
      try {
        await runWebhookSync({ configId });
      } catch (err) {
        logger.error('error', TAG, {
          cfg: shortId(configId),
          prv: 'microsoft',
          stage: 'webhook_sync',
          cause: err.message,
        });
      }
    }

    return res.status(200).end();
  } catch (err) {
    logger.error('error', TAG, { prv: 'microsoft', stage: 'webhook', cause: err.message });
    return res.status(200).end();
  }
});

export default router;

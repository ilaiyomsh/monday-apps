// Handler for Google push notifications on the Custom Object path. Invoked
// from routes/webhook.js when x-goog-channel-token starts with 'config_'.
// Returns 200 on ALL failure modes — Google does not want 5xx responses
// (they mark the channel unhealthy). Error detail goes to logs and the
// config's lastError field.
//
// Microsoft notifications are handled by routes/webhook-microsoft.js (Phase 2)
// which calls runWebhookSync below for the shared sync flow.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { runSyncForConfig } from '../services/sync-engine.js';
import {
  classifyError,
  reasonForStatus,
  maybeNotifyOwner,
  maybeNotifyAffectedUser,
} from '../services/sync-status.js';
import logger, { shortId } from '../services/logger.js';
import { buildSyncCtx, buildAccountCtx } from '../helpers/log-context.js';

const TAG = 'webhook';

// Google sends an initial `sync` notification right after channel creation
// that contains no event data — we must ACK it and move on without syncing.
function isHandshake(req) {
  const state = req.headers['x-goog-resource-state'];
  return state === 'sync';
}

// Per-config in-flight mutex. Microsoft Graph (and occasionally Google) can
// fire multiple webhooks for the same configId in close succession; without
// this they run in parallel and race on the delta token + the link-column
// existence check, which yields duplicate item creates. Serializing per
// configId means concurrent webhooks queue up and the second run sees the
// item the first run just wrote.
const inflightSyncs = new Map();

// Map a structured monday-api error sample to a specific notification reason.
// Returns { reason } when the error is actionable (or `unknown` as a fallback),
// or { reason: null } for transient errors (rate limits, race conditions on
// concurrent updates) — those should never wake the owner.
function classifyEventError({ code, msg }) {
  const m = msg || '';
  if (code === 'ResourceNotFoundException') {
    if (/column/i.test(m)) return { reason: 'event_errors:column_missing' };
    if (/board/i.test(m))  return { reason: 'event_errors:board_missing' };
    if (/item not found/i.test(m)) return { reason: null };
    return { reason: 'event_errors:resource_missing' };
  }
  if (code === 'ColumnValueException' || code === 'CorrectedValueException') {
    return { reason: 'event_errors:bad_value' };
  }
  if (code === 'InvalidColumnIdException') return { reason: 'event_errors:column_invalid' };
  if (code === 'InvalidBoardIdException')  return { reason: 'event_errors:board_invalid' };
  if (code === 'InvalidUserIdException')   return { reason: 'event_errors:user_not_subscribed' };
  if (code === 'ItemsLimitationException') return { reason: 'event_errors:board_full' };
  if (code === 'UserUnauthorizedException' || code === 'USER_UNAUTHORIZED' || code === 'USER_ACCESS_DENIED') {
    return { reason: 'event_errors:permissions' };
  }
  if (code === 'missingRequiredPermissions' || code === 'UNAUTHORIZED_FIELD_OR_TYPE') {
    return { reason: 'event_errors:scope_missing' };
  }
  if (code === 'API_TEMPORARILY_BLOCKED') return { reason: 'event_errors:api_blocked' };
  if (code === 'COMPLEXITY_BUDGET_EXHAUSTED' ||
      code === 'maxConcurrencyExceeded' ||
      code === 'IP_RATE_LIMIT_EXCEEDED') {
    return { reason: null };
  }
  return { reason: 'event_errors:unknown' };
}

// Pick the dominant signature from a run's errorSamples and translate to a
// notification reason. Counts give us "most common cause" rather than first
// observed — useful when a run has one stale conditional rule + a few item
// races, and we want to surface the conditional issue.
function pickEventErrorReason(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { reason: 'event_errors:unknown', columnId: null };
  }
  const sorted = [...samples].sort((a, b) => (b.count || 0) - (a.count || 0));
  for (const s of sorted) {
    const { reason } = classifyEventError(s);
    if (reason) return { reason, columnId: s.columnId || null };
  }
  return { reason: null, columnId: null };
}

async function runWebhookSyncImpl({ configId }) {
  const config = await syncConfigStorage.getSyncConfig(configId);
  if (!config) {
    logger.warn('unknown_config', TAG, { cfg: shortId(configId) });
    return { ok: false, reason: 'unknown_config' };
  }

  const ctx = buildSyncCtx(config);
  const policy = await syncConfigStorage.getInstancePolicy(config.objectId);
  if (!policy) {
    logger.warn('policy_missing', TAG, ctx);
    await syncConfigStorage.updateSyncConfig(configId, { lastError: 'policy_missing' });
    return { ok: false, reason: 'policy_missing' };
  }

  const providerName = config.provider || 'google';

  try {
    const result = await runSyncForConfig({ config, policy, trigger: 'webhook' });
    if (result.counts?.errors > 0) {
      const { reason, columnId } = pickEventErrorReason(result.counts.errorSamples);
      await maybeNotifyOwner({
        config, policy, reason,
        errorCount: result.counts.errors,
        columnId,
        ctx,
        tag: TAG,
      });
    }
    // sync-engine emits the canonical sync_done summary; nothing to add here.
    return { ok: true, counts: result.counts };
  } catch (err) {
    const status = classifyError(err, providerName);
    await syncConfigStorage.updateSyncConfig(configId, {
      status,
      lastError: (err.message || '').slice(0, 500),
    });
    logger.error('error', TAG, {
      ...ctx,
      stage: err.stage || 'sync',
      status,
      cause: (err.message || '').slice(0, 200),
      errCode: err.code || null,
      errStatus: err.status || null,
      errBody: typeof err.body === 'string' ? err.body.slice(0, 500) : null,
      throwAt: (err.stack || '').split('\n')[1]?.trim() || null,
    });
    const reason = reasonForStatus(status);
    if (reason) {
      // Reload config so we honor the just-written lastError + see fresh
      // lastOwnerNotifiedAt fields.
      const fresh = (await syncConfigStorage.getSyncConfig(configId)) || config;
      await maybeNotifyOwner({ config: fresh, policy, reason, ctx, tag: TAG });
      // Also alert the affected user directly — they're the only one who can
      // reconnect their own account (no-op for non-disconnect reasons).
      await maybeNotifyAffectedUser({ config: fresh, status, ctx, tag: TAG });
    }
    return { ok: false, reason: 'sync_failed', status };
  }
}

export function runWebhookSync({ configId }) {
  const pending = inflightSyncs.get(configId);
  // Chain onto the existing run so a second webhook for the same config sees
  // the result of the first (link column lookup, syncToken). `.catch(() => {})`
  // swallows the prior run's error for the chain only — runWebhookSyncImpl
  // already classifies and persists its own errors.
  const next = (pending ? pending.catch(() => {}) : Promise.resolve())
    .then(() => runWebhookSyncImpl({ configId }))
    .finally(() => {
      if (inflightSyncs.get(configId) === next) inflightSyncs.delete(configId);
    });
  inflightSyncs.set(configId, next);
  return next;
}

export async function webhookConfigHandler(req, res) {
  const configId = req.headers['x-goog-channel-token'];
  const cfg = shortId(configId);

  if (isHandshake(req)) {
    logger.debug('handshake', TAG, { cfg, prv: 'google' });
    return res.status(200).end();
  }

  // We don't have full ctx until config is loaded; emit a minimal received
  // trace at DEBUG. The canonical INFO line is sync_done (trigger=webhook),
  // which carries both arrival and outcome — no need for a second INFO here.
  logger.debug('webhook_received', TAG, { cfg, prv: 'google' });

  try {
    await runWebhookSync({ configId });
    return res.status(200).end();
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({}),
      cfg,
      prv: 'google',
      stage: 'webhook',
      cause: err.message,
    });
    return res.status(200).end();
  }
}

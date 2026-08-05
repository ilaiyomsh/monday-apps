import express from 'express';
import crypto from 'crypto';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { runSyncForConfig } from '../services/sync-engine.js';
import { startBackfill, requestBackfillCancel } from '../services/backfill.js';
import { getProvider } from '../services/provider.js';
import { validateConditionals } from '../helpers/conditionals-validator.js';
import logger from '../services/logger.js';
import { buildSyncCtx, buildAccountCtx } from '../helpers/log-context.js';

const TAG = 'configs';
const router = express.Router();

function projectConfig(config) {
  return {
    configId: config.configId,
    accountId: config.accountId,
    objectId: config.objectId,
    userId: config.userId,
    workspaceId: config.workspaceId || null,
    provider: config.provider || null,
    googleUserEmail: config.googleUserEmail || null,
    microsoftUserEmail: config.microsoftUserEmail || null,
    hasGoogleConnection: Boolean(config.googleRefreshToken),
    hasMicrosoftConnection: Boolean(config.microsoftRefreshToken),
    hasMondayConnection: Boolean(config.mondayAccessToken),
    status: config.status || 'pending_connections',
    lastSyncAt: config.lastSyncAt || null,
    lastError: config.lastError || null,
    conditionals: Array.isArray(config.conditionals) ? config.conditionals : [],
    backfill: config.backfill || null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

// Shared row-owner guard for the self-service endpoints below.
async function loadRowOwnedByCaller(req, res) {
  const config = await syncConfigStorage.getSyncConfig(req.params.configId);
  if (!config) { res.status(404).json({ error: 'config_not_found' }); return null; }
  if (String(config.accountId) !== String(req.session.accountId)) {
    res.status(403).json({ error: 'account_mismatch' }); return null;
  }
  if (String(config.userId) !== String(req.session.userId)) {
    res.status(403).json({ error: 'not_row_owner' }); return null;
  }
  return config;
}

async function lazyCreateOwnConfig({ accountId, objectId, userId, workspaceId }) {
  const existingIds = await syncConfigStorage.getInstanceConfigs(objectId);
  const existing = [];
  for (const cid of existingIds) {
    const cfg = await syncConfigStorage.getSyncConfig(cid);
    if (cfg) existing.push(cfg);
  }

  const mine = existing.find(
    (c) => String(c.accountId) === String(accountId) && String(c.userId) === String(userId)
  );
  if (mine) return { rows: existing, created: false };

  const configId = `config_${crypto.randomUUID()}`;
  const now = Date.now();
  const newConfig = {
    configId,
    accountId, objectId, userId,
    workspaceId: workspaceId || null,
    mondayUserId: userId,
    // provider is set by the OAuth callback (oauth-google or oauth-microsoft)
    // once the user successfully connects. Null = not yet connected to any
    // calendar provider.
    provider: null,
    // Google fields — populated when connecting Gmail
    googleRefreshToken: null,
    googleAccessToken: null,
    googleAccessTokenExpiresAt: null,
    googleUserEmail: null,
    googleResourceId: null,
    googleWatchExpiration: null,
    googleSyncToken: null,
    // Microsoft fields — populated when connecting Outlook (Phase 1+)
    microsoftRefreshToken: null,
    microsoftAccessToken: null,
    microsoftTokenExpiresAt: null,
    microsoftUserEmail: null,
    microsoftUserId: null,
    microsoftSubscriptionId: null,
    microsoftSubscriptionExpiration: null,
    microsoftDeltaLink: null,
    mondayAccessToken: null,
    // Identity fields populated by oauth-monday on connect (and lazily by the
    // debug endpoint for older configs). Stored to keep logs and debug
    // responses readable without re-querying monday on every request.
    mondayUserName: null,
    mondayUserEmail: null,
    mondayAccountName: null,
    mondayAccountSlug: null,
    status: 'pending_connections',
    lastSyncAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await syncConfigStorage.setSyncConfig(configId, newConfig);
  await syncConfigStorage.addInstanceConfig(objectId, configId);
  await syncConfigStorage.addUserConfig(userId, configId);
  await syncConfigStorage.addAccountConfig(accountId, configId);
  existing.push(newConfig);
  return { rows: existing, created: true };
}

// GET /api/configs?objectId=<X>
// Lists all rows in the instance (filtered by caller's accountId as a
// defense-in-depth guard). Lazy-creates the caller's own row if missing.
router.get('/api/configs', sessionTokenMiddleware, async (req, res) => {
  try {
    const objectId = String(req.query.objectId || '');
    if (!objectId) return res.status(400).json({ error: 'missing_objectId' });

    const policy = await syncConfigStorage.getInstancePolicy(objectId);
    const workspaceId = policy?.workspaceId || null;

    const { rows } = await lazyCreateOwnConfig({
      accountId: req.session.accountId,
      objectId,
      userId: req.session.userId,
      workspaceId,
    });

    // Defense in depth — only return rows that match the caller's account.
    const sameAccount = rows.filter((c) => String(c.accountId) === String(req.session.accountId));
    return res.json({ rows: sameAccount.map(projectConfig) });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'list',
      cause: err.message,
    });
    return res.status(500).json({ error: 'configs_list_failed' });
  }
});

// PATCH /api/configs/:configId — row-owner-only, limited mutations.
// Currently supports { status: "paused" | "active" } to let the user pause
// their sync without disconnecting.
router.patch('/api/configs/:configId', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await syncConfigStorage.getSyncConfig(req.params.configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    if (String(config.userId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'not_row_owner' });
    }
    const patch = {};
    if (typeof req.body?.status === 'string') {
      if (['active', 'paused'].includes(req.body.status)) patch.status = req.body.status;
    }
    if (req.body?.conditionals !== undefined) {
      const result = validateConditionals(req.body.conditionals);
      if (!result.ok) {
        return res.status(400).json({
          error: 'invalid_conditionals',
          index: result.index,
          detail: result.error,
        });
      }
      patch.conditionals = req.body.conditionals;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'no_valid_fields' });
    const updated = await syncConfigStorage.updateSyncConfig(config.configId, patch);
    if (patch.conditionals !== undefined) {
      const rules = patch.conditionals;
      const overrideCount = rules.filter((c) => c?.action !== 'skip').length;
      const skipCount = rules.length - overrideCount;
      const columnsTouched = new Set();
      for (const r of rules) {
        for (const k of Object.keys(r?.values || {})) columnsTouched.add(k);
      }
      logger.info('conditionals_updated', TAG, {
        ...buildSyncCtx(config),
        count: rules.length,
        override: overrideCount,
        skip: skipCount,
        columnsTouched: columnsTouched.size,
      });
    }
    return res.json({ row: projectConfig(updated) });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'config_patch',
      cause: err.message,
    });
    return res.status(500).json({ error: 'config_patch_failed' });
  }
});

// DELETE /api/configs/:configId — row owner tears down their own row.
// Stops Google watch channel (best effort), removes from indexes, deletes config.
router.delete('/api/configs/:configId', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await syncConfigStorage.getSyncConfig(req.params.configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    if (String(config.userId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'not_row_owner' });
    }

    try {
      const provider = getProvider(config);
      await provider.stopSubscription(config);
    } catch (err) {
      logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
    }

    // Best-effort index cleanups: the row is being deleted regardless, so a
    // failed index prune must not abort the delete — but it is still logged so a
    // leaked index entry (which the cron would later flag as stale) is traceable.
    const pruneIndex = async (op, fn) => {
      try { await fn(); } catch (e) {
        logger.warn('index_cleanup_failed', TAG, { ...buildSyncCtx(config), op, cause: e?.message || String(e) });
      }
    };
    await pruneIndex('removeActiveConfig', () => syncConfigStorage.removeActiveConfig(config.configId));
    await pruneIndex('removeInstanceConfig', () => syncConfigStorage.removeInstanceConfig(config.objectId, config.configId));
    await pruneIndex('removeUserConfig', () => syncConfigStorage.removeUserConfig(config.userId, config.configId));
    await pruneIndex('removeAccountConfig', () => syncConfigStorage.removeAccountConfig(config.accountId, config.configId));
    await syncConfigStorage.deleteSyncConfig(config.configId);

    logger.info('row_deleted', TAG, buildSyncCtx(config));
    return res.json({ ok: true });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'config_delete',
      cause: err.message,
    });
    return res.status(500).json({ error: 'config_delete_failed' });
  }
});

// DELETE /api/configs/:configId/connection
// Disconnects the active calendar provider WITHOUT deleting the config row,
// so the user can pick the OTHER provider next. Stops the push subscription
// (best effort), wipes provider-specific tokens, clears row.provider.
router.delete('/api/configs/:configId/connection', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await syncConfigStorage.getSyncConfig(req.params.configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    if (String(config.userId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'not_row_owner' });
    }

    try {
      const provider = getProvider(config);
      await provider.stopSubscription(config);
    } catch (err) {
      logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
    }

    // Wipe per-provider tokens and watch state. Keep mondayAccessToken,
    // userId, accountId, conditionals — those survive a calendar swap.
    const wipe = config.provider === 'microsoft'
      ? {
          microsoftAccessToken: null,
          microsoftRefreshToken: null,
          microsoftTokenExpiresAt: null,
          microsoftUserEmail: null,
          microsoftUserId: null,
          microsoftSubscriptionId: null,
          microsoftSubscriptionExpiration: null,
          microsoftDeltaLink: null,
        }
      : {
          googleAccessToken: null,
          googleRefreshToken: null,
          googleAccessTokenExpiresAt: null,
          googleUserEmail: null,
          googleResourceId: null,
          googleWatchExpiration: null,
          googleSyncToken: null,
        };

    const updated = await syncConfigStorage.updateSyncConfig(config.configId, {
      provider: null,
      status: 'pending_connections',
      lastError: null,
      ...wipe,
    });
    try { await syncConfigStorage.removeActiveConfig(config.configId); } catch (e) {
      logger.warn('index_cleanup_failed', TAG, { ...buildSyncCtx(config), op: 'removeActiveConfig', cause: e?.message || String(e) });
    }

    logger.info('disconnected', TAG, buildSyncCtx(config));
    return res.json({ row: projectConfig(updated) });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'disconnect',
      cause: err.message,
    });
    return res.status(500).json({ error: 'disconnect_failed' });
  }
});

// POST /api/configs/:configId/force-sync
// Manual sync trigger — useful for testing and for recovery after a transient
// failure. Rate limits deliberately omitted here (keep simple in v1).
router.post('/api/configs/:configId/force-sync', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await syncConfigStorage.getSyncConfig(req.params.configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    if (String(config.userId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'not_row_owner' });
    }
    const policy = await syncConfigStorage.getInstancePolicy(config.objectId);
    if (!policy) {
      logger.warn('policy_missing', TAG, { ...buildSyncCtx(config), stage: 'force_sync' });
      return res.status(400).json({ error: 'policy_not_found', configObjectId: config.objectId });
    }

    try {
      const result = await runSyncForConfig({ config, policy, trigger: 'force_sync' });
      return res.json({ ok: true, result });
    } catch (err) {
      const msg = err.message || String(err);
      const providerName = config.provider || 'google';
      let status = 'active';
      const refreshFailed =
        msg === `${providerName}_refresh_token_missing` ||
        err.code === `${providerName}_refresh_token_missing` ||
        err.code === 'refresh_token_invalid' ||
        new RegExp(`${providerName} token refresh failed: 400`).test(msg);
      if (refreshFailed) status = `${providerName}_disconnected`;
      else if (/401|unauthorized/i.test(msg)) status = 'monday_disconnected';
      else if (msg === 'policy_not_configured') status = 'pending_policy';
      // This is the COMMON sync-failure path. It classifies + persists the
      // status but previously never logged, so the failure reached nobody. Ship
      // it before responding (the outer catch only fires on a secondary throw).
      logger.error('error', TAG, {
        ...buildSyncCtx(config),
        stage: 'force_sync_run',
        status,
        cause: msg?.slice(0, 200),
        error: err,
      });
      await syncConfigStorage.updateSyncConfig(config.configId, { status, lastError: msg.slice(0, 500) });
      return res.status(500).json({ error: 'sync_failed', message: msg, status });
    }
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'force_sync',
      cause: err.message?.slice(0, 200),
    });
    return res.status(500).json({ error: 'force_sync_failed', message: err.message });
  }
});

// POST /api/configs/:configId/enable — turn live sync on.
// Registers (or renews) the provider's push subscription and flips status to
// active. Provider-aware: works for both Google and Microsoft connections.
// Idempotent: safe to hit on an already-active row.
router.post('/api/configs/:configId/enable', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await loadRowOwnedByCaller(req, res);
    if (!config) return;
    const hasCalendar = Boolean(config.googleRefreshToken || config.microsoftRefreshToken);
    if (!hasCalendar) return res.status(400).json({ error: 'calendar_not_connected' });
    if (!config.mondayAccessToken) return res.status(400).json({ error: 'monday_not_connected' });

    const provider = getProvider(config);
    await provider.ensureSubscription(config);
    const updated = await syncConfigStorage.updateSyncConfig(config.configId, {
      status: 'active', lastError: null,
    });
    logger.info('enabled', TAG, buildSyncCtx(config));
    return res.json({ row: projectConfig(updated) });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'enable',
      cause: err.message?.slice(0, 200),
    });
    return res.status(500).json({ error: 'enable_failed', message: err.message });
  }
});

// POST /api/configs/:configId/pause — turn live sync off.
// Stops the Google watch channel; delta sync via /webhook/calendar halts until
// the user re-enables. Sync-token is preserved so re-enable picks up any
// events that changed during the pause (until Google expires the token).
router.post('/api/configs/:configId/pause', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await loadRowOwnedByCaller(req, res);
    if (!config) return;

    try {
      const provider = getProvider(config);
      await provider.stopSubscription(config);
    } catch (err) {
      logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
    }

    // Clear provider-specific subscription state. For Google these fields
    // exist; for Microsoft (Phase 2+) the equivalents will live alongside.
    const subscriptionPatch = config.provider === 'microsoft'
      ? { microsoftSubscriptionId: null, microsoftSubscriptionExpiration: null }
      : { googleResourceId: null, googleWatchExpiration: null };

    const updated = await syncConfigStorage.updateSyncConfig(config.configId, {
      status: 'paused',
      ...subscriptionPatch,
    });
    try { await syncConfigStorage.removeActiveConfig(config.configId); } catch (e) {
      logger.warn('index_cleanup_failed', TAG, { ...buildSyncCtx(config), op: 'removeActiveConfig', cause: e?.message || String(e) });
    }
    logger.info('paused', TAG, buildSyncCtx(config));
    return res.json({ row: projectConfig(updated) });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'pause',
      cause: err.message?.slice(0, 200),
    });
    return res.status(500).json({ error: 'pause_failed', message: err.message });
  }
});

// POST /api/configs/:configId/backfill — kick off background backfill of the
// next 6 months of events. Returns 202 immediately; the job advances on its
// own and the UI polls /api/configs for progress. Re-running while a job is
// already `running` is rejected.
router.post('/api/configs/:configId/backfill', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await loadRowOwnedByCaller(req, res);
    if (!config) return;
    if (!config.mondayAccessToken) return res.status(400).json({ error: 'monday_not_connected' });
    const hasCalendar = Boolean(config.googleRefreshToken || config.microsoftRefreshToken);
    if (!hasCalendar) return res.status(400).json({ error: 'calendar_not_connected' });

    if (config.backfill?.status === 'running') {
      return res.status(409).json({ error: 'backfill_already_running', backfill: config.backfill });
    }

    // Fire-and-forget: don't await. Any failure is persisted by the worker.
    startBackfill({ configId: config.configId }).catch((err) => {
      logger.error('error', TAG, { ...buildSyncCtx(config), stage: 'backfill_unhandled', cause: err.message });
    });

    return res.status(202).json({ ok: true });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'backfill_kickoff',
      cause: err.message?.slice(0, 200),
    });
    return res.status(500).json({ error: 'backfill_kickoff_failed', message: err.message });
  }
});

// POST /api/configs/:configId/backfill/cancel — signal the running job to stop
// at the next event boundary. Does not interrupt an in-flight monday write.
router.post('/api/configs/:configId/backfill/cancel', sessionTokenMiddleware, async (req, res) => {
  try {
    const config = await loadRowOwnedByCaller(req, res);
    if (!config) return;
    const ok = await requestBackfillCancel(config.configId);
    if (!ok) return res.status(409).json({ error: 'no_running_backfill' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('error', TAG, {
      ...buildAccountCtx({ accountId: req.session?.accountId, userId: req.session?.userId }),
      stage: 'backfill_cancel',
      cause: err.message?.slice(0, 200),
    });
    return res.status(500).json({ error: 'backfill_cancel_failed', message: err.message });
  }
});

export default router;

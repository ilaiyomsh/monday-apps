import express from 'express';
import crypto from 'crypto';
import { signingSecretMiddleware } from '../middlewares/signing-secret.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { getProvider } from '../services/provider.js';
import logger from '../services/logger.js';
import { buildAccountCtx, buildSyncCtx } from '../helpers/log-context.js';

const TAG = 'lifecycle';
const router = express.Router();

// Monday lifecycle events arrive as plain JSON in the request body. The
// authorization header carries a signed identity JWT, verified separately.
// Shape: { type, data: { payload: { object_id, workspace_id, ... }, user_id,
// account_id, app_feature_id, app_feature_reference_id, ... } }
function extract(body) {
  const data = body?.data || {};
  const p = data?.payload || {};
  return {
    eventType: body?.type || '',
    objectId: String(p.object_id || ''),
    accountId: String(data.account_id || ''),
    userId: String(data.user_id || ''),
    workspaceId: String(p.workspace_id || ''),
  };
}

async function handleCreate({ objectId, accountId, userId, workspaceId }) {
  const ctx = buildAccountCtx({ accountId, userId, objectId });
  const existing = await syncConfigStorage.getInstancePolicy(objectId);
  if (existing) {
    logger.debug('policy_exists', TAG, ctx);
    return;
  }
  const now = Date.now();
  await syncConfigStorage.setInstancePolicy(objectId, {
    accountId, objectId, workspaceId,
    ownerUserId: userId,
    // Seed with the installer. The list is refreshed from monday (boards.owners)
    // on every server-side ownership check, so it stays in sync with monday's
    // actual owner list over time.
    verifiedOwnerIds: [String(userId)],
    boardId: null,
    linkColumnId: null,
    peopleColumnId: null,
    itemNameSource: 'eventName',
    columnMapping: {},
    createdAt: now,
    updatedAt: now,
  });
  logger.info('installed', TAG, ctx);
}

async function teardownConfig(configId) {
  const config = await syncConfigStorage.getSyncConfig(configId);
  if (!config) return;

  // Best-effort stop of provider push subscription. Deletion of our storage
  // entries is the critical action — the channel/subscription will eventually
  // expire on its own if the stop call fails.
  try {
    const provider = getProvider(config);
    await provider.stopSubscription(config);
  } catch (err) {
    logger.warn('teardown_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
  }

  try { await syncConfigStorage.removeActiveConfig(configId); } catch { /* ignore */ }
  if (config.userId) {
    try { await syncConfigStorage.removeUserConfig(config.userId, configId); } catch { /* ignore */ }
  }
  if (config.accountId) {
    try { await syncConfigStorage.removeAccountConfig(config.accountId, configId); } catch { /* ignore */ }
  }
  if (config.objectId) {
    try { await syncConfigStorage.removeInstanceConfig(config.objectId, configId); } catch { /* ignore */ }
  }
  try { await syncConfigStorage.deleteSyncConfig(configId); } catch { /* ignore */ }
}

async function handleDelete({ objectId, accountId, userId }) {
  const policy = await syncConfigStorage.getInstancePolicy(objectId);
  const ctx = buildAccountCtx({
    accountId: accountId || policy?.accountId,
    userId: userId || policy?.ownerUserId,
    objectId,
  });
  const configIds = await syncConfigStorage.getInstanceConfigs(objectId);
  for (const configId of configIds) {
    await teardownConfig(configId);
  }
  try { await syncConfigStorage.deleteInstancePolicy(objectId); } catch { /* ignore */ }
  logger.info('uninstalled', TAG, { ...ctx, configs: configIds.length });
}

// Lifecycle handler — monday notifies us when a Custom Object instance is
// created, deleted, archived, duplicated, or has its attributes updated.
router.post('/lifecycle/custom-object', signingSecretMiddleware, async (req, res) => {
  try {
    const { eventType, objectId, accountId, userId, workspaceId } = extract(req.body);
    if (!eventType || !objectId) {
      logger.warn('lifecycle_missing_fields', TAG);
      return res.status(200).json({ ok: true, skipped: 'missing eventType/objectId' });
    }
    logger.debug('lifecycle_event', TAG, { ...buildAccountCtx({ accountId, userId, objectId }), eventType });

    switch (eventType) {
      case 'AppFeatureObject:create':
      case 'AppFeatureObject:import':
        await handleCreate({ objectId, accountId, userId, workspaceId });
        break;

      case 'AppFeatureObject:duplicate': {
        // Treat as a fresh create for the new (duplicated) objectId; the incoming
        // objectId is the new one per monday's semantics.
        await handleCreate({ objectId, accountId, userId, workspaceId });
        break;
      }

      case 'AppFeatureObject:delete':
        await handleDelete({ objectId, accountId, userId });
        break;

      case 'AppFeatureObject:archive':
      case 'AppFeatureObject:restore':
      case 'AppFeatureObject:publish':
      case 'AppFeatureObject:unpublish':
      case 'AppFeatureObject:update_attributes':
        // no-op for now; reserved
        break;

      default:
        logger.debug('lifecycle_unknown', TAG, { eventType });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('error', TAG, { stage: 'lifecycle', cause: err.message });
    // Still return 200 so monday doesn't retry aggressively; we'll reconcile
    // on the next event or during scheduled renewal.
    return res.status(200).json({ ok: false, error: err.message });
  }
});

export default router;

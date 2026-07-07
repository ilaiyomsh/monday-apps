import { Router } from 'express';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { getProvider } from '../services/provider.js';
import {
  classifyError,
  reasonForStatus,
  maybeNotifyOwner,
  maybeNotifyAffectedUser,
} from '../services/sync-status.js';
import logger, { shortId } from '../services/logger.js';
import { buildSyncCtx } from '../helpers/log-context.js';

const router = Router();
const TAG = 'scheduler';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Renew near-expiry push subscriptions (Google watch channels and, in Phase 2+,
// Microsoft Graph subscriptions) registered under the Custom Object admin path
// (all_active_configs). Cron schedule is `0 */12 * * *` so MS subscriptions
// (~71h max lifetime) get a renewal window even if one run is missed.
async function renewCustomObjectConfigs() {
  const index = await syncConfigStorage.getActiveConfigIndex();
  const expiring = index.filter((entry) => {
    const exp = Number(entry.subscriptionExpiration ?? entry.googleWatchExpiration);
    return Number.isFinite(exp) && exp - Date.now() < ONE_DAY_MS;
  });

  const counts = { renewed: 0, skipped: 0, failed: 0 };
  for (const entry of expiring) {
    const { configId } = entry;
    try {
      const config = await syncConfigStorage.getSyncConfig(configId);
      if (!config) {
        logger.warn('stale_index_entry', TAG, { cfg: shortId(configId) });
        await syncConfigStorage.removeActiveConfig(configId);
        counts.skipped++;
        continue;
      }
      const provider = getProvider(config);
      const result = await provider.ensureSubscription(config);
      if (result?.renewed) counts.renewed++; else counts.skipped++;
    } catch (err) {
      const config = await syncConfigStorage.getSyncConfig(configId).catch(() => null);
      const ctx = config ? buildSyncCtx(config) : { cfg: shortId(configId) };
      // Renewal hits the provider's token refresh first, so a dead refresh
      // token (Google or Microsoft) surfaces HERE — and historically this was
      // the ONLY place it surfaced once the push subscription had expired, so
      // the config stayed `active` forever and nobody was told. Classify the
      // failure and persist the disconnect so the admin UI reflects reality,
      // then notify both the owner and the affected user.
      const status = config ? classifyError(err, config.provider || 'google') : 'active';
      if (config && status !== 'active') {
        await syncConfigStorage.updateSyncConfig(configId, {
          status,
          lastError: (err.message || '').slice(0, 500),
        });
        const policy = await syncConfigStorage
          .getInstancePolicy(config.objectId)
          .catch(() => null);
        // Reload so the notifiers see the just-written lastError + fresh
        // cooldown fields.
        const fresh = (await syncConfigStorage.getSyncConfig(configId)) || config;
        const reason = reasonForStatus(status);
        if (reason) {
          await maybeNotifyOwner({ config: fresh, policy, reason, ctx, tag: TAG });
          await maybeNotifyAffectedUser({ config: fresh, status, ctx, tag: TAG });
        }
      }
      logger.error('error', TAG, {
        ...ctx,
        stage: 'renewal',
        status,
        cause: err.message,
      });
      counts.failed++;
    }
  }
  return { total: index.length, expiring: expiring.length, ...counts };
}

// monday scheduler cron entry point. Accepts both the monday-invoked
// /mndy-cronjob/<name> path and /scheduler/<name> for direct testing.
router.post(['/mndy-cronjob/renew-channel', '/scheduler/renew-channel'], async (req, res) => {
  try {
    const counts = await renewCustomObjectConfigs();
    logger.info('cron_tick', TAG, counts);
    return res.status(200).json({ ok: true, customObject: counts });
  } catch (err) {
    logger.error('error', TAG, { stage: 'cron_tick', cause: err.message });
    return res.status(500).json({ error: 'renew-channel failed' });
  }
});

export default router;

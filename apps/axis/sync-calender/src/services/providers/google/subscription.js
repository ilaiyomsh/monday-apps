// Google Calendar watch-channel lifecycle. Renamed/relocated from
// services/watch-channel.js as part of the provider abstraction. The webhook
// (routes/webhook.js) still branches on x-goog-channel-token prefix; when we
// register a watch here we pass configId (always "config_*") as the channel id.

import syncConfigStorage from '../../../storage/sync-config-storage.js';
import { ensureGoogleAccessToken } from './oauth.js';
import { watchCalendar, stopChannel } from './calendar.js';
import logger from '../../logger.js';
import { buildSyncCtx } from '../../../helpers/log-context.js';

const TAG = 'subscription';
const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // renew when < 24h left

function isStillFresh(config) {
  if (!config.googleResourceId || !config.googleWatchExpiration) return false;
  return Number(config.googleWatchExpiration) - Date.now() > RENEWAL_THRESHOLD_MS;
}

// Register (or re-register) a Google Calendar watch channel for this config.
// Idempotent — if the existing channel is still fresh, we skip and return it.
// Used by the sync engine (to guarantee a watch exists after first sync) and
// by the scheduler cron (to proactively renew near-expiry channels).
export async function ensureSubscription(config) {
  if (isStillFresh(config)) {
    return {
      channelId: config.configId,
      resourceId: config.googleResourceId,
      expiration: Number(config.googleWatchExpiration),
      renewed: false,
    };
  }

  const accessToken = await ensureGoogleAccessToken(config, syncConfigStorage);
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error('APP_BASE_URL_missing');

  // Best-effort stop of any prior channel before registering a new one.
  if (config.googleResourceId) {
    try {
      await stopChannel(accessToken, config.configId, config.googleResourceId);
    } catch (err) {
      logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
    }
  }

  const { resourceId, expiration } = await watchCalendar(accessToken, {
    channelId: config.configId,
    baseUrl,
  });

  const expirationNum = Number(expiration);
  await syncConfigStorage.updateSyncConfig(config.configId, {
    googleResourceId: resourceId,
    googleWatchExpiration: expirationNum,
  });
  await syncConfigStorage.addActiveConfig({
    configId: config.configId,
    objectId: config.objectId,
    provider: 'google',
    subscriptionExpiration: expirationNum,
  });

  const expiresInH = Math.round((expirationNum - Date.now()) / 3600_000);
  logger.info('subscription_renewed', TAG, { ...buildSyncCtx(config), exp_h: expiresInH });

  return { channelId: config.configId, resourceId, expiration: expirationNum, renewed: true };
}

// Stop the active watch channel for this config. Best-effort — caller should
// proceed even if Google rejects (the channel will eventually expire on its own).
export async function stopSubscription(config) {
  if (!config.googleResourceId) return;
  try {
    const accessToken = await ensureGoogleAccessToken(config, syncConfigStorage);
    await stopChannel(accessToken, config.configId, config.googleResourceId);
    logger.info('subscription_stopped', TAG, buildSyncCtx(config));
  } catch (err) {
    logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
  }
}

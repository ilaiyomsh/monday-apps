// Microsoft Graph push-notification subscription lifecycle.
//
// Graph subscriptions on `me/events` cap at ~71h (4230 minutes) lifetime, far
// shorter than Google's 7-day watch channel. The 12h scheduler cron pairs
// with a 24h-before-expiry renewal threshold so a missed run still has a
// safety window. We register subscriptions with expiration ≈ now+70h to
// stay just under the limit and avoid edge-case 400s.
//
// The webhook validates incoming notifications by matching `clientState`
// against the value we stored at creation time:
//   clientState = `microsoft:${configId}`
// That lets the webhook route lookup the config without calling Graph back.

import syncConfigStorage from '../../../storage/sync-config-storage.js';
import { ensureMicrosoftAccessToken } from './oauth.js';
import logger from '../../logger.js';
import { buildSyncCtx } from '../../../helpers/log-context.js';

const TAG = 'subscription';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Microsoft Graph max for /me/events subscriptions is 4230 minutes; we use
// 70 hours (4200 minutes) to stay safely under the cap.
const SUBSCRIPTION_LIFETIME_MS = 70 * 60 * 60 * 1000;
const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isStillFresh(config) {
  if (!config.microsoftSubscriptionId || !config.microsoftSubscriptionExpiration) return false;
  return Number(config.microsoftSubscriptionExpiration) - Date.now() > RENEWAL_THRESHOLD_MS;
}

function buildClientState(configId) {
  return `microsoft:${configId}`;
}

async function graphFetch(accessToken, path, init = {}, label = 'subscription') {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('error', TAG, { prv: 'microsoft', stage: `graph_${label}`, status: res.status, cause: text.slice(0, 200) });
    const err = new Error(`microsoft_graph_${label}_failed: ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  // DELETE returns 204 with no body
  if (res.status === 204) return null;
  return res.json();
}

async function createSubscription(accessToken, { notificationUrl, expirationDateTime, clientState }) {
  return graphFetch(accessToken, '/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created,updated,deleted',
      notificationUrl,
      resource: 'me/events',
      expirationDateTime,
      clientState,
      latestSupportedTlsVersion: 'v1_2',
    }),
  }, 'create_subscription');
}

async function patchSubscription(accessToken, subscriptionId, { expirationDateTime }) {
  return graphFetch(accessToken, `/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime }),
  }, 'patch_subscription');
}

async function deleteSubscription(accessToken, subscriptionId) {
  return graphFetch(accessToken, `/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
  }, 'delete_subscription');
}

// Register (or renew) a Graph subscription for this config. Idempotent — if
// the existing subscription is still fresh (>24h of life left), we skip and
// return it. Used by sync-engine after first sync and by the scheduler cron.
export async function ensureSubscription(config) {
  if (isStillFresh(config)) {
    return {
      channelId: config.microsoftSubscriptionId,
      resourceId: null,
      expiration: Number(config.microsoftSubscriptionExpiration),
      renewed: false,
    };
  }

  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error('APP_BASE_URL_missing');
  const notificationUrl = `${baseUrl}/webhook/microsoft`;
  const accessToken = await ensureMicrosoftAccessToken(config, syncConfigStorage);

  const newExpiration = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString();
  const clientState = buildClientState(config.configId);

  let subscription;
  if (config.microsoftSubscriptionId) {
    // Try renewal first; if the subscription is gone (404) or otherwise
    // unrecoverable, fall through to creating a fresh one.
    try {
      subscription = await patchSubscription(accessToken, config.microsoftSubscriptionId, {
        expirationDateTime: newExpiration,
      });
    } catch (err) {
      logger.warn('subscription_renewal_fallback', TAG, { ...buildSyncCtx(config), error: err.message });
      subscription = await createSubscription(accessToken, {
        notificationUrl,
        expirationDateTime: newExpiration,
        clientState,
      });
    }
  } else {
    subscription = await createSubscription(accessToken, {
      notificationUrl,
      expirationDateTime: newExpiration,
      clientState,
    });
  }

  const subscriptionId = subscription?.id || config.microsoftSubscriptionId;
  const expirationMs = Date.parse(subscription?.expirationDateTime || newExpiration);

  await syncConfigStorage.updateSyncConfig(config.configId, {
    microsoftSubscriptionId: subscriptionId,
    microsoftSubscriptionExpiration: expirationMs,
  });
  await syncConfigStorage.addActiveConfig({
    configId: config.configId,
    objectId: config.objectId,
    provider: 'microsoft',
    subscriptionExpiration: expirationMs,
  });

  const expiresInH = Math.round((expirationMs - Date.now()) / 3600_000);
  logger.info('subscription_renewed', TAG, { ...buildSyncCtx(config), exp_h: expiresInH });

  return {
    channelId: subscriptionId,
    resourceId: null,
    expiration: expirationMs,
    renewed: true,
  };
}

// Best-effort delete. If the subscription is already gone (or the refresh
// token died), log and continue — the subscription will expire on its own.
export async function stopSubscription(config) {
  if (!config.microsoftSubscriptionId) return;
  try {
    const accessToken = await ensureMicrosoftAccessToken(config, syncConfigStorage);
    await deleteSubscription(accessToken, config.microsoftSubscriptionId);
    logger.info('subscription_stopped', TAG, buildSyncCtx(config));
  } catch (err) {
    logger.warn('subscription_stop_failed', TAG, { ...buildSyncCtx(config), error: err.message });
  }
}

// Google provider — unified surface that the dispatcher picks up.
// All Google-specific field reads should be confined to this directory.

import syncConfigStorage from '../../../storage/sync-config-storage.js';
import {
  ensureGoogleAccessToken,
  exchangeGoogleCode,
  fetchGoogleUserEmail,
} from './oauth.js';
import {
  listChanges as listChangesRaw,
  listUpcomingPage as listUpcomingPageRaw,
  getSyncTokenOnly,
  shouldSync as googleShouldSync,
  buildEventUrl as googleBuildEventUrl,
  mapEventToCanonical,
} from './calendar.js';
import {
  ensureSubscription as googleEnsureSubscription,
  stopSubscription as googleStopSubscription,
} from './subscription.js';

// Pull all changes since the last sync. Cold start (no stored syncToken)
// establishes a starting point and returns no events. Returns canonical events
// + next sync state. On 410 (expired token) returns syncTokenExpired:true so
// the caller can reset and retry.
async function listChanges(config) {
  const accessToken = await ensureGoogleAccessToken(config, syncConfigStorage);
  const userEmail = config.googleUserEmail || null;

  if (!config.googleSyncToken) {
    const { syncToken } = await getSyncTokenOnly(accessToken);
    return { events: [], nextSyncState: { syncToken }, syncTokenExpired: false };
  }

  try {
    const { events, newSyncToken } = await listChangesRaw(accessToken, config.googleSyncToken, userEmail);
    return {
      events,
      nextSyncState: newSyncToken ? { syncToken: newSyncToken } : null,
      syncTokenExpired: false,
    };
  } catch (err) {
    if (err.message === 'SYNC_TOKEN_EXPIRED') {
      return { events: [], nextSyncState: null, syncTokenExpired: true };
    }
    throw err;
  }
}

// Backfill page fetch with explicit accessToken (caller already refreshed it).
async function listUpcomingPage(accessToken, args) {
  return listUpcomingPageRaw(accessToken, args);
}

// Map next sync state to provider-specific storage fields. sync-engine calls
// this after successfully processing a batch.
async function persistSyncState(configId, state) {
  if (!state || !state.syncToken) return;
  await syncConfigStorage.updateSyncConfig(configId, { googleSyncToken: state.syncToken });
}

// Reset sync state when a stale token is rejected. Next listChanges() will
// fall back to getSyncTokenOnly().
async function resetSyncState(configId) {
  await syncConfigStorage.updateSyncConfig(configId, { googleSyncToken: null });
}

export const provider = {
  name: 'google',

  // OAuth
  exchangeCode: exchangeGoogleCode,
  fetchUserEmail: fetchGoogleUserEmail,
  ensureAccessToken: ensureGoogleAccessToken,

  // Sync — all return canonical events
  listChanges,
  listUpcomingPage,
  persistSyncState,
  resetSyncState,
  shouldSync: googleShouldSync,
  buildEventUrl: googleBuildEventUrl,
  mapEventToCanonical,

  // Subscriptions
  ensureSubscription: googleEnsureSubscription,
  stopSubscription: googleStopSubscription,
};

export default provider;

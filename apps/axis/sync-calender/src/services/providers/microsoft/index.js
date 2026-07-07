// Microsoft (Outlook) provider — Phase 2 surface. Gated by isMicrosoftEnabled()
// so the entire codepath is dormant unless MICROSOFT_CLIENT_ID +
// MICROSOFT_CLIENT_SECRET are set in the environment.

import syncConfigStorage from '../../../storage/sync-config-storage.js';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  ensureMicrosoftAccessToken,
  fetchMicrosoftUserProfile,
  pickMicrosoftEmail,
} from './oauth.js';
import {
  listChanges as listChangesRaw,
  listUpcomingPage as listUpcomingPageRaw,
  shouldSync as microsoftShouldSync,
  buildEventUrl as microsoftBuildEventUrl,
  mapEventToCanonical,
} from './calendar.js';
import {
  ensureSubscription as microsoftEnsureSubscription,
  stopSubscription as microsoftStopSubscription,
} from './subscription.js';

export function isMicrosoftEnabled() {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

// Pull all changes since the last sync. Cold start (no stored deltaLink)
// establishes a starting point and returns events in the default window.
// Returns canonical events + next sync state. On 410 returns
// syncTokenExpired:true so the caller can reset and retry.
async function listChanges(config) {
  const accessToken = await ensureMicrosoftAccessToken(config, syncConfigStorage);
  const userEmail = config.microsoftUserEmail || null;

  try {
    const { events, deltaLink } = await listChangesRaw(accessToken, config.microsoftDeltaLink, userEmail);
    return {
      events,
      nextSyncState: deltaLink ? { deltaLink } : null,
      syncTokenExpired: false,
    };
  } catch (err) {
    if (err.message === 'SYNC_TOKEN_EXPIRED') {
      return { events: [], nextSyncState: null, syncTokenExpired: true };
    }
    throw err;
  }
}

async function listUpcomingPage(accessToken, args) {
  return listUpcomingPageRaw(accessToken, args);
}

async function persistSyncState(configId, state) {
  if (!state || !state.deltaLink) return;
  await syncConfigStorage.updateSyncConfig(configId, { microsoftDeltaLink: state.deltaLink });
}

async function resetSyncState(configId) {
  await syncConfigStorage.updateSyncConfig(configId, { microsoftDeltaLink: null });
}

export const provider = {
  name: 'microsoft',

  // OAuth
  buildAuthUrl: buildMicrosoftAuthUrl,
  exchangeCode: exchangeMicrosoftCode,
  ensureAccessToken: ensureMicrosoftAccessToken,
  fetchUserProfile: fetchMicrosoftUserProfile,
  pickEmail: pickMicrosoftEmail,

  // Sync — all return canonical events
  listChanges,
  listUpcomingPage,
  persistSyncState,
  resetSyncState,
  shouldSync: microsoftShouldSync,
  buildEventUrl: microsoftBuildEventUrl,
  mapEventToCanonical,

  // Subscriptions
  ensureSubscription: microsoftEnsureSubscription,
  stopSubscription: microsoftStopSubscription,
};

export default provider;

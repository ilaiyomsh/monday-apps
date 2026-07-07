// CSRF state guard for OAuth round-trips (both Google and monday).
// State is 256-bit random, stored in `oauth_state_<state>` with a 5-min TTL
// by sync-config-storage, and consumed once on callback.

import crypto from 'crypto';
import syncConfigStorage from '../storage/sync-config-storage.js';

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

export async function issueOauthState({ provider, configId, userId, accountId }) {
  const state = generateState();
  await syncConfigStorage.setOauthState(state, {
    provider,
    configId,
    userId,
    accountId,
    createdAt: Date.now(),
  });
  return state;
}

export async function consumeOauthState(state, expectedProvider) {
  const entry = await syncConfigStorage.consumeOauthState(state);
  if (!entry) return null;
  if (expectedProvider && entry.provider !== expectedProvider) return null;
  return entry;
}

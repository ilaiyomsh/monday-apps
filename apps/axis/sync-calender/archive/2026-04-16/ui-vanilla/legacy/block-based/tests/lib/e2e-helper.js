// Polling + verification helpers specific to Tier 2 (E2E) scenarios.
import { getJson, postJson, waitFor } from './http.js';
import { findItemsByName } from './monday-query.js';

export async function seedEvents(mockBaseUrl, events) {
  return postJson(`${mockBaseUrl}/admin/seed-events`, { events });
}

export async function setUserEmail(mockBaseUrl, email) {
  return postJson(`${mockBaseUrl}/admin/set-user-email`, { email });
}

export async function getMockState(mockBaseUrl) {
  const r = await getJson(`${mockBaseUrl}/admin/state`);
  return r.body;
}

// Wait until at least one relay entry for the given eventId is present
// AND its forward attempt has completed (status set by forwardToAction).
// In the v3 (revised) architecture the relay entry carries routing info in
// `cachedContext` (populated from the app's trigger cache) rather than
// `outputFields`, which is now domain-only.
function relayMatchesEvent(entry, eventId) {
  if (entry?.cachedContext?.eventId !== eventId) return false;
  // Only accept an entry once the async forward has finished so downstream
  // assertions (e.g. forwardedStatus) see the final state.
  return entry.status === 'forwarded' || entry.status === 'error';
}

export async function waitForRelay(mockBaseUrl, { eventId, timeoutMs = 10000 }) {
  return waitFor(async () => {
    const s = await getMockState(mockBaseUrl);
    const relays = s.recentRelays || [];
    return relays.find((r) => relayMatchesEvent(r, eventId)) || null;
  }, { timeoutMs, intervalMs: 400 });
}

// Snapshot the current relay count so a later call to waitForRelayAfter can
// tell which entries are new.
export async function snapshotRelayCount(mockBaseUrl) {
  const s = await getMockState(mockBaseUrl);
  return s.recentRelays?.length || 0;
}

// Wait for a NEW relay (added after `sinceCount`) that matches `eventId`.
// Used by multi-phase scenarios so phase N+1 doesn't accidentally pick up
// phase N's entry.
export async function waitForRelayAfter(mockBaseUrl, { eventId, sinceCount, timeoutMs = 10000 }) {
  return waitFor(async () => {
    const s = await getMockState(mockBaseUrl);
    const relays = s.recentRelays || [];
    if (relays.length <= sinceCount) return null;
    for (let i = relays.length - 1; i >= sinceCount; i--) {
      if (relayMatchesEvent(relays[i], eventId)) return relays[i];
    }
    return null;
  }, { timeoutMs, intervalMs: 400 });
}

// Wait until total relay count reaches at least `min`.
export async function waitForRelayCount(mockBaseUrl, min, { timeoutMs = 10000 } = {}) {
  return waitFor(async () => {
    const s = await getMockState(mockBaseUrl);
    const relays = s.recentRelays || [];
    return relays.length >= min ? relays : null;
  }, { timeoutMs, intervalMs: 400 });
}

export async function waitForItemByName({ token, boardId, name, timeoutMs = 10000 }) {
  const found = await waitFor(async () => {
    const items = await findItemsByName({ token, boardId, name });
    return items.length > 0 ? items : null;
  }, { timeoutMs, intervalMs: 500 });
  return found || [];
}

export async function waitForItemGone({ token, boardId, name, timeoutMs = 10000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = await findItemsByName({ token, boardId, name });
    if (items.length === 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Assert nothing happened — no relay was forwarded after firing the webhook.
export async function assertNoRelay(mockBaseUrl, { maxWaitMs = 2500 } = {}) {
  const before = (await getMockState(mockBaseUrl)).recentRelays?.length || 0;
  await new Promise((r) => setTimeout(r, maxWaitMs));
  const after = (await getMockState(mockBaseUrl)).recentRelays?.length || 0;
  return after === before;
}

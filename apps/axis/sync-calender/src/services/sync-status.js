// Shared sync-status classification + disconnect notifications.
//
// Both the Google/Microsoft push handler (routes/webhook-config.js) and the
// daily renewal cron (routes/scheduler.js) need to (1) translate a thrown
// error into a config status transition and (2) tell people when a connection
// drops. Before this module the logic lived only in webhook-config.js, so a
// disconnect that surfaced ONLY on the cron path (e.g. the push subscription
// had already expired, so no webhook ever fires) left the config stuck on
// `active` and nobody was notified. Centralizing it here lets the scheduler
// reuse the exact same transitions + messages.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { sendNotification } from './monday-api.js';
import logger, { shortId } from './logger.js';

const TAG = 'sync_status';
export const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Statuses that mean "a credential died and a human must reconnect". Used to
// decide whether to notify the affected user (who is the only one who can fix
// it by re-authorizing in the admin app).
export const DISCONNECT_STATUSES = new Set([
  'google_disconnected',
  'microsoft_disconnected',
  'monday_disconnected',
]);

// Classify a thrown sync/renewal error into a status transition. Provider-aware
// so Microsoft and Google refresh failures land on the correct disconnected
// state. Mirrors the error shapes thrown by services/providers/*/oauth.js and
// services/monday-api.js.
export function classifyError(err, providerName) {
  const msg = err?.message || '';
  const code = err?.code;
  const refreshFailed =
    msg === 'google_refresh_token_missing' ||
    code === 'google_refresh_token_missing' ||
    msg === 'microsoft_refresh_token_missing' ||
    code === 'microsoft_refresh_token_missing' ||
    code === 'refresh_token_invalid' ||
    /google token refresh failed: 400/.test(msg) ||
    /microsoft token refresh failed: 400/.test(msg);
  if (refreshFailed) return `${providerName}_disconnected`;
  // monday-api stamps err.code from extensions.code. NOT_AUTHENTICATED is the
  // canonical "no/invalid token" signal — prefer it over the message regex,
  // which never matched the actual "Not authenticated" string monday returns.
  if (code === 'NOT_AUTHENTICATED') return 'monday_disconnected';
  if (/401|unauthorized|not authenticated/i.test(msg)) return 'monday_disconnected';
  if (msg === 'policy_not_configured') return 'pending_policy';
  return 'active';
}

// Map a terminal status to the notification reason used by the owner-facing
// message builder. Non-actionable statuses (transient/active) return null so
// callers skip the notification.
export function reasonForStatus(status) {
  switch (status) {
    case 'google_disconnected':
    case 'microsoft_disconnected':
    case 'monday_disconnected':
    case 'pending_policy':
      return status;
    default:
      return null;
  }
}

function providerLabel(provider) {
  if (provider === 'microsoft') return 'Outlook';
  if (provider === 'google') return 'Google Calendar';
  return 'calendar';
}

// Owner-facing message: tells the instance owner that one of their members'
// syncs stopped, and who. `who` is the affected user's email when known.
export function buildNotificationText({ config, reason, errorCount, columnId }) {
  const who = config.googleUserEmail || config.microsoftUserEmail || `user ${shortId(config.configId)}`;
  const col = columnId ? ` (column "${columnId}")` : '';
  switch (reason) {
    case 'event_errors:column_missing':
      return `Sync stopped for ${who}: board column was deleted${col}. Re-select it in the Setup tab.`;
    case 'event_errors:board_missing':
      return `Sync stopped for ${who}: configured board no longer exists. Pick a new board in Setup.`;
    case 'event_errors:board_invalid':
      return `Sync stopped for ${who}: the app lost access to the configured board. Restore access or pick a new board in Setup.`;
    case 'event_errors:resource_missing':
      return `Sync error for ${who}: a board resource is missing. Verify board + Link column + mappings in Setup.`;
    case 'event_errors:column_invalid':
      return `Sync issue for ${who}: mapped column${col} is invalid. Update the mapping in Setup.`;
    case 'event_errors:bad_value':
      return `Sync error for ${who}: value rejected on column${col} — likely a deleted status label. Check Setup or the user's Conditions.`;
    case 'event_errors:user_not_subscribed':
      return `Sync issue for ${who}: assigned user is not subscribed to the board.`;
    case 'event_errors:board_full':
      return `Sync stopped for ${who}: board hit the 10,000-item limit.`;
    case 'event_errors:permissions':
      return `Sync stopped for ${who}: monday.com permissions insufficient. User must re-authorize.`;
    case 'event_errors:scope_missing':
      return `Sync stopped for ${who}: monday.com OAuth scopes missing. User must re-authorize.`;
    case 'event_errors:api_blocked':
      return `Sync paused for ${who}: monday.com API temporarily blocked.`;
    case 'event_errors:unknown':
      return `Sync: ${errorCount} event(s) failed for ${who}. See logs.`;
    case 'google_disconnected':
      return `Sync stopped for ${who}: Google account disconnected. User must reconnect from the admin app.`;
    case 'microsoft_disconnected':
      return `Sync stopped for ${who}: Microsoft account disconnected. User must reconnect from the admin app.`;
    case 'monday_disconnected':
      return `Sync stopped for ${who}: monday.com authorization expired. User must reconnect from the admin app.`;
    case 'pending_policy':
      return `Sync stopped for ${who}: instance policy incomplete. Set the board and Link column in Setup.`;
    default:
      return `Sync error for ${who}.`;
  }
}

// User-facing message: addressed to the affected user themselves, telling them
// THEIR connection dropped and how to fix it. Returns null when we have no
// working channel to reach them — `monday_disconnected` means the very token
// we'd send the notification with is dead, so there's no point trying.
function buildUserDisconnectText(status, provider) {
  const label = providerLabel(provider);
  switch (status) {
    case 'google_disconnected':
    case 'microsoft_disconnected':
      return `Your ${label} connection for Calendar Sync expired. Open the Calendar Sync app in monday.com and reconnect to resume syncing your events.`;
    default:
      return null;
  }
}

// Resolve the monday token to send the owner notification WITH. We prefer the
// owner's OWN token (found on their own config in the instance) over the
// affected user's token — because the most important failure to surface,
// `monday_disconnected`, means the affected user's token is the dead thing.
// Sending through the owner's working token keeps the owner reachable even
// then. Falls back to the affected user's token when the owner has no
// connected config of their own (e.g. owner never linked a calendar).
async function resolveOwnerToken(config, ownerUserId) {
  if (String(config.userId) === String(ownerUserId)) {
    return config.mondayAccessToken; // the affected user IS the owner
  }
  try {
    // Look the owner up via the per-user index (`user_configs_<ownerUserId>`)
    // rather than scanning every member config in the instance — the owner
    // usually has a single config here, so this is ~1 read instead of N.
    const ownerConfigIds = await syncConfigStorage.getUserConfigs(ownerUserId);
    for (const cid of ownerConfigIds) {
      if (cid === config.configId) continue;
      const c = await syncConfigStorage.getSyncConfig(cid);
      if (c && String(c.objectId) === String(config.objectId) && c.mondayAccessToken) {
        return c.mondayAccessToken;
      }
    }
  } catch {
    // fall through to the affected user's token
  }
  return config.mondayAccessToken;
}

// Notify the instance OWNER that a member's sync failed. Cooldown keyed on
// lastOwnerNotifiedAt/Reason so we don't spam — but a NEW failure reason
// reaches the owner immediately even if we notified for a different one today.
export async function maybeNotifyOwner({ config, policy, reason, ctx, errorCount = 0, columnId = null, tag = TAG }) {
  if (!reason) return; // transient classification — skip notification, no log

  // A real disconnect that can't reach the owner must NOT vanish silently —
  // the usual cause is a transient policy read returning null (callers pass
  // `policy` from a `.catch(() => null)`), which leaves `ownerUserId`
  // undefined. Warn so it's visible; cooldown is left unwritten so the next
  // cron run retries once the read recovers.
  const { ownerUserId } = policy || {};
  if (!ownerUserId || !config.objectId) {
    logger.warn('owner_notify_skipped', tag, {
      ...ctx,
      reason,
      cause: !ownerUserId ? 'no_owner_in_policy' : 'no_object_id',
    });
    return;
  }

  const now = Date.now();
  const last = config.lastOwnerNotifiedAt;
  const lastReason = config.lastOwnerNotifiedReason;
  if (last && lastReason === reason && now - last < NOTIFY_COOLDOWN_MS) return;

  const token = await resolveOwnerToken(config, ownerUserId);
  if (!token) {
    logger.warn('owner_notify_skipped', tag, { ...ctx, reason, cause: 'no_owner_token' });
    return;
  }

  const text = buildNotificationText({ config, reason, errorCount, columnId });

  try {
    await sendNotification(token, { userId: ownerUserId, targetId: config.objectId, text });
    await syncConfigStorage.updateSyncConfig(config.configId, {
      lastOwnerNotifiedAt: now,
      lastOwnerNotifiedReason: reason,
    });
    logger.info('owner_notified', tag, { ...ctx, reason, errorCount });
  } catch (err) {
    logger.warn('owner_notify_failed', tag, { ...ctx, reason, cause: err.message?.slice(0, 200) });
  }
}

// Notify the AFFECTED USER that their own connection dropped, so they can
// reconnect. Separate cooldown fields (lastUserNotifiedAt/Reason) so it never
// collides with the owner cooldown. Sent via the user's own monday token,
// targeting the Custom Object instance (objectId) so the notification
// deep-links to the admin app — where they can actually reconnect.
export async function maybeNotifyAffectedUser({ config, status, ctx, tag = TAG }) {
  if (!DISCONNECT_STATUSES.has(status)) return;
  const text = buildUserDisconnectText(status, config.provider);
  if (!text) return; // no working channel to reach the user (e.g. monday token dead)

  const userId = config.userId;
  if (!userId || !config.objectId || !config.mondayAccessToken) return;

  const now = Date.now();
  const last = config.lastUserNotifiedAt;
  const lastReason = config.lastUserNotifiedReason;
  if (last && lastReason === status && now - last < NOTIFY_COOLDOWN_MS) return;

  try {
    await sendNotification(config.mondayAccessToken, { userId, targetId: config.objectId, text });
    await syncConfigStorage.updateSyncConfig(config.configId, {
      lastUserNotifiedAt: now,
      lastUserNotifiedReason: status,
    });
    logger.info('user_notified', tag, { ...ctx, status });
  } catch (err) {
    logger.warn('user_notify_failed', tag, { ...ctx, status, cause: err.message?.slice(0, 200) });
  }
}

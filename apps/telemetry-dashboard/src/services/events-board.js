// Events-board service — writes normalized lifecycle/app events as items on
// the owner's private "App Lifecycle Events" board. Fail-soft BY CONTRACT:
// recordEvent never throws and returns null on any failure — a dead board, a
// bad token, an unconfigured board, or a monday outage must never bubble into
// the webhook path.
//
// CONFIG SOURCE (Change: board config moved from boot-time env to runtime
// storage): boardId, the single groupId, and the logical→column-id map are
// read per event via the injected `getConfig()` (backed by SecureStorage with
// its own 60s cache in the storage service). So changing the mapping in the
// Settings UI takes effect WITHOUT a redeploy. Until a board is provisioned,
// getConfig() yields null → recordEvent warns once and skips (inert).
//
// GROUPS (decision: ONE group per board, not one-per-app): every event lands
// in the board's single group (config.groupId); the `app` column discriminates.
//
// PRIVACY: evt.details (which may carry account names — allowed BY DESIGN on
// this private board) goes ONLY to the board via column_values. Logger calls
// in this file carry ids/enums and error.message only — never payload objects.
//
// All collaborators are injected — this module imports nothing.

const TAG = 'events_board';
const DETAILS_MAX_CHARS = 2000;

/**
 * @param {object} deps
 * @param {{ createItem: Function }} deps.mondayApi
 * @param {() => Promise<{ boardId: string, groupId: string|null, columns: Record<string,string> }|null>} deps.getConfig
 *   Resolves the current board config, or null when no board is provisioned.
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {{ recordEvent: (evt: object) => Promise<string|null> }}
 */
export function createEventsBoardService({ mondayApi, getConfig, logger }) {
  // 'lifecycle_not_configured' is throttled to once per boot.
  let warnedNotConfigured = false;

  /** UTC { date, time } for a monday date column, from an ISO string / epoch. */
  function toDateTime(occurredAt) {
    let d = new Date(occurredAt ?? Date.now());
    if (Number.isNaN(d.getTime())) d = new Date();
    const iso = d.toISOString(); // always UTC
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }

  /** JSON.stringify the (already allowlisted) details, capped at 2000 chars. */
  function stringifyDetails(details) {
    let text;
    try {
      text = JSON.stringify(details ?? {});
    } catch (err) {
      // Circular / hostile toJSON — the board cell degrades to an empty object.
      logger.warn('details_stringify_failed', TAG, { error: String(err?.message ?? err) });
      text = '{}';
    }
    if (typeof text !== 'string') text = '{}';
    return text.length > DETAILS_MAX_CHARS ? text.slice(0, DETAILS_MAX_CHARS) : text;
  }

  /** Build column_values, skipping any column whose id is absent from the map. */
  function buildColumnValues(evt, columns) {
    const cols = columns && typeof columns === 'object' ? columns : {};
    const values = {};
    const put = (key, value) => {
      const columnId = cols[key];
      if (typeof columnId === 'string' && columnId.length > 0) values[columnId] = value;
    };
    put('event_time', toDateTime(evt.occurredAt));
    put('category', { label: String(evt.category ?? '') }); // Lifecycle | Install | Subscription
    put('event_type', String(evt.eventType ?? ''));
    put('app', String(evt.appSlug ?? ''));
    put('feature', String(evt.feature ?? ''));
    put('account_id', String(evt.accountId ?? ''));
    put('user_id', String(evt.userId ?? ''));
    // #145 enrichment columns (skipped automatically on pre-#145 boards
    // whose stored column map has no ids for them).
    put('user_name', String(evt.userName ?? ''));
    put('user_email', String(evt.userEmail ?? ''));
    put('workspace', String(evt.workspace ?? ''));
    put('object_name', String(evt.objectName ?? ''));
    if (typeof evt.objectUrl === 'string' && evt.objectUrl.length > 0) {
      // monday link column value: { url, text } — text falls back to the url.
      put('object_url', { url: evt.objectUrl, text: String(evt.objectName || evt.objectUrl) });
    }
    put('app_version', String(evt.appVersion ?? ''));
    put('details', { text: stringifyDetails(evt.details) });
    put('event_id', String(evt.eventId ?? ''));
    return values;
  }

  /**
   * Resolve the current board config. Never throws — a read failure or an
   * unconfigured/invalid config degrades to null (caller treats it as inert).
   * @returns {Promise<{ boardId: string, groupId: string|null, columns: object }|null>}
   */
  async function resolveConfig() {
    try {
      const cfg = await getConfig();
      if (cfg && typeof cfg === 'object' && cfg.boardId) return cfg;
      return null;
    } catch (err) {
      logger.error('board_config_resolve_failed', TAG, { error: String(err?.message ?? err) });
      return null;
    }
  }

  /**
   * Create one board item for a normalized event. Never throws.
   * @param {{ category: string, eventType: string, appSlug: string, feature: string,
   *           accountId: string, userId: string, occurredAt: string,
   *           details: object, eventId: string }} evt
   * @returns {Promise<string|null>} created item id, or null on any failure
   */
  async function recordEvent(evt) {
    try {
      if (!evt || typeof evt !== 'object') {
        logger.warn('record_event_invalid', TAG, {});
        return null;
      }
      const cfg = await resolveConfig();
      if (!cfg) {
        // No board provisioned yet — warn once, then stay quiet. Webhooks
        // still 202 upstream; nothing is recorded.
        if (!warnedNotConfigured) {
          warnedNotConfigured = true;
          logger.warn('lifecycle_not_configured', TAG, {});
        }
        return null;
      }
      const itemId = await mondayApi.createItem({
        boardId: cfg.boardId,
        groupId: cfg.groupId ?? null, // the single events group; null → default
        itemName: `${evt.eventType} · ${evt.appSlug}`,
        columnValues: buildColumnValues(evt, cfg.columns),
      });
      return itemId ?? null;
    } catch (err) {
      // Fail-soft: the webhook path must survive any monday failure.
      logger.error('record_event_failed', TAG, {
        app: String(evt?.appSlug ?? ''),
        type: String(evt?.eventType ?? ''),
        eventId: String(evt?.eventId ?? ''),
        error: String(err?.message ?? err),
      });
      return null;
    }
  }

  return { recordEvent };
}

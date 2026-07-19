// Events-board service — writes normalized lifecycle/app events as items on
// the owner's private monday "App Lifecycle Events" board (one group per app
// slug). Fail-soft BY CONTRACT: recordEvent never throws and returns null on
// any failure — a dead board, a bad token, or a monday outage must never
// bubble into the webhook path.
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
 * @param {{ createItem: Function, getBoardGroups: Function, createGroup: Function }} deps.mondayApi
 * @param {string} deps.boardId - target board id
 * @param {Record<string, string>} deps.columns - logical key → monday column id
 *   (keys: event_time, category, event_type, app, feature, account_id,
 *   user_id, details, event_id). Any missing key → that column is skipped.
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {{ ensureGroupForApp: (appSlug: string) => Promise<string|null>,
 *             recordEvent: (evt: object) => Promise<string|null> }}
 */
export function createEventsBoardService({ mondayApi, boardId, columns, logger }) {
  const cols = columns && typeof columns === 'object' ? columns : {};

  // appSlug → groupId, cached for the life of the process. Failures are NOT
  // cached, so the next event retries group resolution.
  const groupCache = new Map();

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
  function buildColumnValues(evt) {
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
    put('details', { text: stringifyDetails(evt.details) });
    put('event_id', String(evt.eventId ?? ''));
    return values;
  }

  /**
   * Resolve (find-by-title or create) the board group for an app slug.
   * Never throws; null on failure — the caller then creates the item ungrouped.
   * @param {string} appSlug
   * @returns {Promise<string|null>}
   */
  async function ensureGroupForApp(appSlug) {
    const slug = String(appSlug ?? '');
    if (groupCache.has(slug)) return groupCache.get(slug);
    try {
      const groups = await mondayApi.getBoardGroups(boardId);
      const existing = (Array.isArray(groups) ? groups : []).find((g) => g?.title === slug);
      if (existing?.id) {
        groupCache.set(slug, existing.id);
        return existing.id;
      }
      const createdId = await mondayApi.createGroup({ boardId, groupName: slug });
      if (createdId) {
        groupCache.set(slug, createdId);
        return createdId;
      }
      logger.warn('group_create_empty', TAG, { app: slug });
      return null;
    } catch (err) {
      // Group is cosmetic — the event still lands on the board, ungrouped.
      logger.warn('group_ensure_failed', TAG, { app: slug, error: String(err?.message ?? err) });
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
      const groupId = await ensureGroupForApp(evt.appSlug);
      const itemId = await mondayApi.createItem({
        boardId,
        groupId,
        itemName: `${evt.eventType} · ${evt.appSlug}`,
        columnValues: buildColumnValues(evt),
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

  return { ensureGroupForApp, recordEvent };
}

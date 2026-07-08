/*
 * Per-scope row ordering for the FLAT data tables (Previous tasks, Tasks tab
 * groups, Decisions) — a generalization of utils/topicOrder.js.
 *
 * monday's public GraphQL API has NO item/subitem "position" mutation, so the
 * order a user sets by dragging a whole row can't be persisted as native board
 * order. Instead we keep an explicit id-order map per SCOPE in monday.storage
 * (mirroring SettingsContext / TemplatesContext / topicOrder), and re-apply it
 * on every read via applyRowOrder().
 *
 * A "scope" is a stable string identifying one orderable list, e.g.
 *   `decisions_${discussionId}`             — the discussion's decisions
 *   `tasks_${discussionId}_status_${labelId}` — one status group of a discussion's tasks
 *   `previous_${discussionId}_${previousId}`  — a previous discussion's tasks
 * The scope keeps orders from different tabs / discussions / groups separate.
 *
 * Stored shape (key `discussions_row_order_${instanceOrBoardId}`):
 *   { [scope]: string[] }   // ordered real monday item ids per scope
 *
 * applyRowOrder() is defensive (same spirit as topicOrder.applyOrder): ids in
 * the saved order render first in that order; unknown ids (created elsewhere)
 * keep their API order at the END; stale ids (deleted) drop out.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

// A single storage key holds the whole { [scope]: string[] } map. Each scope
// already embeds a globally-unique discussion id (monday item ids don't collide
// across instances), so — like topicOrder's per-discussion key — no extra
// per-instance namespacing is needed here.
const STORAGE_KEY = 'discussions_row_order';
const TIMEOUT_MS = 5000;

function storageKey() {
  return STORAGE_KEY;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

// Read the whole { [scope]: string[] } map; {} on any failure.
async function loadAll() {
  try {
    const res = await withTimeout(monday.storage.getItem(storageKey()));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
    }
  } catch {
    // storage unavailable / parse error — fall back to natural (API) order.
  }
  return {};
}

/** Load the saved id order for ONE scope; [] when none / on failure. */
export async function loadRowOrder(scope) {
  if (!scope) return [];
  const all = await loadAll();
  return Array.isArray(all[scope]) ? all[scope].map(String) : [];
}

/** Persist a new id order for ONE scope (array of real monday item ids). */
export async function saveRowOrder(scope, ids) {
  if (!scope) return;
  try {
    const all = await loadAll();
    all[scope] = (ids || []).map(String);
    await monday.storage.setItem(storageKey(), JSON.stringify(all));
  } catch (err) {
    logger.warn('rowOrder', 'שמירת סדר השורות נכשלה', err);
  }
}

/** Sort an array of {id} objects by a saved id order; unknown ids keep their
 *  relative (API) position at the end, deleted ids naturally drop out. Pure. */
export function applyRowOrder(arr, orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return arr;
  const rank = new Map(orderIds.map((id, i) => [String(id), i]));
  return [...arr].sort((a, b) => {
    const ra = rank.has(String(a.id)) ? rank.get(String(a.id)) : Infinity;
    const rb = rank.has(String(b.id)) ? rank.get(String(b.id)) : Infinity;
    return ra - rb; // stable among equal ranks (Array.prototype.sort is stable)
  });
}

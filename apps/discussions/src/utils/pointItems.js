/*
 * Per-discussion POINT -> decisions/tasks association.
 *
 * A decision/task can be created FROM a topic POINT (the "+" in the Topics tab's
 * החלטות/משימות columns). We must remember which decisions/tasks each point
 * spawned so the per-point counter + names popup can show them and survive a
 * reload. The natural home would be a board_relation on the topics SUBITEMS
 * board (pointDecisionsLinkID / pointTasksLinkID), but those columns do NOT
 * exist there — the write is a silent no-op and the read is always empty. The
 * public API also can't recover the association from the item side (a decision
 * links only to the discussion; a task links to the topic, not the point). So we
 * keep the map app-local in monday.storage, keyed per discussion — mirroring
 * topicOrder / discussedStore / summaryStore (JSON value, 5s timeout, graceful
 * fallback when storage is unavailable, e.g. local dev).
 *
 * Stored shape (key `discussions_point_items_${discussionId}`):
 *   { [pointId]: { decisions: string[], tasks: string[] } }
 * pointId is the point's REAL subitem id (never a temp/optimistic id); the ids
 * are the created decision/task item ids. The Topics tab INTERSECTS these with
 * the discussion's currently-loaded decisions/tasks, so a since-deleted id drops
 * out of the count on its own (and can be pruned — see prunePointItems).
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_point_items';
const TIMEOUT_MS = 5000;

function key(discussionId) {
  return `${STORAGE_KEY_BASE}_${discussionId}`;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

// Kind ('decision' | 'task') -> the stored bucket key.
function bucketOf(kind) {
  return kind === 'decision' ? 'decisions' : 'tasks';
}

// Coerce any stored/absent entry into a clean { decisions: string[], tasks: string[] }.
function normalizeEntry(entry) {
  return {
    decisions: Array.isArray(entry?.decisions) ? entry.decisions.map(String) : [],
    tasks: Array.isArray(entry?.tasks) ? entry.tasks.map(String) : [],
  };
}

/** Load the saved point->items map for a discussion; returns {} on any failure. */
export async function loadPointItems(discussionId) {
  if (!discussionId) return {};
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const out = {};
        for (const [pid, entry] of Object.entries(saved)) out[String(pid)] = normalizeEntry(entry);
        return out;
      }
    }
  } catch {
    // storage unavailable / parse error — fall back to "no associations yet".
  }
  return {};
}

async function persist(discussionId, map) {
  try {
    await withTimeout(monday.storage.setItem(key(discussionId), JSON.stringify(map)));
  } catch (err) {
    logger.warn('pointItems', 'שמירת קישור הנקודה להחלטות/משימות נכשלה', err);
  }
}

/** Read a point's decision/task ids off a LOADED map (pure; [] when absent). */
export function getPointItemIds(map, pointId, kind) {
  const entry = map?.[String(pointId)];
  if (!entry) return [];
  const arr = entry[bucketOf(kind)];
  return Array.isArray(arr) ? arr.map(String) : [];
}

/** Append an id under a point/kind, returning a NEW map (pure). Returns the SAME
 *  map reference when the id is already present, so callers can skip a write. */
export function mergePointItemIn(map, pointId, kind, itemId) {
  const pid = String(pointId);
  const id = String(itemId);
  const bucket = bucketOf(kind);
  const entry = normalizeEntry(map?.[pid]);
  if (entry[bucket].includes(id)) return map || {};
  return {
    ...(map || {}),
    [pid]: { ...entry, [bucket]: [...entry[bucket], id] },
  };
}

/** Persist a newly-created decision/task under its origin point (load->merge->save).
 *  kind: 'decision' | 'task'. No-op when ids are missing or already recorded. */
export async function addPointItem(discussionId, pointId, kind, itemId) {
  if (!discussionId || !pointId || itemId == null) return;
  const current = await loadPointItems(discussionId);
  const next = mergePointItemIn(current, pointId, kind, itemId);
  if (next === current) return; // already recorded — nothing to write
  await persist(discussionId, next);
}

/** Drop stored ids that no longer exist among the discussion's loaded items.
 *  A kind is pruned ONLY when its `valid` list is non-empty — an empty list
 *  usually means "not loaded / fetch failed", and wiping the store on that would
 *  lose good data (the count intersects with the loaded list anyway, so leaving
 *  stale ids is harmless). Persists only when something actually changed;
 *  returns the (possibly unchanged) map. */
export async function prunePointItems(discussionId, valid) {
  if (!discussionId) return {};
  const current = await loadPointItems(discussionId);
  const pruneDecisions = Array.isArray(valid?.decisions) && valid.decisions.length > 0;
  const pruneTasks = Array.isArray(valid?.tasks) && valid.tasks.length > 0;
  if (!pruneDecisions && !pruneTasks) return current;
  const decisionsOk = new Set((valid?.decisions || []).map(String));
  const tasksOk = new Set((valid?.tasks || []).map(String));
  let changed = false;
  const next = {};
  for (const [pid, entry] of Object.entries(current)) {
    const curDecisions = entry.decisions || [];
    const curTasks = entry.tasks || [];
    const decisions = pruneDecisions ? curDecisions.filter((id) => decisionsOk.has(id)) : curDecisions;
    const tasks = pruneTasks ? curTasks.filter((id) => tasksOk.has(id)) : curTasks;
    if (decisions.length !== curDecisions.length || tasks.length !== curTasks.length) changed = true;
    if (decisions.length || tasks.length) next[pid] = { decisions, tasks };
  }
  if (!changed) return current;
  await persist(discussionId, next);
  return next;
}

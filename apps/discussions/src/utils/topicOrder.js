/*
 * Per-discussion ordering for topics and their points.
 *
 * monday's public GraphQL API has no item/subitem "position" mutation, so the
 * order a user sets by dragging can't be persisted as native board order.
 * Instead we keep an explicit order map per discussion in monday.storage
 * (mirroring SettingsContext/TemplatesContext), and sort the fetched topics +
 * points by it on every read.
 *
 * Stored shape (key `discussions_topic_order_${discussionId}`):
 *   { topics: string[], points: { [topicId]: string[] } }
 *
 * applyOrder() is defensive: ids present in the saved order render first in
 * that order; unknown ids (created elsewhere) keep their API order at the end;
 * stale ids (deleted) are dropped.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_topic_order';
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

/** Load the saved order map; returns { topics: [], points: {} } on any failure. */
export async function loadOrder(discussionId) {
  if (!discussionId) return { topics: [], points: {} };
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      return {
        topics: Array.isArray(saved?.topics) ? saved.topics.map(String) : [],
        points: saved?.points && typeof saved.points === 'object' ? saved.points : {},
      };
    }
  } catch {
    // storage unavailable / parse error — fall back to natural order.
  }
  return { topics: [], points: {} };
}

async function persist(discussionId, order) {
  try {
    await monday.storage.setItem(key(discussionId), JSON.stringify(order));
  } catch (err) {
    logger.warn('topicOrder', 'שמירת סדר הנושאים/נקודות נכשלה', err);
  }
}

/** Persist a new topic order (array of topic ids). */
export async function saveTopicOrder(discussionId, topicIds) {
  if (!discussionId) return;
  const current = await loadOrder(discussionId);
  await persist(discussionId, { ...current, topics: topicIds.map(String) });
}

/** Persist the complete order for a newly-created discussion in one write.
 * Fresh discussions cannot have an existing order, so reading storage first
 * only adds another serialized iframe bridge round-trip. */
export async function saveFreshTopicOrder(discussionId, order) {
  if (!discussionId) return;
  const topics = Array.isArray(order?.topics) ? order.topics.map(String) : [];
  const points = {};
  if (order?.points && typeof order.points === 'object') {
    Object.entries(order.points).forEach(([topicId, pointIds]) => {
      points[String(topicId)] = Array.isArray(pointIds) ? pointIds.map(String) : [];
    });
  }
  await persist(discussionId, { topics, points });
}

/** Persist a new point order for one topic (array of point ids). */
export async function savePointOrder(discussionId, topicId, pointIds) {
  if (!discussionId || !topicId) return;
  const current = await loadOrder(discussionId);
  await persist(discussionId, {
    ...current,
    points: { ...current.points, [String(topicId)]: pointIds.map(String) },
  });
}

/** Sort an array of {id} objects by a saved id order; unknown ids keep their
 *  relative position at the end, deleted ids are naturally dropped. */
function sortByIds(arr, orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return arr;
  const rank = new Map(orderIds.map((id, i) => [String(id), i]));
  return [...arr].sort((a, b) => {
    const ra = rank.has(String(a.id)) ? rank.get(String(a.id)) : Infinity;
    const rb = rank.has(String(b.id)) ? rank.get(String(b.id)) : Infinity;
    if (ra !== rb) return ra - rb;
    return 0; // keep stable (API) order among unknowns
  });
}

/** Apply a saved order map to freshly-fetched topics (each with _subitems). */
export function applyOrder(topics, order) {
  if (!order) return topics;
  const orderedTopics = sortByIds(topics, order.topics);
  return orderedTopics.map((t) => ({
    ...t,
    _subitems: sortByIds(t._subitems || [], order.points?.[String(t.id)]),
  }));
}

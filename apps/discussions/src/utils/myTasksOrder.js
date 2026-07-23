/*
 * round208 — MOBILE manual ordering for "המשימות שלי". monday's public API has
 * no item-position mutation, so (like topicOrder.js) the drag-reorder lives in
 * monday.storage as an explicit per-USER order list of task ids, saved on drop
 * and re-applied on every read. Defensive apply: saved ids first (in saved
 * order), unknown/new ids keep their API order at the end, deleted ids drop out.
 *
 * Key: discussions_mytasks_order_${userId} → { order: string[] }
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const KEY_BASE = 'discussions_mytasks_order';
const TIMEOUT_MS = 5000;

const storageKey = (userId) => `${KEY_BASE}_${userId || 'me'}`;

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

/** The user's saved manual order (array of task ids as strings), or []. */
export async function loadMyTasksOrder(userId) {
  try {
    const res = await withTimeout(monday.storage.getItem(storageKey(userId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (Array.isArray(saved?.order)) return saved.order.map(String);
    }
  } catch (err) {
    logger.warn('myTasksOrder', 'קריאת סדר המשימות הידני נכשלה — מוצג סדר ברירת המחדל', err);
  }
  return [];
}

/** Persist the manual order (fire-and-forget; a failure only loses the order). */
export async function saveMyTasksOrder(userId, ids) {
  try {
    const order = (Array.isArray(ids) ? ids : []).map(String);
    await withTimeout(monday.storage.setItem(storageKey(userId), JSON.stringify({ order })));
  } catch (err) {
    logger.warn('myTasksOrder', 'שמירת סדר המשימות הידני נכשלה', err);
  }
}

/**
 * Re-apply a saved manual order over a task list: saved ids first (in saved
 * order), tasks not in the saved list keep their incoming order at the end.
 * An empty/missing order returns the list untouched (same reference).
 */
export function applyManualOrder(items, order) {
  if (!Array.isArray(items) || items.length === 0) return items;
  if (!Array.isArray(order) || order.length === 0) return items;
  const pos = new Map(order.map((id, i) => [String(id), i]));
  const known = [];
  const unknown = [];
  items.forEach((t) => { (pos.has(String(t?.id)) ? known : unknown).push(t); });
  if (known.length === 0) return items;
  known.sort((a, b) => pos.get(String(a.id)) - pos.get(String(b.id)));
  return [...known, ...unknown];
}

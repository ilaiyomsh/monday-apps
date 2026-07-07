/*
 * Per-discussion Summary update id.
 *
 * The discussion summary is stored as a SINGLE editable monday Update on the
 * discussion item (create_update once, edit_update thereafter). monday has no
 * API to "find my app's summary update", so we remember the update's id here in
 * monday.storage, keyed per discussion — mirroring topicOrder/Settings/Templates
 * (JSON value, 5s timeout, graceful fallback when storage is unavailable).
 *
 * Stored shape (key `discussions_summary_update_${discussionId}`):
 *   { updateId: string }
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_summary_update';
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

/** Load the stored summary update id for a discussion; null on any failure. */
export async function loadSummaryUpdateId(discussionId) {
  if (!discussionId) return null;
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      return saved?.updateId ? String(saved.updateId) : null;
    }
  } catch {
    // storage unavailable / parse error — treat as "no summary yet".
  }
  return null;
}

/** Persist the summary update id for a discussion. */
export async function saveSummaryUpdateId(discussionId, updateId) {
  if (!discussionId || !updateId) return;
  try {
    await withTimeout(
      monday.storage.setItem(key(discussionId), JSON.stringify({ updateId: String(updateId) }))
    );
  } catch (err) {
    logger.warn('summaryStore', 'שמירת מזהה עדכון הסיכום נכשלה', err);
  }
}

/** Forget the stored summary update id (e.g. after the update was deleted). */
export async function clearSummaryUpdateId(discussionId) {
  if (!discussionId) return;
  try {
    await withTimeout(monday.storage.deleteItem(key(discussionId)));
  } catch (err) {
    logger.warn('summaryStore', 'מחיקת מזהה עדכון הסיכום נכשלה', err);
  }
}

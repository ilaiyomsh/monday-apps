/*
 * Per-discussion "discussed" (נדון) point flags.
 *
 * "Discussed" is a LIVE, DISPLAY-ONLY marker used while running a meeting to tick
 * off points as they're covered. By product decision it is NOT a board column and
 * does NOT affect the export — it only needs to survive a reload. So we keep the
 * set of discussed point ids in monday.storage, keyed per discussion, mirroring
 * summaryStore/topicOrder/Settings/Templates (JSON value, 5s timeout, graceful
 * fallback when storage is unavailable — e.g. local dev).
 *
 * Stored shape (key `discussions_discussed_${discussionId}`):
 *   { pointIds: string[] }
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_discussed';
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

/** Load the set of discussed point ids for a discussion; empty Set on any failure. */
export async function loadDiscussedPointIds(discussionId) {
  if (!discussionId) return new Set();
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (Array.isArray(saved?.pointIds)) return new Set(saved.pointIds.map(String));
    }
  } catch {
    // storage unavailable / parse error — treat as "nothing discussed yet".
  }
  return new Set();
}

/** Persist the full set of discussed point ids for a discussion. */
export async function saveDiscussedPointIds(discussionId, pointIds) {
  if (!discussionId) return;
  try {
    const arr = Array.from(pointIds || []).map(String);
    await withTimeout(monday.storage.setItem(key(discussionId), JSON.stringify({ pointIds: arr })));
  } catch (err) {
    logger.warn('discussedStore', 'שמירת מצב "נדון" נכשלה', err);
  }
}

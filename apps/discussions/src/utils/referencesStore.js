/*
 * Per-discussion References ("התייחסויות") update id — round200.
 *
 * The references box (TopicsTab's right-hand panel) is stored as a SINGLE
 * editable monday Update on the discussion item, EXACTLY like the Summary
 * (create_update once, edit_update thereafter). Each box tracks its OWN update
 * id under its OWN storage key, so the two boxes can never collide: the summary
 * edits its update, the references box edits this one.
 *
 * Stored shape (key `discussions_references_update_${discussionId}`):
 *   { updateId: string }
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_references_update';
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

/** Load the stored references update id for a discussion; null on any failure. */
export async function loadReferencesUpdateId(discussionId) {
  if (!discussionId) return null;
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      return saved?.updateId ? String(saved.updateId) : null;
    }
  } catch (err) {
    // storage unavailable / parse error — treat as "no references yet".
    logger.warn('referencesStore', 'קריאת מזהה עדכון ההתייחסויות נכשלה — מתחילים ריק', err);
  }
  return null;
}

/** Remember the references update id for a discussion (best-effort). */
export async function saveReferencesUpdateId(discussionId, updateId) {
  if (!discussionId || !updateId) return;
  try {
    await withTimeout(
      monday.storage.setItem(key(discussionId), JSON.stringify({ updateId: String(updateId) }))
    );
  } catch (err) {
    logger.warn('referencesStore', 'שמירת מזהה עדכון ההתייחסויות נכשלה', err);
  }
}

/** Forget a stored id (the update was deleted out from under us). */
export async function clearReferencesUpdateId(discussionId) {
  if (!discussionId) return;
  try {
    await withTimeout(monday.storage.deleteItem(key(discussionId)));
  } catch (err) {
    logger.warn('referencesStore', 'מחיקת מזהה עדכון ההתייחסויות נכשלה', err);
  }
}

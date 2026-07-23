/*
 * Per-discussion Background ("רקע") stores — round204.
 *
 * The background box (the top collapsible panel in the ניהול-דיון tab) is a
 * SINGLE editable monday Update on the discussion item, exactly like the
 * Summary and References boxes — each box tracks its OWN update id under its
 * OWN storage key, so the three can never collide.
 *
 * Two keys per discussion:
 *   discussions_background_update_${id} → { updateId }
 *   discussions_background_links_${id}  → { links: [{ id, url, label }] }
 * (preparation links are app-local — monday has no per-update link list).
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const UPDATE_KEY_BASE = 'discussions_background_update';
const LINKS_KEY_BASE = 'discussions_background_links';
const TIMEOUT_MS = 5000;

const updateKey = (discussionId) => `${UPDATE_KEY_BASE}_${discussionId}`;
const linksKey = (discussionId) => `${LINKS_KEY_BASE}_${discussionId}`;

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

/** Load the stored background update id for a discussion; null on any failure. */
export async function loadBackgroundUpdateId(discussionId) {
  if (!discussionId) return null;
  try {
    const res = await withTimeout(monday.storage.getItem(updateKey(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      return saved?.updateId ? String(saved.updateId) : null;
    }
  } catch (err) {
    // storage unavailable / parse error — treat as "no background yet".
    logger.warn('backgroundStore', 'קריאת מזהה עדכון הרקע נכשלה — מתחילים ריק', err);
  }
  return null;
}

/** Remember the background update id for a discussion (best-effort). */
export async function saveBackgroundUpdateId(discussionId, updateId) {
  if (!discussionId || !updateId) return;
  try {
    await withTimeout(
      monday.storage.setItem(updateKey(discussionId), JSON.stringify({ updateId: String(updateId) }))
    );
  } catch (err) {
    logger.warn('backgroundStore', 'שמירת מזהה עדכון הרקע נכשלה', err);
  }
}

/** Forget a stored id (the update was deleted out from under us). */
export async function clearBackgroundUpdateId(discussionId) {
  if (!discussionId) return;
  try {
    await withTimeout(monday.storage.deleteItem(updateKey(discussionId)));
  } catch (err) {
    logger.warn('backgroundStore', 'מחיקת מזהה עדכון הרקע נכשלה', err);
  }
}

/** Load the discussion's preparation links; [] on any failure. */
export async function loadBackgroundLinks(discussionId) {
  if (!discussionId) return [];
  try {
    const res = await withTimeout(monday.storage.getItem(linksKey(discussionId)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (Array.isArray(saved?.links)) {
        return saved.links
          .filter((l) => l && l.url)
          .map((l) => ({ id: String(l.id || l.url), url: String(l.url), label: String(l.label || l.url) }));
      }
    }
  } catch (err) {
    logger.warn('backgroundStore', 'קריאת קישורי הרקע נכשלה — מתחילים ריק', err);
  }
  return [];
}

/** Persist the discussion's preparation links (best-effort, whole list). */
export async function saveBackgroundLinks(discussionId, links) {
  if (!discussionId) return;
  try {
    await withTimeout(
      monday.storage.setItem(linksKey(discussionId), JSON.stringify({ links: links || [] }))
    );
  } catch (err) {
    logger.warn('backgroundStore', 'שמירת קישורי הרקע נכשלה', err);
  }
}

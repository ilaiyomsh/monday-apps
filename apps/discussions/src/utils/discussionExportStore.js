/*
 * round207 — PER-DISCUSSION export overrides (the export dialog's "בשונה
 * מברירת המחדל"): a discussion may carry its own export template (sections
 * order/visibility, header/footer config, font, header mode) and its own
 * assets override (e.g. a different uploaded template .docx). Stored per
 * discussion in monday.storage; null = use the instance defaults.
 *
 * Keys:
 *   discussions_export_template_${id} → { template }
 *   discussions_export_assets_${id}   → { assets }  (only when the user changed
 *                                        them in the dialog — may be large)
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const TEMPLATE_KEY_BASE = 'discussions_export_template';
const ASSETS_KEY_BASE = 'discussions_export_assets';
const TIMEOUT_MS = 5000;

const templateKey = (id) => `${TEMPLATE_KEY_BASE}_${id}`;
const assetsKey = (id) => `${ASSETS_KEY_BASE}_${id}`;

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

async function loadJson(key, field, warnMsg) {
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      return saved?.[field] ?? null;
    }
  } catch (err) {
    logger.warn('discussionExportStore', warnMsg, err);
  }
  return null;
}

/** The discussion's own export template, or null (use the instance default). */
export function loadDiscussionExportTemplate(discussionId) {
  if (!discussionId) return Promise.resolve(null);
  return loadJson(templateKey(discussionId), 'template', 'קריאת תבנית הייצוא של הדיון נכשלה — משתמשים בברירת המחדל');
}

/** Persist (or clear with null) the discussion's own export template. */
export async function saveDiscussionExportTemplate(discussionId, template) {
  if (!discussionId) return;
  try {
    if (template == null) await withTimeout(monday.storage.deleteItem(templateKey(discussionId)));
    else await withTimeout(monday.storage.setItem(templateKey(discussionId), JSON.stringify({ template })));
  } catch (err) {
    logger.warn('discussionExportStore', 'שמירת תבנית הייצוא של הדיון נכשלה', err);
  }
}

/** The discussion's own export assets override, or null (use the globals). */
export function loadDiscussionExportAssets(discussionId) {
  if (!discussionId) return Promise.resolve(null);
  return loadJson(assetsKey(discussionId), 'assets', 'קריאת נכסי הייצוא של הדיון נכשלה — משתמשים בברירת המחדל');
}

/** Persist (or clear with null) the discussion's own export assets. */
export async function saveDiscussionExportAssets(discussionId, assets) {
  if (!discussionId) return;
  try {
    if (assets == null) await withTimeout(monday.storage.deleteItem(assetsKey(discussionId)));
    else await withTimeout(monday.storage.setItem(assetsKey(discussionId), JSON.stringify({ assets })));
  } catch (err) {
    logger.warn('discussionExportStore', 'שמירת נכסי הייצוא של הדיון נכשלה — ייתכן שחריגה ממכסת האחסון', err);
  }
}

/*
 * round241 — per-discussion layout of the ניהול-דיון split (the אג'נדה box +
 * the triple box). Like topicOrder.js, this can't live on a board column, so it
 * persists in monday.storage per discussion.
 *
 * Stored shape (key `discussions_layout_${discussionId}`):
 *   { ratio: number, stacked: boolean }
 *   - ratio   → the AGENDA (first / physical-left) box's share of the row width,
 *               0..1, clamped to [MIN_RATIO, MAX_RATIO]. The triple box gets the
 *               rest, so growing one shrinks the other (owner spec).
 *   - stacked → when true the two boxes stack vertically (full width) instead of
 *               sitting side-by-side ("drag the box down, like a dashboard
 *               widget").
 *
 * Owner-only WRITES are enforced at the call site (only canManageSettings passes
 * a real save); everyone READS the saved layout, so the owner's arrangement is
 * what every viewer sees (same model as the shared saved views).
 *
 * The pure helpers (clampRatio / normalizeLayout / ratioFromDrag) hold the math
 * so it can be unit-tested — jsdom has no layout, so the pointer handlers in
 * TopicsTab that feed them can't be.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_layout';
const TIMEOUT_MS = 5000;

export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;
export const DEFAULT_LAYOUT = { ratio: 0.5, stacked: false };

function key(discussionId) {
  return `${STORAGE_KEY_BASE}_${discussionId}`;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

/** Clamp a raw ratio into [MIN_RATIO, MAX_RATIO]; non-finite falls back to 0.5. */
export function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return DEFAULT_LAYOUT.ratio;
  if (n < MIN_RATIO) return MIN_RATIO;
  if (n > MAX_RATIO) return MAX_RATIO;
  return n;
}

/** Coerce any stored/partial value into a valid { ratio, stacked } layout. */
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT };
  return {
    ratio: clampRatio(raw.ratio != null ? raw.ratio : DEFAULT_LAYOUT.ratio),
    stacked: raw.stacked === true,
  };
}

/**
 * New agenda ratio after a horizontal divider drag: the pointer moved `deltaPx`
 * (physical px, +ve = toward the physical LEFT-box's growth direction) across a
 * container `containerWidth` px wide, starting from `startRatio`. A zero/unknown
 * width leaves the ratio unchanged (guards a divide-by-zero). Result is clamped.
 */
export function ratioFromDrag(startRatio, deltaPx, containerWidth) {
  if (!containerWidth || containerWidth <= 0) return clampRatio(startRatio);
  return clampRatio(clampRatio(startRatio) + deltaPx / containerWidth);
}

/** Load the saved layout; returns DEFAULT_LAYOUT on any failure. */
export async function loadLayout(discussionId) {
  if (!discussionId) return { ...DEFAULT_LAYOUT };
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) return normalizeLayout(JSON.parse(res.data.value));
  } catch (err) {
    // storage unavailable / parse error — fall back to the default split.
    logger.warn('discussionLayout', 'טעינת פריסת הדיון נכשלה — ברירת מחדל', err);
  }
  return { ...DEFAULT_LAYOUT };
}

/** Persist a layout (owner-only at the call site). */
export async function saveLayout(discussionId, layout) {
  if (!discussionId) return;
  try {
    await monday.storage.setItem(key(discussionId), JSON.stringify(normalizeLayout(layout)));
  } catch (err) {
    logger.warn('discussionLayout', 'שמירת פריסת הדיון נכשלה', err);
  }
}

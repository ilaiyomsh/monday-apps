/*
 * round241 — per-discussion layout of the ניהול-דיון split (the אג'נדה box +
 * the triple box). Like topicOrder.js, this can't live on a board column, so it
 * persists in monday.storage per discussion.
 *
 * Stored shape (key `discussions_layout_${discussionId}`):
 *   { ratio: number, stacked: boolean, boxHeight: number|null }
 *   - ratio        → the AGENDA (first / physical-left) box's share of the row
 *                    width, 0..1, clamped to [MIN_RATIO, MAX_RATIO]. The triple
 *                    box gets the rest, so growing one shrinks the other (owner spec).
 *                    WIDTH is per-box adjustable via this ratio (round269 keeps it).
 *   - stacked      → when true the two boxes stack vertically (full width) instead
 *                    of sitting side-by-side ("drag the box down, like a dashboard
 *                    widget").
 *   - boxHeight    → round269 (owner request): ONE SHARED card height (px) for
 *                    BOTH boxes, clamped to [MIN_HEIGHT, MAX_HEIGHT], so the two
 *                    are ALWAYS the same height (dragging either resizes both).
 *                    null ⇒ use the responsive CSS default (--split-card-h).
 *                    Legacy per-box `agendaHeight`/`tripleHeight` (round251) and
 *                    the older single `height` migrate into `boxHeight` on read.
 *
 * Owner-only WRITES are enforced at the call site (only canManageSettings passes
 * a real save); everyone READS the saved layout, so the owner's arrangement is
 * what every viewer sees (same model as the shared saved views).
 *
 * The pure helpers (clampRatio / clampHeight / normalizeLayout / ratioFromDrag /
 * heightFromDrag) hold the math so it can be unit-tested — jsdom has no layout,
 * so the pointer handlers in TopicsTab that feed them can't be.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_layout';
const TIMEOUT_MS = 5000;

export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;
export const MIN_HEIGHT = 360;
export const MAX_HEIGHT = 1400;
// round296 — default AGENDA share is 60% (triple box 40%), owner request. The
// per-instance preference (settings.preferences.defaultLayoutRatio) overrides
// this at the call site (loadLayout's second arg); this constant is the ultimate
// fallback when no preference and no per-discussion layout exist.
export const DEFAULT_LAYOUT = { ratio: 0.6, stacked: false, boxHeight: null };

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

/** Clamp a raw height (px) into [MIN_HEIGHT, MAX_HEIGHT]; non-finite ⇒ null
 *  (meaning "use the responsive CSS default"). */
export function clampHeight(h) {
  if (h == null) return null;
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_HEIGHT) return MIN_HEIGHT;
  if (n > MAX_HEIGHT) return MAX_HEIGHT;
  return n;
}

/** Coerce any stored/partial value into a valid { ratio, stacked, boxHeight }.
 *  round269 — a single SHARED boxHeight. Legacy per-box heights (agendaHeight /
 *  tripleHeight, round251) and the older single `height` migrate into it on read:
 *  the first present value wins (agenda's, then triple's, then the old single),
 *  so an owner's saved height survives the upgrade. */
export function normalizeLayout(raw, defaultRatio) {
  // round296 — a MISSING ratio falls back to the per-instance default (owner's
  // Settings → העדפות value), not the hard-coded 0.6. A stored per-discussion
  // ratio always wins (that's the per-discussion override).
  const fallbackRatio = defaultRatio != null ? defaultRatio : DEFAULT_LAYOUT.ratio;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT, ratio: clampRatio(fallbackRatio) };
  const migrated = raw.boxHeight != null ? raw.boxHeight
    : raw.agendaHeight != null ? raw.agendaHeight
      : raw.tripleHeight != null ? raw.tripleHeight
        : raw.height;
  return {
    ratio: clampRatio(raw.ratio != null ? raw.ratio : fallbackRatio),
    stacked: raw.stacked === true,
    boxHeight: clampHeight(migrated),
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

/**
 * New card height for ONE box after a bottom resize-handle drag: `startHeightPx`
 * is that box's measured height at drag start, `deltaPx` the vertical pointer
 * delta (+ve = downward = taller). Result is clamped to [MIN_HEIGHT, MAX_HEIGHT].
 * round269 — drives the single SHARED boxHeight (both boxes resize together).
 */
export function heightFromDrag(startHeightPx, deltaPx) {
  return clampHeight(Number(startHeightPx) + deltaPx);
}

/** Load the saved layout for a discussion. `defaultRatio` (the per-instance
 *  preference) seeds the AGENDA share when this discussion has no saved layout;
 *  a discussion WITH a saved layout keeps its own ratio (per-discussion override).
 *  Returns the default split on any failure. */
export async function loadLayout(discussionId, defaultRatio) {
  const fallback = { ...DEFAULT_LAYOUT, ratio: clampRatio(defaultRatio != null ? defaultRatio : DEFAULT_LAYOUT.ratio) };
  if (!discussionId) return fallback;
  try {
    const res = await withTimeout(monday.storage.getItem(key(discussionId)));
    if (res?.data?.value) return normalizeLayout(JSON.parse(res.data.value), defaultRatio);
  } catch (err) {
    // storage unavailable / parse error — fall back to the default split.
    logger.warn('discussionLayout', 'טעינת פריסת הדיון נכשלה — ברירת מחדל', err);
  }
  return fallback;
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

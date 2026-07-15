/*
 * Per-instance, shared "group header colors" (round 77).
 *
 * A user right-clicks a GROUP BY header and picks a color from a palette; the
 * choice is remembered "from now on" for THAT header, for EVERY user of the
 * instance. monday has no board backing for this, so — exactly like
 * discussedStore / topicOrder / summaryStore — it lives in monday.storage:
 * JSON value, 5s timeout, instance-scoped key, graceful empty fallback when
 * storage is unavailable (local dev). Any user may read AND write it (the
 * feature is deliberately open to all, not owner-gated).
 *
 * Stored shape (key `discussions_group_colors_${scope}`, scope =
 * instanceId → boardId → 'default'):
 *   { colors: { [groupKey]: "#rrggbb" } }
 * `groupKey` is the group's stable identity (grp.key) — the status/priority
 * label id, the discussion id, the date-bucket key, etc. — so the color follows
 * the group across tabs and renders, not a transient row position.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_group_colors';
const TIMEOUT_MS = 5000;

// Resolve the storage scope from the monday context (mirrors SettingsContext's
// instanceId → boardId → 'default' fallback).
export function groupColorsScope(context) {
  return String(context?.instanceId || context?.boardId || 'default');
}

function key(scope) {
  return `${STORAGE_KEY_BASE}_${scope || 'default'}`;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

/** Load the { [groupKey]: hex } override map for a scope; {} on any failure. */
export async function loadGroupColors(scope) {
  try {
    const res = await withTimeout(monday.storage.getItem(key(scope)));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      if (saved && typeof saved.colors === 'object' && saved.colors) {
        // Normalize to string keys; drop any non-string color value.
        const out = {};
        for (const [k, v] of Object.entries(saved.colors)) {
          if (typeof v === 'string' && v) out[String(k)] = v;
        }
        return out;
      }
    }
  } catch (err) {
    // storage unavailable / parse error — no overrides (auto colors still apply).
    logger.warn('groupColors', 'טעינת צבעי הכותרות נכשלה — משתמשים בצבעים האוטומטיים', err);
  }
  return {};
}

/** Persist the full override map for a scope. */
export async function saveGroupColors(scope, colors) {
  try {
    const clean = {};
    for (const [k, v] of Object.entries(colors || {})) {
      if (typeof v === 'string' && v) clean[String(k)] = v;
    }
    await withTimeout(monday.storage.setItem(key(scope), JSON.stringify({ colors: clean })));
  } catch (err) {
    logger.warn('groupColors', 'שמירת צבע הכותרת נכשלה', err);
  }
}

// Pure reducers over the override map (exported for testing + reuse by the hook).
/** Set one group's override color, returning a NEW map. */
export function withGroupColor(colors, groupKey, hex) {
  return { ...(colors || {}), [String(groupKey)]: hex };
}
/** Clear one group's override (revert to the auto color), returning a NEW map. */
export function withoutGroupColor(colors, groupKey) {
  const next = { ...(colors || {}) };
  delete next[String(groupKey)];
  return next;
}

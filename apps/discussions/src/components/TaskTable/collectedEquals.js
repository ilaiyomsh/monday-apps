/*
 * round370 §2 — a value-level guard for the per-COLUMN collectors.
 *
 * The collectors report a hook's view object up into table state, and the setter
 * used to bail only on `===`. That made the table's stability depend entirely on
 * every collected hook memoizing its return value: one that didn't (useRelationItems,
 * before this round) turned the report-up effect into an infinite render loop that
 * froze the tab with nothing thrown and nothing logged.
 *
 * The hook is fixed at the source, so this is the second layer: comparing the
 * view's OWN fields one level deep means wrapper-identity churn degrades into a
 * no-op re-report instead of a freeze. It is deliberately SHALLOW — the payload
 * fields (`items`, `options`, `labels`) are arrays owned by the hook's state, so
 * their identity is the correct signal that the data itself changed; deep-comparing
 * them every render would cost more than the bug it guards.
 */
export function collectedEquals(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export default collectedEquals;

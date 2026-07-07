/*
 * Pure helper for applying a persisted column order to the CURRENTLY VISIBLE
 * columns. Defensive in the same spirit as topicOrder.applyOrder:
 *   - stored keys that are still visible keep their saved order
 *   - visible keys missing from storage (e.g. a newly-mapped column) are
 *     appended in their natural/default order
 *   - unknown / hidden keys in storage are dropped
 *   - `pinned` keys (frozen columns, e.g. the sticky name column) are forced to
 *     the FRONT in their natural order and are never reorderable
 *
 * Kept DOM-free so it can be unit-tested without rendering.
 */
export function applyColumnOrder(visibleKeys, storedOrder = [], pinned = ['name']) {
  const visible = Array.isArray(visibleKeys) ? visibleKeys : [];
  const stored = Array.isArray(storedOrder) ? storedOrder : [];
  const pinSet = new Set(pinned);
  const visSet = new Set(visible);

  const pinnedVisible = visible.filter((k) => pinSet.has(k));
  const movable = visible.filter((k) => !pinSet.has(k));
  const movableSet = new Set(movable);

  const fromStored = stored.filter((k) => movableSet.has(k));
  const seen = new Set(fromStored);
  const appended = movable.filter((k) => !seen.has(k));

  return [...pinnedVisible, ...fromStored, ...appended];
}

// Move the column `activeKey` to where `overKey` sits, returning a new ordered
// array. No-op (returns a copy) when either key is missing or they're equal.
export function moveColumn(order, activeKey, overKey) {
  const arr = [...order];
  const from = arr.indexOf(activeKey);
  const to = arr.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return arr;
  arr.splice(from, 1);
  arr.splice(to, 0, activeKey);
  return arr;
}

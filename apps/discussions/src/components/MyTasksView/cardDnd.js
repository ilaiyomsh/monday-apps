/*
 * round215 — MOBILE card drag-drop decision logic (pure, testable).
 *
 * One DndContext spans ALL the groups, so a card can be dropped either inside
 * its own group (reorder) or on a card of ANOTHER group (move). Moving between
 * groups is meaningful only for the mobile groupings (status / priority): the
 * task's column is written to the TARGET group's label id, and the card lands
 * at the drop position in the per-user manual order.
 *
 * Returns one of:
 *   { type: 'reorder', groupKey, ids }        — same-group drop; ids = the
 *                                               group's new id order
 *   { type: 'move', taskId, value, flat }     — cross-group drop; value = the
 *                                               target group's label id (null
 *                                               for the "ללא" bucket); flat =
 *                                               the FULL new manual order
 *   null                                      — nothing to do
 */
export function computeCardDrop({ grouped, groupCol, activeId, overId }) {
  if (!activeId || !overId || String(activeId) === String(overId)) return null;
  const aId = String(activeId);
  const oId = String(overId);
  const has = (g, id) => g.items.some((t) => String(t.id) === id);
  const src = (grouped || []).find((g) => has(g, aId));
  const dst = (grouped || []).find((g) => has(g, oId));
  if (!src || !dst) return null;

  if (src.key === dst.key) {
    const ids = src.items.map((t) => String(t.id));
    const from = ids.indexOf(aId);
    const to = ids.indexOf(oId);
    if (from === -1 || to === -1) return null;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, aId);
    return { type: 'reorder', groupKey: src.key, ids: next };
  }

  // Cross-group moves only make sense when the grouping maps to a writable
  // column (the mobile toggle offers exactly these two).
  if (groupCol !== 'status' && groupCol !== 'priority') return null;

  const flat = (grouped || []).flatMap((g) => {
    if (g.key === src.key) {
      return g.items.filter((t) => String(t.id) !== aId).map((t) => String(t.id));
    }
    if (g.key === dst.key) {
      const ids = g.items.map((t) => String(t.id));
      const idx = ids.indexOf(oId);
      return [...ids.slice(0, idx), aId, ...ids.slice(idx)];
    }
    return g.items.map((t) => String(t.id));
  });
  return { type: 'move', taskId: aId, value: dst.status ?? null, flat };
}

export default computeCardDrop;

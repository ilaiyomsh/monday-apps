// round239/240 — the ribbon drag drop-target math, extracted so it can be unit
// tested (jsdom has no layout, so the pointer handler itself can't be).
//
// `others` is the list of NON-dragged tiles in DOM order (which equals the
// logical/visibleTopics order), each `{ id, mid }` where `mid` is the tile's
// horizontal centre in viewport px. `cursorX` is the pointer x.
//
// Returns the id the dragged topic should land BEFORE (in logical order), or
// null to append at the logical end. Direction-agnostic: it detects reading
// direction from the tiles themselves (rtl ⇒ DOM-first tile sits to the RIGHT)
// and maps x to a monotonic reading key so the drop lands before the FIRST tile
// whose centre is past the cursor in reading order — for ANY tile, not just the
// rightmost pair (the round239 bug was a loop that always kept the last match).
export function computeRibbonDropTarget(others, cursorX) {
  if (!Array.isArray(others) || others.length === 0) return null;
  const rtl = others.length >= 2 ? others[0].mid > others[others.length - 1].mid : false;
  const key = (x) => (rtl ? -x : x);
  const ck = key(cursorX);
  const target = others.find((t) => key(t.mid) > ck);
  return target ? target.id : null;
}

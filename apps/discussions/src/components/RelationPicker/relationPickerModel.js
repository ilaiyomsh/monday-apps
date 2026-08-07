/*
 * round378 — the pure model behind the connected-board picker panel.
 *
 * The owner's reference is monday's own "Choose items" dropdown: a header, the
 * linked BOARD's name, a search box, then the candidates laid out as GROUP
 * SECTIONS — a coloured group title with the group's items under it, each item
 * carrying that group's colour as a bar on its inline-start edge. Everything the
 * panel needs to draw that is computed here, so the component stays markup.
 *
 * The two orders this exposes are the two monday offers, and the default matters:
 * BOARD order (groups in board order, items in position order) is what the panel
 * shows until the user asks otherwise, which is why `useRelationItems` stopped
 * name-sorting its candidates.
 */

export const ORDER_BOARD = 'board';
export const ORDER_ALPHA = 'alpha';

// monday's own light blue, used when a group carries no colour (or has no group).
export const DEFAULT_GROUP_COLOR = '#579bfc';

export const UNGROUPED_ID = '__ungrouped__';

/*
 * Search is a plain substring match, deliberately: the candidate names here are
 * Hebrew, and `localeCompare`-style collation has no substring equivalent that
 * behaves better. Matching is case-insensitive so an English-named item behaves
 * the way the same search does on monday.
 */
export function matchesQuery(name, query) {
  const q = String(query ?? '').trim();
  if (!q) return true;
  return String(name ?? '').toLowerCase().includes(q.toLowerCase());
}

/*
 * Candidates → the sections the panel renders.
 *
 * Group order follows FIRST APPEARANCE in the candidate list, which is monday's
 * board order because `items_page` returns items group by group. Sorting the
 * sections by title instead would silently reorder the board.
 *
 * A section survives only if it still holds a match, so searching collapses the
 * empty sections away instead of leaving bare titles behind.
 */
export function buildSections(candidates, { query = '', order = ORDER_BOARD } = {}) {
  const sections = [];
  const byId = new Map();

  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c?.id) continue;
    if (!matchesQuery(c.name, query)) continue;
    const gid = c.group?.id ? String(c.group.id) : UNGROUPED_ID;
    let section = byId.get(gid);
    if (!section) {
      section = {
        id: gid,
        // An ungrouped item gets NO title — the panel then renders its items with
        // no section header, rather than a header reading "ללא קבוצה".
        title: gid === UNGROUPED_ID ? '' : (c.group?.title || ''),
        color: (gid !== UNGROUPED_ID && c.group?.color) || DEFAULT_GROUP_COLOR,
        items: [],
      };
      byId.set(gid, section);
      sections.push(section);
    }
    section.items.push({ id: String(c.id), name: c.name || String(c.id) });
  }

  if (order === ORDER_ALPHA) {
    // Within a section only: alphabetical is about the ITEMS, and reordering the
    // sections too would lose the board's own group order in the same gesture.
    for (const s of sections) s.items.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  return sections;
}

// How many candidates a section list holds in total — the panel shows this next
// to the board name, and uses zero to decide between "empty" and "no match".
export function countItems(sections) {
  return (sections || []).reduce((n, s) => n + (s.items?.length || 0), 0);
}

export function nextOrder(order) {
  return order === ORDER_ALPHA ? ORDER_BOARD : ORDER_ALPHA;
}

export const ORDER_LABEL = {
  [ORDER_BOARD]: 'סדר הלוח',
  [ORDER_ALPHA]: 'לפי שם (א׳–ת׳)',
};

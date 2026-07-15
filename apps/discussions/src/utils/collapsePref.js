/*
 * round105 — shared "saved collapse-all default" decision.
 *
 * An OWNER can save (via the collapse-all button's bookmark) whether a grouped
 * view loads with all groups COLLAPSED or EXPANDED, for every user of the
 * instance — stored as `collapseAll` on the view's saved-view entry
 * (settings.preferences.savedViews.<view>). This is the pure load-time decision:
 * given the saved view + the currently-grouped list, return the `collapsed` map
 * to apply, or null when there's nothing to apply (no saved default / no groups).
 */
export function collapseMapForView(savedView, groups) {
  if (!savedView || savedView.collapseAll !== true) return null;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  return Object.fromEntries(groups.map((g) => [g.key, true]));
}

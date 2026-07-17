import { useCallback } from 'react';

/*
 * round143 (audit stage 4) — the ONE bulk-target resolver, extracted from the
 * five identical inline copies (TasksTab, PreviousTasksTab, MyTasksView,
 * MyDecisionsView, DecisionsTab).
 *
 * Semantics (unchanged from the inline copies): editing a row that is part of
 * a MULTI-selection fans the edit out to the whole selection; editing any
 * other row (or with a single/empty selection) targets that row alone. When a
 * capability is given, the set is filtered to the allowed subset — a mixed
 * selection applies only to what the user may edit and silently skips the
 * rest.
 *
 * `allow(cap, id)` is the view's per-row capability check. A view whose check
 * takes the ITEM rather than the id (DecisionsTab) passes an id→item adapter:
 *   useBatchTargets(selectedIds, (cap, id) => canDecision(cap, byId.get(String(id))))
 * Identity churns with the selection — call sites already read the LATEST
 * value through their useStableHandler wrappers.
 */
export function useBatchTargets(selectedIds, allow) {
  return useCallback((originId, cap) => {
    const base = (selectedIds.size > 1 && selectedIds.has(originId)) ? [...selectedIds] : [originId];
    return cap ? base.filter((id) => allow(cap, id)) : base;
  }, [selectedIds, allow]);
}

export default useBatchTargets;

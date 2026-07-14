/*
 * Pure helpers bridging DECISION rows into the shared My-Tasks client pipeline
 * (controls.js filterTasks/sortTasks + grouping.js groupMyTasks). Kept
 * React/DOM-free so they can be unit-tested like grouping.js.
 *
 * The shared pipeline is keyed to the TASKS alias names (statusID / priorityID /
 * deadlineID / discussionLinkID). Decision rows carry decisionStatusID /
 * decisionPriorityID / decisionDateID (discussionLinkID is already the same
 * alias on both boards), so instead of duplicating the whole pipeline we DERIVE
 * the pipeline aliases onto each row. The original decision aliases stay on the
 * row (spread), so the table cells and the optimistic-edit writes keep reading /
 * writing the real decision fields; the derived aliases are re-computed from
 * `items` on every render (useMemo in the view), so optimistic edits stay in sync.
 */

// Decision row -> pipeline row (adds statusID/priorityID/deadlineID views over
// the decision columns; keeps every original field).
export function toPipelineRow(decision) {
  return {
    ...decision,
    statusID: decision.decisionStatusID ?? null,
    priorityID: decision.decisionPriorityID ?? null,
    deadlineID: decision.decisionDateID ?? null,
  };
}

export function toPipelineRows(decisions) {
  return (Array.isArray(decisions) ? decisions : []).map(toPipelineRow);
}

// Resolve the single discussion a decision is linked to via its
// discussionLinkID board_relation ({ linkedItems, ids, text } from parseValue).
// Same resolution as MyTasksView's getTaskDiscussion — linkedItems first
// (canonical, carries `name`), tolerate a legacy `items` key, fall back to
// ids + the raw display text.
export function getDecisionDiscussion(decision) {
  const rel = decision?.discussionLinkID;
  if (!rel) return null;
  const first = (Array.isArray(rel.linkedItems) ? rel.linkedItems[0] : null)
    || (Array.isArray(rel.items) ? rel.items[0] : null);
  if (first?.id != null) return { id: String(first.id), name: first.name || rel.text || '' };
  const id = Array.isArray(rel.ids) ? rel.ids[0] : null;
  if (id != null) return { id: String(id), name: rel.text || '' };
  return null;
}

// A people value, always as an array.
function peopleArr(v) {
  return Array.isArray(v) ? v : [];
}

// EFFECTIVE decider = the actual decider(s) when set, else the creator as the
// default decider (round 27: a decision with a creator but an empty מחליט is
// treated as decided-by-its-creator). Display/logic fallback ONLY — the board is
// never written. Returns a people[] ({ id, name }) suitable for PersonList.
export function getEffectiveDecider(decision) {
  const decider = peopleArr(decision?.deciderID);
  if (decider.length > 0) return decider;
  return peopleArr(decision?.decisionCreatorID);
}

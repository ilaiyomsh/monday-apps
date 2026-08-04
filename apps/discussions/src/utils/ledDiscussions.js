/*
 * round224 — "משימות בדיונים שהובלתי" (owner mockup, approved): the My-Tasks
 * scope toggle's second mode shows ALL tasks from discussions the current user
 * LED — i.e. discussions where they are the מנהל (lead) or the מרכז
 * (coordinator); a discussion with NO lead AND NO coordinator at all counts
 * instead when the user CREATED it (owner spec).
 *
 * Pure helpers (no API/React) so the membership rule is unit-testable; the
 * fetch pipeline lives in useMyTasks.fetchLedTasksPage.
 */

const holds = (people, userId) =>
  Array.isArray(people) && people.some((p) => String(p?.id) === String(userId));

/**
 * The ids of the discussions the user "led": lead OR coordinator contains the
 * user; when BOTH columns are empty on a discussion, creator counts as the
 * fallback. Returns string ids, input order preserved.
 */
export function computeLedDiscussionIds(discussions, userId) {
  if (userId == null) return [];
  return (Array.isArray(discussions) ? discussions : [])
    .filter((d) => {
      if (holds(d?.discussionLeadID, userId) || holds(d?.discussionCoordinatorID, userId)) return true;
      const noLead = !Array.isArray(d?.discussionLeadID) || d.discussionLeadID.length === 0;
      const noCoord = !Array.isArray(d?.discussionCoordinatorID) || d.discussionCoordinatorID.length === 0;
      return noLead && noCoord && holds(d?.discussionCreatorID, userId);
    })
    .map((d) => String(d.id));
}

/**
 * The task ids linked to the led discussions (tasksBoardLinkID board_relation,
 * parsed to { ids }), deduped, led-discussion order preserved.
 */
/**
 * round305 — taskId → the parent discussion's ROLE people (lead / coordinator /
 * creator), for the led-discussion tasks only. The personal "בדיונים שהובלתי"
 * rows carry no discussion object, but some capabilities (שותפים) are granted to
 * the discussion's lead/coordinator/creator, so the resolver needs those people.
 * First discussion wins for a task linked to more than one.
 * @returns {Map<string, {discussionLeadID, discussionCoordinatorID, discussionCreatorID}>}
 */
export function mapLedTaskDiscussionRoles(discussions, ledIds) {
  const led = new Set((ledIds || []).map(String));
  const out = new Map();
  (Array.isArray(discussions) ? discussions : []).forEach((d) => {
    if (!led.has(String(d?.id))) return;
    const roles = {
      discussionLeadID: Array.isArray(d?.discussionLeadID) ? d.discussionLeadID : [],
      discussionCoordinatorID: Array.isArray(d?.discussionCoordinatorID) ? d.discussionCoordinatorID : [],
      discussionCreatorID: Array.isArray(d?.discussionCreatorID) ? d.discussionCreatorID : [],
    };
    (d?.tasksBoardLinkID?.ids || []).forEach((tid) => {
      const key = String(tid);
      if (!out.has(key)) out.set(key, roles);
    });
  });
  return out;
}

/**
 * round341 — decisionId → the parent discussion's ROLE people (creator / lead /
 * coordinator), for the personal "ההחלטות שלי" rows.
 *
 * The sibling of mapLedTaskDiscussionRoles, and it exists for the same reason: a personal
 * row carries no discussion object, but TIER_EXTRA_ROLE_SOURCES grants every decision
 * capability to the discussion's three manager roles, so the resolver needs those people
 * on the row itself. Without this the grant applies in the in-discussion החלטות tab and
 * silently does not in the personal list — two surfaces, one rule, different answers.
 *
 * Keyed off the DISCUSSION side (`decisionsBoardLinkID.ids`) rather than the decision's
 * own `discussionLinkID`, because that is the relation the discussions query returns.
 * First discussion wins for a decision linked to more than one.
 *
 * Pure.
 * @returns {Map<string, {discussionCreatorID, discussionLeadID, discussionCoordinatorID}>}
 */
export function mapDecisionDiscussionRoles(discussions) {
  const out = new Map();
  (Array.isArray(discussions) ? discussions : []).forEach((d) => {
    const roles = {
      discussionCreatorID: Array.isArray(d?.discussionCreatorID) ? d.discussionCreatorID : [],
      discussionLeadID: Array.isArray(d?.discussionLeadID) ? d.discussionLeadID : [],
      discussionCoordinatorID: Array.isArray(d?.discussionCoordinatorID) ? d.discussionCoordinatorID : [],
    };
    (d?.decisionsBoardLinkID?.ids || []).forEach((did) => {
      const key = String(did);
      if (!out.has(key)) out.set(key, roles);
    });
  });
  return out;
}

export function collectLedTaskIds(discussions, ledIds) {
  const led = new Set((ledIds || []).map(String));
  const out = [];
  const seen = new Set();
  (Array.isArray(discussions) ? discussions : []).forEach((d) => {
    if (!led.has(String(d?.id))) return;
    (d?.tasksBoardLinkID?.ids || []).forEach((tid) => {
      const key = String(tid);
      if (!seen.has(key)) { seen.add(key); out.push(key); }
    });
  });
  return out;
}

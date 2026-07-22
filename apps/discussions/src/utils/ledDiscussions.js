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

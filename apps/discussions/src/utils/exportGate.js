/*
 * round207 — the FIXED export rule (owner decision): the "ייצוא" action on a
 * discussion (row kebab / calendar chip) is available ONLY to the discussion's
 * CREATOR, its LEAD (מנהל דיון), its COORDINATOR (מרכז דיון) — and board
 * owners. Deliberately NOT a matrix capability (it replaced the exportDocs
 * advisory gate on this surface), mirroring the other fixed rules
 * (title rename, the summary/references boxes, hide topic/point).
 */

function holdsRole(item, alias, currentUser) {
  const people = item?.[alias];
  return Array.isArray(people)
    && people.some((p) => String(p?.id) === String(currentUser?.id));
}

/** May this user open the per-discussion export dialog for `item`? */
export function canExportDiscussion(item, { canManageSettings = false, currentUser = null } = {}) {
  if (canManageSettings) return true;
  if (!item || !currentUser) return false;
  return (
    holdsRole(item, 'discussionCreatorID', currentUser)
    || holdsRole(item, 'discussionLeadID', currentUser)
    || holdsRole(item, 'discussionCoordinatorID', currentUser)
  );
}

export default canExportDiscussion;

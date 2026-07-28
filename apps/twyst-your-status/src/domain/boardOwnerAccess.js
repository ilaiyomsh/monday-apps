/**
 * Board-owner gate for the settings surfaces — the ONE place that answers
 * "may this actor configure this column".
 *
 * Deliberately the INVERSE of the per-label rules in `statusPolicy`: an empty
 * `allowedUserIds` there means "everyone may pick that label", while an empty
 * owners list here means NOBODY. Configuration is not a permission you get by
 * default, so the gate fails closed — an actor we cannot identify is not an owner.
 *
 * A board can be owned by TEAMS as well as by users (monday's `team_owners`), and
 * an owner reached that way is just as much an owner, so team ownership is resolved
 * against the actor's own team membership rather than ignored.
 */

/**
 * monday returns ids as strings on some fields and numbers on others, and
 * `owners: [User]!` has NULLABLE elements — a deleted user arrives as a hole in
 * the list. Holes are dropped rather than stringified: `String(null)` would make
 * two unrelated holes compare equal and hand ownership to nobody in particular.
 */
function idSet(ids) {
  const set = new Set();
  for (const id of ids ?? []) {
    if (id == null) continue;
    set.add(String(id));
  }
  return set;
}

/**
 * @param {object} input
 * @param {string|number|null} input.userId  the acting user (monday context)
 * @param {Array<string|number|null>} [input.ownerIds]      board user owners
 * @param {Array<string|number|null>} [input.teamOwnerIds]  board team owners
 * @param {Array<string|number|null>} [input.userTeamIds]   teams the actor belongs to
 * @returns {boolean} true only when the actor is a board owner
 */
export function isBoardOwner({ userId, ownerIds, teamOwnerIds, userTeamIds } = {}) {
  if (userId == null || String(userId) === '') return false;

  if (idSet(ownerIds).has(String(userId))) return true;

  const owningTeams = idSet(teamOwnerIds);
  for (const teamId of idSet(userTeamIds)) {
    if (owningTeams.has(teamId)) return true;
  }

  return false;
}

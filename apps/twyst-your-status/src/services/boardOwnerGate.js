/**
 * Does the acting user own this board? — the round trips behind the settings gate.
 *
 * The decision itself lives in `domain/boardOwnerAccess`; this module only feeds it.
 *
 * A direct user owner is answered in ONE request. Team ownership costs two more, so it
 * is only asked when the actor is not already a user owner — the common case (a board's
 * own owner opening its settings) stays a single call.
 *
 * Anything that stops the check from running THROWS. A gate that answers `false` because
 * a request failed tells a genuine owner they are not one, and hides the failure while
 * doing it — the caller shows an error instead. The single sanctioned narrowing is a
 * missing teams:read scope, which `teamsAccess` degrades to "no teams" on its own.
 */

import { isBoardOwner } from '../domain/boardOwnerAccess.js';
import { GET_BOARD_OWNER_IDS } from './graphqlQueries.js';
import mondayService from './mondayService.js';
import { loadBoardTeamOwnerIds, loadUserTeamIds } from './teamsAccess.js';

export async function loadIsBoardOwner({ boardId, userId } = {}) {
  if (boardId == null || String(boardId).trim() === '') {
    throw new Error('Cannot resolve board ownership: boardId is missing from the monday context');
  }
  if (userId == null || String(userId).trim() === '') {
    throw new Error('Cannot resolve board ownership: userId is missing from the monday context');
  }

  const data = await mondayService.query(GET_BOARD_OWNER_IDS, {
    boardIds: [String(boardId)],
  });

  const board = data?.boards?.[0];
  if (!board) {
    throw new Error(`Cannot resolve board ownership: board ${boardId} returned no data`);
  }

  // Holes are left in place — isBoardOwner drops them.
  const ownerIds = (board.owners ?? []).map((owner) => owner?.id);
  if (isBoardOwner({ userId, ownerIds })) return true;

  const [boardTeams, userTeams] = await Promise.all([
    loadBoardTeamOwnerIds(boardId),
    loadUserTeamIds(userId),
  ]);

  return isBoardOwner({
    userId,
    ownerIds,
    teamOwnerIds: boardTeams.teamOwnerIds,
    userTeamIds: userTeams.teamIds,
  });
}

import logger from '../utils/logger.js';
import mondayService from './mondayService.js';
import {
  GET_ACCOUNT_TEAMS,
  GET_BOARD_TEAM_OWNER_IDS,
  GET_USER_TEAM_IDS,
} from './graphqlQueries.js';

/** One page of team owners — see GET_BOARD_TEAM_OWNER_IDS on why one is enough. */
const TEAM_OWNERS_PAGE_LIMIT = 100;

/**
 * Optional teams:read helpers. When the app version is missing teams:read,
 * monday returns UNAUTHORIZED_FIELD_OR_TYPE — we log and degrade instead of
 * failing the whole settings/picker load.
 */

export function isTeamsScopeError(error) {
  const message = String(error?.message ?? error ?? '');
  return (
    /UNAUTHORIZED_FIELD_OR_TYPE/i.test(message)
    || /missing required scopes/i.test(message)
    || (/teams/i.test(message) && /Unauthorized|scope/i.test(message))
    // monday iframe SDK often collapses soft GraphQL auth errors to this:
    || /Graphql validation errors/i.test(message)
  );
}

export async function loadAccountTeams() {
  try {
    const data = await mondayService.query(GET_ACCOUNT_TEAMS);
    return { teams: data?.teams ?? [], teamsAvailable: true };
  } catch (err) {
    if (isTeamsScopeError(err)) {
      logger.warn(
        'teamsAccess',
        'teams:read scope missing or unauthorized — team allowlists unavailable until the app version grants teams:read and installations reauthorize',
        err,
      );
      return { teams: [], teamsAvailable: false };
    }
    logger.error('teamsAccess', 'Failed to load account teams', err);
    throw err;
  }
}

/**
 * TEAM owners of a board — the half of board ownership that lives behind teams:read.
 *
 * A missing scope degrades to "no team owners" so the settings gate still answers from
 * the user-owner list; anything else RETHROWS, because a check that failed for another
 * reason must not be reported to the caller as a clean "not an owner".
 */
export async function loadBoardTeamOwnerIds(boardId) {
  if (boardId == null || String(boardId).trim() === '') {
    return { teamOwnerIds: [], teamsAvailable: true };
  }
  try {
    const data = await mondayService.query(GET_BOARD_TEAM_OWNER_IDS, {
      boardIds: [String(boardId)],
      limit: TEAM_OWNERS_PAGE_LIMIT,
    });
    const teamOwners = data?.boards?.[0]?.team_owners ?? [];
    return {
      // Holes are left in place — boardOwnerAccess.isBoardOwner drops them.
      teamOwnerIds: teamOwners.map((team) => team?.id),
      teamsAvailable: true,
    };
  } catch (err) {
    if (isTeamsScopeError(err)) {
      logger.warn(
        'teamsAccess',
        'teams:read scope missing — board team owners unavailable; the settings gate will match user owners only',
        err,
      );
      return { teamOwnerIds: [], teamsAvailable: false };
    }
    logger.error('teamsAccess', 'Failed to load board team owners', err);
    throw err;
  }
}

export async function loadUserTeamIds(userId) {
  if (userId == null || String(userId).trim() === '') {
    return { teamIds: [], teamsAvailable: true };
  }
  try {
    const data = await mondayService.query(GET_USER_TEAM_IDS, {
      userIds: [String(userId)],
    });
    const teams = data?.users?.[0]?.teams ?? [];
    return {
      teamIds: teams.map((team) => String(team.id)),
      teamsAvailable: true,
    };
  } catch (err) {
    if (isTeamsScopeError(err)) {
      logger.warn(
        'teamsAccess',
        'teams:read scope missing — actor team membership unavailable; allowlists will match users only',
        err,
      );
      return { teamIds: [], teamsAvailable: false };
    }
    logger.error('teamsAccess', 'Failed to load user team membership', err);
    throw err;
  }
}

/**
 * The settings gate's round trips.
 *
 * Two things are being pinned beyond the yes/no answer:
 *
 * 1. **A check that could not run THROWS.** It must never come back as a calm `false` —
 *    that would tell a real owner they are not one, and hide the failure while doing it.
 *    The only degradation allowed is a missing teams:read scope, which narrows the answer
 *    to user owners (teamsAccess owns that, and returns rather than throws).
 * 2. **A direct user owner costs ONE request.** The team lookups exist for boards owned
 *    through a team; making them unconditionally would put two extra calls in front of
 *    every owner opening settings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockLoadBoardTeamOwnerIds = vi.fn();
const mockLoadUserTeamIds = vi.fn();

vi.mock('./mondayService.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('./teamsAccess.js', () => ({
  loadBoardTeamOwnerIds: (...args) => mockLoadBoardTeamOwnerIds(...args),
  loadUserTeamIds: (...args) => mockLoadUserTeamIds(...args),
}));

const { loadIsBoardOwner } = await import('./boardOwnerGate.js');
const { GET_BOARD_OWNER_IDS } = await import('./graphqlQueries.js');

/** One board, `owners` as monday returns it. */
function boardWithOwners(owners) {
  return { boards: [{ id: '5501', owners }] };
}

describe('loadIsBoardOwner', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLoadBoardTeamOwnerIds.mockReset().mockResolvedValue({ teamOwnerIds: [], teamsAvailable: true });
    mockLoadUserTeamIds.mockReset().mockResolvedValue({ teamIds: [], teamsAvailable: true });
  });

  it('returns true for a direct user owner of the board', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }, { id: '4002' }]));

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).resolves.toBe(true);
  });

  it('asks monday for the board owners with the board id as a string', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));

    await loadIsBoardOwner({ boardId: 5501, userId: '4001' });

    expect(mockQuery).toHaveBeenCalledWith(GET_BOARD_OWNER_IDS, { boardIds: ['5501'] });
  });

  it('costs exactly one request for a direct owner — no team lookups', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));

    await loadIsBoardOwner({ boardId: '5501', userId: '4001' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockLoadBoardTeamOwnerIds).not.toHaveBeenCalled();
    expect(mockLoadUserTeamIds).not.toHaveBeenCalled();
  });

  it('returns true for a member of a team that owns the board', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));
    mockLoadBoardTeamOwnerIds.mockResolvedValue({ teamOwnerIds: ['77'], teamsAvailable: true });
    mockLoadUserTeamIds.mockResolvedValue({ teamIds: ['77', '88'], teamsAvailable: true });

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).resolves.toBe(true);
  });

  it('looks up the team owners of the board and the teams of the actor', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));

    await loadIsBoardOwner({ boardId: '5501', userId: '4002' });

    expect(mockLoadBoardTeamOwnerIds).toHaveBeenCalledWith('5501');
    expect(mockLoadUserTeamIds).toHaveBeenCalledWith('4002');
  });

  it('returns false for a user who owns neither directly nor through a team', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));
    mockLoadBoardTeamOwnerIds.mockResolvedValue({ teamOwnerIds: ['77'], teamsAvailable: true });
    mockLoadUserTeamIds.mockResolvedValue({ teamIds: ['88'], teamsAvailable: true });

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).resolves.toBe(false);
  });

  it('returns false rather than throwing when teams:read is missing and the actor owns nothing directly', async () => {
    mockQuery.mockResolvedValue(boardWithOwners([{ id: '4001' }]));
    mockLoadBoardTeamOwnerIds.mockResolvedValue({ teamOwnerIds: [], teamsAvailable: false });
    mockLoadUserTeamIds.mockResolvedValue({ teamIds: [], teamsAvailable: false });

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).resolves.toBe(false);
  });

  it('treats a null owners list as no user owners and still checks team ownership', async () => {
    mockQuery.mockResolvedValue(boardWithOwners(null));
    mockLoadBoardTeamOwnerIds.mockResolvedValue({ teamOwnerIds: ['77'], teamsAvailable: true });
    mockLoadUserTeamIds.mockResolvedValue({ teamIds: ['77'], teamsAvailable: true });

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).resolves.toBe(true);
  });

  it('throws when the board is missing from the response, instead of answering "not an owner"', async () => {
    mockQuery.mockResolvedValue({ boards: [] });

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).rejects.toThrow(/5501/);
  });

  it('throws when the board id is missing from the context', async () => {
    await expect(loadIsBoardOwner({ boardId: null, userId: '4002' })).rejects.toThrow(/boardId/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws when the acting user id is missing from the context', async () => {
    await expect(loadIsBoardOwner({ boardId: '5501', userId: null })).rejects.toThrow(/userId/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates a failed owners request', async () => {
    mockQuery.mockRejectedValue(new Error('Network Error'));

    await expect(loadIsBoardOwner({ boardId: '5501', userId: '4002' })).rejects.toThrow('Network Error');
  });
});

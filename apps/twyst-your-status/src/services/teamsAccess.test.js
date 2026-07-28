import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();

vi.mock('./mondayService.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const { isTeamsScopeError, loadBoardTeamOwnerIds } = await import('./teamsAccess.js');
const { GET_BOARD_TEAM_OWNER_IDS } = await import('./graphqlQueries.js');

describe('isTeamsScopeError', () => {
  it('detects monday teams scope / unauthorized field errors', () => {
    expect(isTeamsScopeError({
      message: "Unauthorized to load field 'Query.teams', Reason: missing required scopes.",
    })).toBe(true);
    expect(isTeamsScopeError({
      message: "Unauthorized to load field 'Query.users.teams', Reason: missing required scopes.",
    })).toBe(true);
    expect(isTeamsScopeError({
      message: 'Reason: missing required scopes.',
    })).toBe(true);
    expect(isTeamsScopeError(new Error('Graphql validation errors'))).toBe(true);
  });

  it('does not treat unrelated failures as a teams scope gap', () => {
    expect(isTeamsScopeError(new Error('הלוח לא נמצא'))).toBe(false);
    expect(isTeamsScopeError(new Error('Network Error'))).toBe(false);
  });
});

describe('loadBoardTeamOwnerIds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns the board team-owner ids and reports the teams scope as available', async () => {
    mockQuery.mockResolvedValue({
      boards: [{ id: '5501', team_owners: [{ id: '77' }, { id: 78 }] }],
    });

    await expect(loadBoardTeamOwnerIds('5501')).resolves.toEqual({
      teamOwnerIds: ['77', 78],
      teamsAvailable: true,
    });
  });

  it('asks for one page of team owners on the requested board, with the id as a string', async () => {
    mockQuery.mockResolvedValue({ boards: [{ id: '5501', team_owners: [] }] });

    await loadBoardTeamOwnerIds(5501);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(GET_BOARD_TEAM_OWNER_IDS, {
      boardIds: ['5501'],
      limit: 100,
    });
  });

  it('degrades to no team owners when teams:read is missing, instead of failing the check', async () => {
    mockQuery.mockRejectedValue(new Error(
      "Unauthorized to load field 'Board.team_owners', Reason: missing required scopes.",
    ));

    await expect(loadBoardTeamOwnerIds('5501')).resolves.toEqual({
      teamOwnerIds: [],
      teamsAvailable: false,
    });
  });

  it('rethrows a failure that is not a scope gap, so a broken check cannot read as "not an owner"', async () => {
    mockQuery.mockRejectedValue(new Error('Network Error'));

    await expect(loadBoardTeamOwnerIds('5501')).rejects.toThrow('Network Error');
  });

  it('returns no team owners when the board is absent from the response', async () => {
    mockQuery.mockResolvedValue({ boards: [] });

    await expect(loadBoardTeamOwnerIds('5501')).resolves.toEqual({
      teamOwnerIds: [],
      teamsAvailable: true,
    });
  });

  it('returns no team owners when the board reports none', async () => {
    mockQuery.mockResolvedValue({ boards: [{ id: '5501', team_owners: null }] });

    await expect(loadBoardTeamOwnerIds('5501')).resolves.toEqual({
      teamOwnerIds: [],
      teamsAvailable: true,
    });
  });

  it('skips the round trip entirely for a blank board id', async () => {
    await expect(loadBoardTeamOwnerIds('')).resolves.toEqual({
      teamOwnerIds: [],
      teamsAvailable: true,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

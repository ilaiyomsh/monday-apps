/*
 * Characterization tests for src/utils/mondayApi/subscribers.js (test-guard retrofit).
 *
 * api() is mocked at the module boundary; response fixtures are hand-shaped to the
 * documented GraphQL response forms this module was verified against live (2026-07 /
 * 2026-10 — see the module header). NOTE: they are NOT probe captures — this shakedown
 * runs with no monday API access, so probe-captured fixtures (test-guard rule 4) were
 * not possible; shapes follow the query text + the module's own documented contract.
 *
 * The photo selection is pinned to the modern form (`photo_url { small }`) so the
 * mapping through normalizePhoto (mocked with the same precedence head) is observable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../monday-client.js', () => ({
  api: apiMock,
  ensureUserPhotoSelection: vi.fn(async () => 'photo_url { small }'),
  // Boundary fake mirroring normalizePhoto's head precedence for the shapes used here.
  normalizePhoto: (u) => u?.photo_url?.small ?? u?.photo_thumb ?? null,
}));
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getAccountSlug,
  getBoardPeople,
  setBoardMembers,
  removeBoardMembers,
  addEveryoneTeam,
  removeTeamFromBoard,
  inviteUsersToAccount,
  ACCOUNT_ROLES,
} from '../subscribers.js';
import logger from '../../logger.js';

const BOARD_ID = '4567890123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getBoardPeople', () => {
  const boardsFixture = () => ({
    boards: [
      {
        board_kind: 'share',
        owners: [
          {
            id: '45678901',
            name: 'אילי שני',
            photo_url: { small: 'https://files.monday.com/photos/45678901/small.png' },
          },
        ],
        subscribers: [
          {
            id: '45678901',
            name: 'אילי שני',
            photo_url: { small: 'https://files.monday.com/photos/45678901/small.png' },
          },
          // numeric id + null photo — seen from local-dev tokens / users without avatars
          { id: 52345678, name: 'דנה לוי', photo_url: null },
        ],
      },
    ],
  });

  it('maps owners and subscribers to { id: string, name, photoUrl } with boardKind and empty teams', async () => {
    apiMock.mockResolvedValueOnce(boardsFixture());
    const res = await getBoardPeople(BOARD_ID);
    expect(res).toEqual({
      boardKind: 'share',
      owners: [
        {
          id: '45678901',
          name: 'אילי שני',
          photoUrl: 'https://files.monday.com/photos/45678901/small.png',
        },
      ],
      subscribers: [
        {
          id: '45678901',
          name: 'אילי שני',
          photoUrl: 'https://files.monday.com/photos/45678901/small.png',
        },
        { id: '52345678', name: 'דנה לוי', photoUrl: null },
      ],
      teams: [],
    });
  });

  it('queries owners+subscribers with the probed photo selection and a string board id, WITHOUT team_subscribers', async () => {
    apiMock.mockResolvedValueOnce(boardsFixture());
    await getBoardPeople(4567890123);
    const [query, variables, fnName] = apiMock.mock.calls[0];
    expect(variables).toEqual({ boardId: ['4567890123'] });
    expect(fnName).toBe('getBoardPeople');
    expect(query).toContain('board_kind');
    expect(query).toContain('owners { id name photo_url { small } }');
    expect(query).toContain('subscribers { id name photo_url { small } }');
    expect(query).not.toContain('team_subscribers'); // unauthorized for this app scope
  });

  it('falls back to empty arrays and null boardKind when the board is not found', async () => {
    apiMock.mockResolvedValueOnce({ boards: [] });
    await expect(getBoardPeople(BOARD_ID)).resolves.toEqual({
      boardKind: null,
      owners: [],
      subscribers: [],
      teams: [],
    });
  });
});

describe('setBoardMembers', () => {
  it('returns [] without calling the API when no valid numeric ids remain', async () => {
    await expect(setBoardMembers(BOARD_ID, [])).resolves.toEqual([]);
    await expect(setBoardMembers(BOARD_ID, ['abc', undefined])).resolves.toEqual([]);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('promotes with kind: owner and inlined numeric ids (case-insensitive kind)', async () => {
    apiMock.mockResolvedValueOnce({
      add_users_to_board: [{ id: '45678901' }, { id: '52345678' }],
    });
    const affected = await setBoardMembers(BOARD_ID, ['45678901', 52345678], 'OWNER');
    expect(affected).toEqual([{ id: '45678901' }, { id: '52345678' }]);
    const [query] = apiMock.mock.calls[0];
    expect(query).toContain(
      'add_users_to_board(board_id: 4567890123, user_ids: [45678901, 52345678], kind: owner)'
    );
  });

  it('defaults to kind: subscriber (the demote path) and coerces unknown kinds to subscriber', async () => {
    apiMock.mockResolvedValue({ add_users_to_board: [{ id: '45678901' }] });
    await setBoardMembers(BOARD_ID, ['45678901']);
    expect(apiMock.mock.calls[0][0]).toContain('kind: subscriber');
    await setBoardMembers(BOARD_ID, ['45678901'], 'admin');
    expect(apiMock.mock.calls[1][0]).toContain('kind: subscriber');
  });

  it('returns [] when the mutation returns no affected users', async () => {
    apiMock.mockResolvedValueOnce({ add_users_to_board: null });
    await expect(setBoardMembers(BOARD_ID, ['45678901'])).resolves.toEqual([]);
  });
});

describe('removeBoardMembers', () => {
  it('returns null without calling the API when no valid ids remain', async () => {
    await expect(removeBoardMembers(BOARD_ID, [])).resolves.toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('removes via delete_subscribers_from_board with inlined numeric ids and returns the removed users', async () => {
    apiMock.mockResolvedValueOnce({
      delete_subscribers_from_board: [{ id: '45678901' }, { id: '52345678' }],
    });
    const removed = await removeBoardMembers(BOARD_ID, ['45678901', '52345678']);
    expect(removed).toEqual([{ id: '45678901' }, { id: '52345678' }]);
    expect(apiMock.mock.calls[0][0]).toContain(
      'delete_subscribers_from_board(board_id: 4567890123, user_ids: [45678901, 52345678])'
    );
  });

  it('still returns the partial list when monday removed fewer users than requested', async () => {
    apiMock.mockResolvedValueOnce({
      delete_subscribers_from_board: [{ id: '45678901' }],
    });
    const removed = await removeBoardMembers(BOARD_ID, ['45678901', '52345678']);
    expect(removed).toEqual([{ id: '45678901' }]);
  });
});

describe('addEveryoneTeam / removeTeamFromBoard', () => {
  it('subscribes the account-wide team via add_teams_to_board with team id -1', async () => {
    apiMock.mockResolvedValueOnce({ add_teams_to_board: [{ id: '-1' }] });
    await expect(addEveryoneTeam(BOARD_ID)).resolves.toEqual([{ id: '-1' }]);
    expect(apiMock.mock.calls[0][0]).toContain(
      'add_teams_to_board(board_id: 4567890123, kind: subscriber, team_ids: [-1])'
    );
  });

  it('removeTeamFromBoard returns null without an API call for an empty team list', async () => {
    await expect(removeTeamFromBoard(BOARD_ID, [])).resolves.toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('removeTeamFromBoard deletes the given team ids and returns the affected teams', async () => {
    apiMock.mockResolvedValueOnce({ delete_teams_from_board: [{ id: '-1' }] });
    await expect(removeTeamFromBoard(BOARD_ID, ['-1'])).resolves.toEqual([{ id: '-1' }]);
    expect(apiMock.mock.calls[0][0]).toContain(
      'delete_teams_from_board(board_id: 4567890123, team_ids: [-1])'
    );
  });
});

describe('inviteUsersToAccount', () => {
  it('returns empty results without an API call when every email is blank', async () => {
    await expect(inviteUsersToAccount(['', '   '])).resolves.toEqual({
      invited: [],
      errors: [],
    });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('trims emails, drops blanks, and inlines them JSON-escaped with the MEMBER default role', async () => {
    apiMock.mockResolvedValueOnce({
      invite_users: { invited_users: [{ id: '61234567', name: 'נועם כהן' }], errors: [] },
    });
    const res = await inviteUsersToAccount([' noam@example.co.il ', '']);
    expect(res).toEqual({ invited: [{ id: '61234567', name: 'נועם כהן' }], errors: [] });
    expect(apiMock.mock.calls[0][0]).toContain(
      'invite_users(emails: ["noam@example.co.il"], user_role: MEMBER)'
    );
  });

  it('uppercases a known role and falls back to MEMBER for an unknown role', async () => {
    apiMock.mockResolvedValue({ invite_users: { invited_users: [], errors: [] } });
    await inviteUsersToAccount(['a@b.co'], 'view_only');
    expect(apiMock.mock.calls[0][0]).toContain('user_role: VIEW_ONLY');
    await inviteUsersToAccount(['a@b.co'], 'SUPERADMIN');
    expect(apiMock.mock.calls[1][0]).toContain('user_role: MEMBER');
  });

  it('surfaces per-email invite errors from the response', async () => {
    apiMock.mockResolvedValueOnce({
      invite_users: {
        invited_users: [],
        errors: [{ message: 'User already exists', code: 'USER_EXISTS', email: 'a@b.co' }],
      },
    });
    const res = await inviteUsersToAccount(['a@b.co']);
    expect(res.errors).toEqual([
      { message: 'User already exists', code: 'USER_EXISTS', email: 'a@b.co' },
    ]);
    expect(res.invited).toEqual([]);
  });

  it('exposes the four account roles invite_users accepts', () => {
    expect(ACCOUNT_ROLES).toEqual(['MEMBER', 'VIEW_ONLY', 'GUEST', 'ADMIN']);
  });
});

describe('getAccountSlug', () => {
  it('reads me.account.slug once and memoizes it for later calls', async () => {
    apiMock.mockResolvedValueOnce({ me: { account: { slug: 'yomsheni-il' } } });
    await expect(getAccountSlug()).resolves.toBe('yomsheni-il');
    await expect(getAccountSlug()).resolves.toBe('yomsheni-il');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

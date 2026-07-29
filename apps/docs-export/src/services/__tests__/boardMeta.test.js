/**
 * fetchBoardMeta — the settings panel's column picker depends on it, so a board
 * that is gone or unreachable must FAIL rather than present an empty column list
 * (which would let the owner "map" nothing and silently ship an empty report).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBoardMeta } from '../boardMeta';
import { BOARD_META_QUERY } from '../queries';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-client.js', () => ({ api: mocks.api }));

/** Shape as returned live by boards(ids:) { id name columns { id title type } }. */
const META = {
  boards: [
    {
      id: '18424252636',
      name: 'WZ-report',
      columns: [
        { id: 'name', title: 'Name', type: 'name' },
        { id: 'wzdate', title: 'WZ Date', type: 'date' },
        { id: 'wzpeople', title: 'WZ People', type: 'people' },
        { id: 'wzmirror', title: 'WZ Mirror', type: 'mirror' },
      ],
    },
  ],
};

beforeEach(() => {
  mocks.api.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBoardMeta', () => {
  it('returns the board name and every column as { id, title, type }', async () => {
    mocks.api.mockResolvedValue(META);

    await expect(fetchBoardMeta('18424252636')).resolves.toEqual({
      id: '18424252636',
      name: 'WZ-report',
      columns: [
        { id: 'name', title: 'Name', type: 'name' },
        { id: 'wzdate', title: 'WZ Date', type: 'date' },
        { id: 'wzpeople', title: 'WZ People', type: 'people' },
        { id: 'wzmirror', title: 'WZ Mirror', type: 'mirror' },
      ],
    });
  });

  it('sends the board id as a STRING inside an array (boards(ids:) takes [ID!])', async () => {
    mocks.api.mockResolvedValue(META);

    await fetchBoardMeta(18424252636);

    expect(mocks.api).toHaveBeenCalledWith(
      BOARD_META_QUERY,
      { boardId: ['18424252636'] },
      'fetchBoardMeta'
    );
  });

  it('tolerates a board with no columns and a null title', async () => {
    mocks.api.mockResolvedValue({ boards: [{ id: '1', name: null }] });

    await expect(fetchBoardMeta('1')).resolves.toEqual({ id: '1', name: '', columns: [] });
  });

  it('throws when the board is empty, null, or the whole node is missing', async () => {
    mocks.api.mockResolvedValueOnce({ boards: [] });
    await expect(fetchBoardMeta('1')).rejects.toThrow(/not found|not accessible/i);

    mocks.api.mockResolvedValueOnce({ boards: [null] });
    await expect(fetchBoardMeta('1')).rejects.toThrow(/not found|not accessible/i);

    mocks.api.mockResolvedValueOnce({});
    await expect(fetchBoardMeta('1')).rejects.toThrow(/not found|not accessible/i);
  });

  it.each([[''], [null], [undefined], ['undefined'], ['null'], ['NaN'], [NaN]])(
    'refuses the unusable board id %p without touching the API',
    async (boardId) => {
      await expect(fetchBoardMeta(boardId)).rejects.toThrow(/boardId/);
      expect(mocks.api).not.toHaveBeenCalled();
    }
  );

  // The cases above are all caught by the UNUSABLE_IDS literal set alone, so they
  // never exercise the NUMERIC check — which is the branch that actually matters,
  // because `ids: ["my board"]` is valid for [ID!]: monday accepts it and answers
  // with an empty list, turning a typo into "board not found / no permission" and
  // sending the owner to chase an access problem that does not exist. Refuse before
  // the wire, and spend no API call doing it.
  it.each([['abc'], ['my board'], ['123abc'], ['1.5'], ['-1'], ['1e5'], ['18424252636 x']])(
    'refuses the NON-NUMERIC board id %p without touching the API',
    async (boardId) => {
      await expect(fetchBoardMeta(boardId)).rejects.toThrow(
        /not a numeric monday board id|boardId/
      );
      expect(mocks.api).not.toHaveBeenCalled();
    }
  );
});

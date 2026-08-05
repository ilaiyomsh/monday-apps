/**
 * useBoardColumns — the target board's name + columns for the settings panel.
 *
 * The hook feeds TWO surfaces at once, which is what makes its edge cases matter:
 * the five role dropdowns (they need the real column list) and the BoardPicker's
 * "does this id resolve?" check (it needs the FAILURE, in Hebrew, while the owner
 * is still typing). So:
 *   - an empty/blank board id must not reach the API at all — a board_view boots
 *     with `boardId: ''` in settings, and `fetchBoardMeta` would throw on it;
 *   - a failure is DATA (an unresolvable id), not a crash, and must not raise an
 *     error toast on every keystroke — hence logger.warn, not logger.error;
 *   - a slow response for a PREVIOUS board id must never overwrite the current
 *     one: the owner types 1842…, then fixes a digit, and the stale answer for the
 *     abandoned id arrives last.
 *
 * `services/boardMeta` and `utils/logger` are mocked so the resolution ORDER can be
 * driven precisely and the warn arguments are assertable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { fetchBoardMeta } from '../../services/boardMeta';
import logger from '../../utils/logger';
import { useBoardColumns } from '../useBoardColumns';

vi.mock('../../services/boardMeta', () => ({ fetchBoardMeta: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const BOARD_A = '18424252636';
const BOARD_B = '18424252999';

const META_A = {
  id: BOARD_A,
  name: 'דיווחי ועדות אזוריות',
  columns: [
    { id: 'name', title: 'שם', type: 'name' },
    { id: 'mirror_committee', title: 'ועדה', type: 'mirror' },
    { id: 'date_report', title: 'תאריך דיווח', type: 'date' },
  ],
};

const META_B = { id: BOARD_B, name: 'לוח אחר', columns: [{ id: 'text1', title: 'טקסט', type: 'text' }] };

/** A promise plus its resolve/reject, so the test controls WHEN it settles. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('no board id yet', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['null', null],
  ])('does not call the API for %s, and reports a settled empty state', async (_label, boardId) => {
    const { result } = renderHook(() => useBoardColumns(boardId));

    expect(fetchBoardMeta).not.toHaveBeenCalled();
    expect(result.current).toEqual({ name: '', columns: [], isLoading: false, error: null });
  });
});

describe('a board that resolves', () => {
  it('starts loading, then exposes the board name and every column', async () => {
    const gate = deferred();
    fetchBoardMeta.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useBoardColumns(BOARD_A));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.columns).toEqual([]);
    expect(result.current.error).toBeNull();

    gate.resolve(META_A);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.name).toBe('דיווחי ועדות אזוריות');
    expect(result.current.columns).toEqual(META_A.columns);
    expect(result.current.error).toBeNull();
  });

  it('passes the board id through to fetchBoardMeta verbatim, exactly once', async () => {
    fetchBoardMeta.mockResolvedValue(META_A);

    const { result, rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: BOARD_A },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A re-render with the SAME id must not re-query the board.
    rerender({ id: BOARD_A });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchBoardMeta).toHaveBeenCalledTimes(1);
    expect(fetchBoardMeta).toHaveBeenCalledWith(BOARD_A);
  });

  it('trims the id before deciding it is present, but queries the trimmed value', async () => {
    fetchBoardMeta.mockResolvedValue(META_A);

    const { result } = renderHook(() => useBoardColumns(`  ${BOARD_A}  `));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchBoardMeta).toHaveBeenCalledWith(BOARD_A);
  });
});

describe('a board that does not resolve', () => {
  const failure = new Error('fetchBoardMeta: board 999 was not found or is not accessible to this user.');

  it('surfaces the error for display and keeps the column list empty', async () => {
    fetchBoardMeta.mockRejectedValue(failure);

    const { result } = renderHook(() => useBoardColumns('999'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(failure);
    expect(result.current.columns).toEqual([]);
    expect(result.current.name).toBe('');
  });

  it('logs a WARN, not an ERROR — an unresolvable id is expected while typing', async () => {
    fetchBoardMeta.mockRejectedValue(failure);

    const { result } = renderHook(() => useBoardColumns('999'));
    await waitFor(() => expect(result.current.error).toBe(failure));

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'useBoardColumns',
      'טעינת מטא-דאטה של הלוח נכשלה',
      failure,
      { boardId: '999' }
    );
  });

  it('clears the error once a good board id follows a bad one', async () => {
    fetchBoardMeta.mockRejectedValueOnce(failure).mockResolvedValueOnce(META_B);

    const { result, rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: '999' },
    });
    await waitFor(() => expect(result.current.error).toBe(failure));

    rerender({ id: BOARD_B });
    await waitFor(() => expect(result.current.name).toBe('לוח אחר'));

    expect(result.current.error).toBeNull();
    expect(result.current.columns).toEqual(META_B.columns);
  });
});

describe('stale responses', () => {
  it('ignores the answer for a board id the owner already moved away from', async () => {
    const slowA = deferred();
    const fastB = deferred();
    fetchBoardMeta.mockImplementation((id) => (id === BOARD_A ? slowA.promise : fastB.promise));

    const { result, rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: BOARD_A },
    });

    rerender({ id: BOARD_B });
    fastB.resolve(META_B);
    await waitFor(() => expect(result.current.name).toBe('לוח אחר'));

    // The abandoned board answers LAST — the classic overwrite.
    slowA.resolve(META_A);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.name).toBe('לוח אחר');
    expect(result.current.columns).toEqual(META_B.columns);
  });

  it('ignores a stale FAILURE too, so a bad old id cannot poison a good new one', async () => {
    const slowA = deferred();
    const fastB = deferred();
    fetchBoardMeta.mockImplementation((id) => (id === BOARD_A ? slowA.promise : fastB.promise));

    const { result, rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: BOARD_A },
    });

    rerender({ id: BOARD_B });
    fastB.resolve(META_B);
    await waitFor(() => expect(result.current.name).toBe('לוח אחר'));

    slowA.reject(new Error('board 18424252636 was not found'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.name).toBe('לוח אחר');
  });
});

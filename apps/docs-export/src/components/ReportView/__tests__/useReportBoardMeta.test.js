/**
 * useReportBoardMeta — the target board's name + column TYPES for the report surface.
 *
 * Its module header claims "the same stale-response discipline as hooks/useRangeItems",
 * and that claim is what this file exists to back: the guard was previously provable
 * only through ReportView, whose fixtures never change `settings.boardId`, so deleting
 * the sequence check left the whole suite green.
 *
 * Why the guard is not academic here: an owner CAN retarget the board while the app is
 * mounted (the settings panel writes `settings.boardId`, and SettingsContext re-emits).
 * Two board-meta reads then race, and a stale winner is silently wrong three ways at
 * once — the table headers come from the OLD board's column titles, the filename from
 * the OLD board's name, and the column TYPES handed to the range query no longer match
 * the ids, which is exactly the case that renders a mirror as an empty cell.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import logger from '../../../utils/logger';
import { useReportBoardMeta } from '../useReportBoardMeta';

const mocks = vi.hoisted(() => ({ fetchBoardMeta: vi.fn() }));
vi.mock('../../../services/boardMeta.js', () => ({ fetchBoardMeta: mocks.fetchBoardMeta }));

const OLD_BOARD = {
  id: '18424252636',
  name: 'דיווחי ועדות',
  columns: [{ id: 'wzdate', title: 'תאריך דיווח', type: 'date' }],
};

const NEW_BOARD = {
  id: '99999999999',
  name: 'לוח חדש',
  columns: [{ id: 'nwmirror', title: 'ועדה', type: 'mirror' }],
};

/** A promise whose settlement the test controls. */
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
  mocks.fetchBoardMeta.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useReportBoardMeta', () => {
  it('loads the board name and columns', async () => {
    mocks.fetchBoardMeta.mockResolvedValue(OLD_BOARD);

    const { result } = renderHook((id) => useReportBoardMeta(id), {
      initialProps: OLD_BOARD.id,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.name).toBe('דיווחי ועדות');
    expect(result.current.columns).toEqual(OLD_BOARD.columns);
    expect(result.current.error).toBeNull();
  });

  it('never asks when no board is mapped yet', async () => {
    const { result } = renderHook((id) => useReportBoardMeta(id), { initialProps: '' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchBoardMeta).not.toHaveBeenCalled();
    expect(result.current.columns).toEqual([]);
  });

  it('keeps the NEW board when the previous board read resolves last', async () => {
    const first = deferred();
    const second = deferred();
    mocks.fetchBoardMeta.mockImplementation((id) =>
      id === OLD_BOARD.id ? first.promise : second.promise
    );

    const { result, rerender } = renderHook((id) => useReportBoardMeta(id), {
      initialProps: OLD_BOARD.id,
    });
    await waitFor(() => expect(mocks.fetchBoardMeta).toHaveBeenCalledTimes(1));

    // The owner retargets the board while the first read is still in flight.
    rerender(NEW_BOARD.id);
    await waitFor(() => expect(mocks.fetchBoardMeta).toHaveBeenCalledTimes(2));

    // The NEW board answers first, the superseded one afterwards.
    await act(async () => {
      second.resolve(NEW_BOARD);
      await second.promise;
    });
    await act(async () => {
      first.resolve(OLD_BOARD);
      await first.promise;
    });

    expect(result.current.name).toBe('לוח חדש');
    expect(result.current.columns).toEqual(NEW_BOARD.columns);
  });

  it('does not let a superseded FAILURE clobber the board that loaded fine', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const first = deferred();
    const second = deferred();
    mocks.fetchBoardMeta.mockImplementation((id) =>
      id === OLD_BOARD.id ? first.promise : second.promise
    );

    const { result, rerender } = renderHook((id) => useReportBoardMeta(id), {
      initialProps: OLD_BOARD.id,
    });
    await waitFor(() => expect(mocks.fetchBoardMeta).toHaveBeenCalledTimes(1));
    rerender(NEW_BOARD.id);
    await waitFor(() => expect(mocks.fetchBoardMeta).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(NEW_BOARD);
      await second.promise;
    });
    await act(async () => {
      first.reject(new Error('board not found'));
      await first.promise.catch(() => {});
    });

    // The new board survives, and the dead read raises no error state for the user.
    expect(result.current.name).toBe('לוח חדש');
    expect(result.current.error).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs and surfaces the failure when the read for the CURRENT board rejects', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const boom = new Error('board not found');
    mocks.fetchBoardMeta.mockRejectedValue(boom);

    const { result } = renderHook((id) => useReportBoardMeta(id), {
      initialProps: OLD_BOARD.id,
    });

    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.columns).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('useReportBoardMeta');
    expect(errorSpy.mock.calls[0][2]).toBe(boom);
  });

  it('re-reads the same board on reload()', async () => {
    mocks.fetchBoardMeta
      .mockResolvedValueOnce(OLD_BOARD)
      .mockResolvedValueOnce({ ...OLD_BOARD, name: 'שם מעודכן' });

    const { result } = renderHook((id) => useReportBoardMeta(id), {
      initialProps: OLD_BOARD.id,
    });
    await waitFor(() => expect(result.current.name).toBe('דיווחי ועדות'));

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.name).toBe('שם מעודכן'));
    expect(mocks.fetchBoardMeta).toHaveBeenCalledTimes(2);
  });
});

/**
 * api() + assertNoGraphQLErrors — the seam that turns "HTTP 200 with errors[]"
 * into a thrown failure.
 *
 * safeApi deliberately does not throw on a GraphQL soft error; without the assert
 * every caller would read `undefined` off `data.boards[0]` and report success. The
 * assert must therefore (a) throw, (b) carry the monday error code, and (c) NOT log
 * again — safeApi already logged that same failure, and the inherited
 * correlationId is what collapses the pair into one record and one toast.
 *
 * Real client.js + real logger (the marker is produced inside logger.emit); only
 * the SDK is mocked, so attempt counts and arguments are exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../utils/logger';
import { api, assertNoGraphQLErrors } from '../monday-client';
import { MondayApiError } from '../client';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-sdk.js', () => ({
  monday: { api: mocks.api },
  default: { api: mocks.api },
  API_VERSION: '2026-04',
}));

const Q = 'query DocsExportBoardMeta($boardId: [ID!]) { boards(ids: $boardId) { name } }';

const softResponse = () => ({
  errors: [
    {
      message: 'This column type is not supported yet in the API',
      extensions: {
        code: 'InvalidColumnTypeException',
        status_code: 200,
        error_data: { column_id: null, actual_type: 'lookup' },
      },
    },
  ],
  data: { boards: [null] },
});

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

describe('api()', () => {
  it('returns res.data and sends the pinned apiVersion with the variables', async () => {
    mocks.api.mockResolvedValue({ data: { boards: [{ name: 'WZ-report' }] } });

    const data = await api(Q, { boardId: ['18424252636'] }, 'fetchBoardMeta');

    expect(data).toEqual({ boards: [{ name: 'WZ-report' }] });
    expect(mocks.api).toHaveBeenCalledWith(Q, {
      variables: { boardId: ['18424252636'] },
      apiVersion: '2026-04',
    });
  });

  it('defaults variables to {} and derives the caller name from the query', async () => {
    mocks.api.mockResolvedValue({ data: {} });
    const apiLogSpy = vi.spyOn(logger, 'api');

    await api('query DocsExportBoardOwners($b: [ID!]) { boards(ids: $b) { owners { id } } }');

    expect(mocks.api).toHaveBeenCalledWith(expect.any(String), {
      variables: {},
      apiVersion: '2026-04',
    });
    expect(apiLogSpy.mock.calls[0][0]).toBe('DocsExportBoardOwners');
  });

  it('throws MondayApiError on a soft error, carrying monday’s error code', async () => {
    mocks.api.mockResolvedValue(softResponse());

    let caught;
    try {
      await api(Q, { boardId: ['1'] }, 'fetchRangeItems');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MondayApiError);
    expect(caught.message).toBe('This column type is not supported yet in the API');
    expect(caught.errorCode).toBe('InvalidColumnTypeException');
    expect(caught.functionName).toBe('fetchRangeItems');
    expect(caught.response.data).toEqual({ boards: [null] });
  });

  it('logs a soft-error failure exactly ONCE and hands the thrown error the same correlationId', async () => {
    const soft = softResponse();
    mocks.api.mockResolvedValue(soft);
    const apiErrorSpy = vi.spyOn(logger, 'apiError');

    let caught;
    try {
      await api(Q, {}, 'fetchRangeItems');
    } catch (err) {
      caught = err;
    }

    expect(apiErrorSpy).toHaveBeenCalledTimes(1);
    expect(soft.__softErrorLoggedId).toBeDefined();
    expect(caught.correlationId).toBe(soft.__softErrorLoggedId);
    expect(caught.__loggedId).toBe(soft.__softErrorLoggedId);
  });

  it('throws a self-explaining error when the SDK answers nothing (no token outside the iframe)', async () => {
    mocks.api.mockResolvedValue(undefined);
    const apiErrorSpy = vi.spyOn(logger, 'apiError');

    await expect(api(Q, {}, 'fetchBoardMeta')).rejects.toThrow(/VITE_MONDAY_TOKEN/);
    expect(apiErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('passes retry:false through to safeApi so a non-idempotent call is attempted once', async () => {
    const err = new Error('Failed to fetch');
    mocks.api.mockRejectedValue(err);

    await expect(api(Q, {}, 'fn', { retry: false })).rejects.toBeInstanceOf(MondayApiError);
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
});

describe('assertNoGraphQLErrors()', () => {
  it('returns the response unchanged when there are no errors', () => {
    const res = { data: { x: 1 } };
    expect(assertNoGraphQLErrors(res)).toBe(res);
  });

  it('treats an EMPTY errors array as success (monday sends [] on clean responses)', () => {
    const res = { data: { x: 1 }, errors: [] };
    expect(assertNoGraphQLErrors(res)).toBe(res);
  });

  it('throws MondayApiError with the request context but WITHOUT logging again', () => {
    const apiErrorSpy = vi.spyOn(logger, 'apiError');
    const errorSpy = vi.spyOn(logger, 'error');

    let caught;
    try {
      assertNoGraphQLErrors(softResponse(), {
        functionName: 'fetchRangeItems',
        query: Q,
        variables: { boardId: ['1'] },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MondayApiError);
    expect(caught.errorCode).toBe('InvalidColumnTypeException');
    expect(caught.apiRequest).toEqual({
      query: Q,
      variables: { boardId: ['1'] },
      operationName: 'DocsExportBoardMeta',
    });
    expect(apiErrorSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

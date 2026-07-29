/**
 * safeApi — the single SDK wrapper. What these tests pin, and why:
 *
 *  - PRE-FLIGHT VALIDATION. `ids: [undefined]` / `ids: []` / the string "null" /
 *    NaN reach monday as syntactically valid GraphQL and come back as an empty
 *    result, so the bug reads as "no data". The validator must name them BEFORE
 *    the wire.
 *  - SOFT ERRORS DO NOT THROW HERE. monday answers HTTP 200 carrying `errors[]`
 *    (probe finding 4: a mirror rule in query_params → InvalidColumnTypeException
 *    with `data.boards:[null]`). safeApi logs that and RETURNS it; only
 *    assertNoGraphQLErrors throws. Preserving this split is what keeps one
 *    failure = one log = one toast, via the `__softErrorLoggedId` marker.
 *  - RETRY on the transient set only, and never on a soft error.
 *  - HARD ERRORS are wrapped in MondayApiError carrying the request context that
 *    ErrorDetailsModal renders.
 *
 * The SDK is mocked (not the dev-harness stub) because these assertions are about
 * the exact ARGUMENTS handed to monday.api and the exact number of attempts.
 * The logger is REAL — the correlationId/dedup marker is produced inside
 * logger.emit, so a mocked logger would make that behavior untestable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../utils/logger';
import { safeApi, MondayApiError, extractOperationName, _testHelpers } from '../client';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-sdk.js', () => ({
  monday: { api: mocks.api },
  default: { api: mocks.api },
  API_VERSION: '2026-04',
}));

const CLEAN_QUERY =
  'query DocsExportBoardMeta($boardId: [ID!]) { boards(ids: $boardId) { name } }';

/**
 * The verbatim mirror-filter failure captured live on 2026-07-29 (probe findings
 * §4 / FIXTURES): HTTP 200, errors[] present, and the whole board node nulled.
 */
const softResponse = () => ({
  errors: [
    {
      message: 'This column type is not supported yet in the API',
      locations: [{ line: 1, column: 61 }],
      path: ['boards', 0, 'items_page'],
      extensions: {
        code: 'InvalidColumnTypeException',
        status_code: 200,
        error_data: { column_id: null, actual_type: 'lookup' },
      },
    },
  ],
  data: { boards: [null] },
});

/** A rejected SDK call carrying monday's rate-limit envelope (retryable). */
const rateLimitError = () => {
  const err = new Error('Rate limit exceeded');
  err.data = {
    errors: [
      { message: 'Rate limit exceeded', extensions: { code: 'rate_limit_exceeded', status_code: 429 } },
    ],
  };
  return err;
};

beforeEach(() => {
  mocks.api.mockReset();
  // logger renders through console by design; silence it without mocking logger.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('validateQuery (pre-flight)', () => {
  it('names every suspicious literal that monday would accept and answer empty', () => {
    const bad =
      'query { items(ids: [undefined]) { id } boards(ids: []) { id } ' +
      'a(board_id: NaN) b(item_id: null) c(name: "null") }';
    const { valid, warnings } = _testHelpers.validateQuery(bad);
    expect(valid).toBe(false);
    expect(warnings).toHaveLength(5);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ids: [undefined]'),
        expect.stringContaining('ids: []'),
        expect.stringContaining('board_id: NaN'),
        expect.stringContaining('item_id: null'),
        expect.stringContaining('"null"'),
      ])
    );
  });

  it('passes a clean parameterised query with no warnings', () => {
    expect(_testHelpers.validateQuery(CLEAN_QUERY)).toEqual({ valid: true, warnings: [] });
  });

  it('rejects a missing or non-string query with a single explicit warning', () => {
    expect(_testHelpers.validateQuery(undefined)).toEqual({
      valid: false,
      warnings: ['Query is empty or not a string'],
    });
    expect(_testHelpers.validateQuery({ query: 'x' }).valid).toBe(false);
  });

  it('does not flag a clean query twice when validated repeatedly (regex lastIndex reset)', () => {
    expect(_testHelpers.validateQuery('query { boards(ids: []) { id } }').warnings).toHaveLength(1);
    expect(_testHelpers.validateQuery('query { boards(ids: []) { id } }').warnings).toHaveLength(1);
  });
});

describe('safeApi — request plumbing', () => {
  it('forwards variables and apiVersion to monday.api and returns the raw response', async () => {
    const raw = { data: { boards: [{ name: 'WZ-report' }] } };
    mocks.api.mockResolvedValue(raw);

    const res = await safeApi('fetchBoardMeta', CLEAN_QUERY, {
      variables: { boardId: ['18424252636'] },
      apiVersion: '2026-04',
    });

    expect(res).toBe(raw);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith(CLEAN_QUERY, {
      variables: { boardId: ['18424252636'] },
      apiVersion: '2026-04',
    });
  });

  it('calls monday.api with the query ALONE when there are no variables and no apiVersion', async () => {
    mocks.api.mockResolvedValue({ data: {} });
    await safeApi('fn', CLEAN_QUERY);
    expect(mocks.api).toHaveBeenCalledWith(CLEAN_QUERY);
  });
});

describe('safeApi — GraphQL soft errors (HTTP 200 with errors[])', () => {
  it('returns the soft-error response instead of throwing, and does not retry it', async () => {
    const soft = softResponse();
    mocks.api.mockResolvedValue(soft);

    const res = await safeApi('fetchRangeItems', CLEAN_QUERY, { variables: { a: 1 } });

    expect(res).toBe(soft);
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('logs the soft error once through logger.apiError with the raw response attached', async () => {
    const soft = softResponse();
    mocks.api.mockResolvedValue(soft);
    const apiErrorSpy = vi.spyOn(logger, 'apiError');

    await safeApi('fetchRangeItems', CLEAN_QUERY, { variables: { a: 1 } });

    expect(apiErrorSpy).toHaveBeenCalledTimes(1);
    expect(apiErrorSpy.mock.calls[0][0]).toBe('fetchRangeItems');
    expect(apiErrorSpy.mock.calls[0][1].message).toBe(
      'This column type is not supported yet in the API'
    );
    expect(apiErrorSpy.mock.calls[0][2]).toMatchObject({
      query: CLEAN_QUERY,
      variables: { a: 1 },
      rawResponse: soft,
    });
  });

  it('stamps __softErrorLoggedId on the response so the downstream throw is not logged twice', async () => {
    const soft = softResponse();
    mocks.api.mockResolvedValue(soft);

    const res = await safeApi('fetchRangeItems', CLEAN_QUERY);

    expect(res.__softErrorLoggedId).toBeDefined();
    // non-enumerable: it must never leak into JSON.stringify of the response
    expect(Object.keys(res)).not.toContain('__softErrorLoggedId');
  });
});

describe('safeApi — hard errors', () => {
  it('wraps a rejected call in MondayApiError carrying the full request context', async () => {
    mocks.api.mockRejectedValue(new Error('boom'));

    let caught;
    try {
      await safeApi('fetchBoardMeta', CLEAN_QUERY, { variables: { boardId: ['1'] } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MondayApiError);
    expect(caught.name).toBe('MondayApiError');
    expect(caught.message).toBe('boom');
    expect(caught.functionName).toBe('fetchBoardMeta');
    expect(caught.apiRequest).toEqual({
      query: CLEAN_QUERY,
      variables: { boardId: ['1'] },
      operationName: 'DocsExportBoardMeta',
    });
    expect(typeof caught.duration).toBe('number');
    // a plain Error is not retryable — exactly one attempt
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('serialises every diagnostic field through toJSON (ErrorDetailsModal payload)', async () => {
    mocks.api.mockRejectedValue(new Error('boom'));

    let caught;
    try {
      await safeApi('fetchBoardMeta', CLEAN_QUERY, { variables: { boardId: ['1'] } });
    } catch (err) {
      caught = err;
    }
    const json = caught.toJSON();

    expect(json.name).toBe('MondayApiError');
    expect(json.message).toBe('boom');
    expect(json.functionName).toBe('fetchBoardMeta');
    expect(json.apiRequest.operationName).toBe('DocsExportBoardMeta');
    expect(json.duration).toBe(caught.duration);
    expect(json.timestamp).toBe(caught.timestamp);
    expect(typeof json.stack).toBe('string');
  });

  it('logs the hard error through logger.apiError with the query and duration', async () => {
    mocks.api.mockRejectedValue(new Error('boom'));
    const apiErrorSpy = vi.spyOn(logger, 'apiError');

    await expect(safeApi('fn', CLEAN_QUERY)).rejects.toBeInstanceOf(MondayApiError);

    expect(apiErrorSpy).toHaveBeenCalledTimes(1);
    expect(apiErrorSpy.mock.calls[0][2]).toMatchObject({ query: CLEAN_QUERY });
    expect(typeof apiErrorSpy.mock.calls[0][2].duration).toBe('number');
  });

  it('hands the MondayApiError the id of the error it already logged, so a re-log is a duplicate', async () => {
    // 'boom' is deliberately NOT in the retryable set — one attempt, no timers.
    const original = new Error('boom');
    mocks.api.mockRejectedValue(original);

    let caught;
    try {
      await safeApi('fetchRangeItems', CLEAN_QUERY);
    } catch (err) {
      caught = err;
    }

    // safeApi's catch logs `original` first (logger stamps it), then MUST copy that
    // id onto the wrapper it throws. The soft-error path has __softErrorLoggedId for
    // this; the HARD path has this inheritance, and nothing else.
    expect(original.correlationId).toBeDefined();
    expect(caught).toBeInstanceOf(MondayApiError);
    expect(caught.correlationId).toBe(original.correlationId);
    expect(caught.__loggedId).toBe(original.correlationId);
    // non-enumerable, exactly like the soft-error marker
    expect(Object.keys(caught)).not.toContain('correlationId');
    expect(Object.keys(caught)).not.toContain('__loggedId');
  });

  it('costs ONE sink record per hard failure even when the caller re-logs the thrown error', async () => {
    mocks.api.mockRejectedValue(new Error('boom')); // non-retryable: one attempt
    const records = [];
    const unsub = logger.addSink((record) => records.push(record));

    try {
      let caught;
      try {
        await safeApi('fetchRangeItems', CLEAN_QUERY);
      } catch (err) {
        caught = err;
      }
      // What every consumer of this slice does in its .catch (see hooks/useRangeItems).
      logger.error('useRangeItems', 'טעינת האייטמים לטווח הדוח נכשלה', caught, { boardId: '1' });
    } finally {
      unsub();
    }

    // Duplicates are dropped from the sink fan-out, so the failure reaches the UI
    // error sink ONCE — one Axiom record, one toast. (The sink also sees the
    // non-error `api` / `health` records from the same call; only the
    // error-severity ones drive a toast, so those are what is counted.)
    const failures = records.filter((r) => r.kind === 'apiError' || r.kind === 'error');
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe('apiError');
  });
});

describe('safeApi — retry on the transient set', () => {
  it('retries a rate-limited call and resolves with the second attempt', async () => {
    vi.useFakeTimers();
    mocks.api.mockRejectedValueOnce(rateLimitError()).mockResolvedValue({ data: { ok: true } });

    const pending = safeApi('fn', CLEAN_QUERY);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ data: { ok: true } });
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it('gives up after MAX_RETRIES and throws MondayApiError', async () => {
    vi.useFakeTimers();
    mocks.api.mockRejectedValue(rateLimitError());

    const pending = safeApi('fn', CLEAN_QUERY);
    const assertion = expect(pending).rejects.toBeInstanceOf(MondayApiError);
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;

    expect(mocks.api).toHaveBeenCalledTimes(_testHelpers.MAX_RETRIES + 1);
  });

  it('does not retry at all when the caller passes retry:false', async () => {
    mocks.api.mockRejectedValue(rateLimitError());

    await expect(safeApi('fn', CLEAN_QUERY, { retry: false })).rejects.toBeInstanceOf(
      MondayApiError
    );

    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
});

describe('retry classification', () => {
  it.each([
    ['complexityBudgetExhausted'],
    ['request_max_complexity_exceeded'],
    ['internalServerError'],
    ['rate_limit_exceeded'],
    ['maxConcurrencyExceeded'],
  ])('treats %s as transient', (code) => {
    expect(_testHelpers.isRetryableError({ errorCode: code })).toBe(true);
  });

  it.each([[429], [500], [502], [503]])('treats HTTP %i as transient', (status) => {
    expect(
      _testHelpers.isRetryableError({ response: { errors: [{ extensions: { status_code: status } }] } })
    ).toBe(true);
  });

  it.each([
    ['Failed to fetch'],
    ['NetworkError when attempting to fetch resource'],
    ['Load failed'],
  ])('treats the network-failure message "%s" as transient', (message) => {
    expect(_testHelpers.isRetryableError({ message })).toBe(true);
  });

  it('does not retry a permanent column/type error', () => {
    expect(
      _testHelpers.isRetryableError({
        response: {
          errors: [{ message: 'This column type is not supported yet in the API', extensions: { code: 'InvalidColumnTypeException', status_code: 200 } }],
        },
      })
    ).toBe(false);
    expect(_testHelpers.isRetryableError({ errorCode: 'ColumnValueException' })).toBe(false);
    expect(
      _testHelpers.isRetryableError({ response: { errors: [{ extensions: { status_code: 404 } }] } })
    ).toBe(false);
  });

  it('honours monday retry_in_seconds, else backs off exponentially', () => {
    expect(
      _testHelpers.getRetryDelay(
        { response: { errors: [{ extensions: { retry_in_seconds: 7 } }] } },
        1
      )
    ).toBe(7000);
    expect(_testHelpers.getRetryDelay({}, 1)).toBe(2000);
    expect(_testHelpers.getRetryDelay({}, 2)).toBe(4000);
  });
});

describe('extractOperationName', () => {
  it('reads the named query, the named mutation, then falls back to the first field', () => {
    expect(extractOperationName(CLEAN_QUERY)).toBe('DocsExportBoardMeta');
    expect(extractOperationName('mutation DocsExportSave($x: JSON!) { y }')).toBe('DocsExportSave');
    expect(extractOperationName('{ boards(ids: [1]) { id } }')).toBe('boards');
  });

  it('returns null for an empty query instead of throwing', () => {
    expect(extractOperationName('')).toBe(null);
    expect(extractOperationName(undefined)).toBe(null);
  });
});

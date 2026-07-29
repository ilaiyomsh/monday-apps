/**
 * The monday API transport: pre-flight query validation, MondayApiError, retry on
 * the transient failure set, and the ONE wrapper around the SDK — `safeApi`.
 *
 * @module services/client
 *
 * Ported from `apps/discussions/src/utils/mondayApi/client.js` and trimmed to what
 * this app needs (no mutations here — docs-export is read-only against monday).
 * Two properties of the original are load-bearing and are preserved verbatim in
 * substance:
 *
 *  1. **safeApi does NOT throw on GraphQL soft errors.** monday answers HTTP 200
 *     carrying `errors[]` (probe finding 4: a mirror column inside `query_params`
 *     returns `InvalidColumnTypeException` with `data.boards: [null]`). safeApi
 *     LOGS that at ERROR level and returns the raw response; throwing is
 *     `assertNoGraphQLErrors`' job (services/monday-client.js). Callers that skip
 *     the assert get a silent failure that looks like success.
 *  2. **The dedup marker.** The soft-error record's correlationId is stamped onto
 *     the response as a non-enumerable `__softErrorLoggedId`, so the
 *     MondayApiError thrown later inherits it and logger's log-once marks the
 *     second pass as a duplicate. One failure = one record = one toast. Remove the
 *     marker and every API failure toasts twice.
 *
 * Unlike the discussions original, safeApi does not take the SDK as a parameter —
 * this app has exactly ONE mondaySdk() instance (services/monday-sdk.js) and
 * creating another would give it its own postMessage bridge and token state.
 */
import monday from './monday-sdk.js';
import logger from '../utils/logger.js';

// Coarse latency buckets so repeated api_latency health signals dedup at the
// transport instead of shipping a distinct message per call (safeApi is a hot
// path — bucket, never track per call).
const latencyBucket = (ms) => {
  if (ms < 200) return 'fast';
  if (ms < 1000) return 'ok';
  if (ms < 3000) return 'slow';
  return 'very_slow';
};

// ============================================================
// Pre-flight query validation
// ============================================================

// These literals are all VALID GraphQL. monday accepts them and answers with an
// empty result, so the bug surfaces as "there is no data" — hours later, in a
// different file. Naming them before the wire is the whole point.
const SUSPICIOUS_PATTERNS = [
  { regex: /ids:\s*\[\s*undefined\s*\]/gi, desc: 'ids: [undefined]' },
  { regex: /ids:\s*\[\s*null\s*\]/gi, desc: 'ids: [null]' },
  { regex: /ids:\s*\[\s*NaN\s*\]/gi, desc: 'ids: [NaN]' },
  { regex: /ids:\s*\[\s*\]/g, desc: 'ids: [] (empty)' },
  { regex: /"undefined"/g, desc: '"undefined" string value' },
  { regex: /"null"/g, desc: '"null" string value' },
  { regex: /"NaN"/g, desc: '"NaN" string value' },
  { regex: /column_id:\s*""/g, desc: 'empty column_id' },
  { regex: /board_id:\s*undefined/gi, desc: 'board_id: undefined' },
  { regex: /board_id:\s*null/gi, desc: 'board_id: null' },
  { regex: /board_id:\s*NaN/gi, desc: 'board_id: NaN' },
  { regex: /item_id:\s*undefined/gi, desc: 'item_id: undefined' },
  { regex: /item_id:\s*null/gi, desc: 'item_id: null' },
  { regex: /item_id:\s*NaN/gi, desc: 'item_id: NaN' },
];

/**
 * Scan a GraphQL document for values that monday would silently accept.
 * @param {string} query
 * @returns {{ valid: boolean, warnings: string[] }}
 */
const validateQuery = (query) => {
  if (!query || typeof query !== 'string') {
    return { valid: false, warnings: ['Query is empty or not a string'] };
  }

  const warnings = [];
  for (const { regex, desc } of SUSPICIOUS_PATTERNS) {
    // /g regexes keep lastIndex between .test() calls — reset or the SECOND
    // validation of the same string silently reports no warnings.
    regex.lastIndex = 0;
    if (regex.test(query)) warnings.push(`Suspicious value detected: ${desc}`);
  }

  if (warnings.length > 0) {
    // FOUR arguments: logger.error(module, message, error, CONTEXT). There is no
    // Error here — this is a pre-flight finding — so the error slot is explicitly
    // null and the diagnostics go to `context`, which is where the Axiom sink and
    // ErrorDetailsModal read them from. The discussions original passes this object
    // as the 3rd argument, which lands it in the error slot: the payload survives
    // (logger keeps a non-Error there on `data`) but `record.context` comes out
    // empty, so the shipped record carries no context field at all.
    logger.error('QueryValidation', `Query has ${warnings.length} warning(s)`, null, {
      warnings,
      queryPreview: query.substring(0, 300),
    });
  }

  return { valid: warnings.length === 0, warnings };
};

/**
 * Best-effort operation name for logs and the error-details modal.
 * @param {string} query
 * @returns {string|null}
 */
export function extractOperationName(query) {
  if (!query || typeof query !== 'string') return null;
  const mutationMatch = query.match(/mutation\s+(\w+)/);
  if (mutationMatch) return mutationMatch[1];
  const queryMatch = query.match(/query\s+(\w+)/);
  if (queryMatch) return queryMatch[1];
  const firstOperationMatch = query.match(/(\w+)\s*\(/);
  if (firstOperationMatch) return firstOperationMatch[1];
  return null;
}

/**
 * An API failure carrying everything ErrorDetailsModal renders: the request, the
 * raw response, monday's error code, the caller and the duration.
 */
export class MondayApiError extends Error {
  constructor(
    message,
    { response = null, apiRequest = null, errorCode = null, functionName = null, duration = null } = {}
  ) {
    super(message);
    this.name = 'MondayApiError';
    this.response = response;
    this.apiRequest = apiRequest;
    this.errorCode = errorCode;
    this.functionName = functionName;
    this.duration = duration;
    this.timestamp = Date.now();
    if (Error.captureStackTrace) Error.captureStackTrace(this, MondayApiError);
  }

  /** Full diagnostic payload (the modal and the remote sink both read this). */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      response: this.response,
      apiRequest: this.apiRequest,
      functionName: this.functionName,
      duration: this.duration,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// ============================================================
// Retry — transient failures only
// ============================================================

// Compared case-insensitively with whitespace folded to '_', so one spelling per
// code is enough. Anything NOT here is permanent: retrying a
// ColumnValueException or an InvalidColumnTypeException just delays the error.
const RETRYABLE_CODES_SET = new Set([
  'complexitybudgetexhausted',
  'complexity_budget_exhausted',
  'request_max_complexity_exceeded',
  'internalservererror',
  'internal_server_error',
  'rate_limit_exceeded',
  'maxconcurrencyexceeded',
]);

const RETRYABLE_STATUS = [429, 500, 502, 503];
const MAX_RETRIES = 2;

// Transport-level failures arrive as a bare message with no extensions.code
// (HTTP/2 protocol errors, a postMessage that never lands, Safari's "Load failed").
const RETRYABLE_MESSAGE_PATTERNS = [
  /rate.*limit.*exceeded/i,
  /resource.*locked.*try again/i,
  /minute.*limit/i,
  /failed to fetch/i,
  /network.*error/i,
  /load failed/i,
];

const isRetryableCode = (code) => {
  if (!code) return false;
  return RETRYABLE_CODES_SET.has(code.toLowerCase().replace(/\s+/g, '_'));
};

const isRetryableMessage = (message) => {
  if (!message) return false;
  return RETRYABLE_MESSAGE_PATTERNS.some((rx) => rx.test(message));
};

const _getErrorExtensions = (error) =>
  error?.data?.errors?.[0]?.extensions || error?.response?.errors?.[0]?.extensions || null;

const isRetryableError = (error) => {
  const extensions = _getErrorExtensions(error);
  const code = error?.errorCode || extensions?.code;
  const status = extensions?.status_code;
  const message =
    error?.message || error?.data?.errors?.[0]?.message || error?.response?.errors?.[0]?.message;
  return isRetryableCode(code) || RETRYABLE_STATUS.includes(status) || isRetryableMessage(message);
};

const getRetryDelay = (error, attempt) => {
  const retrySeconds = _getErrorExtensions(error)?.retry_in_seconds;
  if (retrySeconds) return retrySeconds * 1000;
  return Math.pow(2, attempt) * 1000; // 2s, 4s
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff.
 * @param {Function} fn
 * @param {{ onRetry?: Function }} [options]
 */
const executeWithRetry = async (fn, { onRetry } = {}) => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = getRetryDelay(error, attempt + 1);
        onRetry?.({ error, attempt: attempt + 1, delay });
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  // Unreachable: the loop either returns or throws.
  return undefined;
};

/**
 * Drop-in replacement for monday.api() with validation, structured logging and
 * retry. Returns the RAW response (like monday.api), and deliberately does NOT
 * throw on GraphQL soft errors — see the module header.
 *
 * @param {string} callerName - the calling function, for logs
 * @param {string} query - the GraphQL document ($variables only)
 * @param {Object} [options]
 * @param {Object} [options.variables]
 * @param {string} [options.apiVersion]
 * @param {boolean} [options.retry=true]
 * @returns {Promise<Object>} the raw API response
 */
export const safeApi = async (callerName, query, options = {}) => {
  const { warnings: queryWarnings } = validateQuery(query);

  logger.api(callerName, query, options.variables || null);

  // Kept in the closure so the outer catch can report the last duration and the
  // last response body even when the failure happened mid-retry.
  let lastStartTime = Date.now();
  let lastRawResponse = null;

  const oneAttempt = async () => {
    lastStartTime = Date.now();
    lastRawResponse = null;
    // apiVersion is passed PER CALL: monday.setApiVersion() does not reliably
    // apply to monday.api() inside the iframe (the parent window executes the
    // query), so version-specific fields fail validation without this.
    const apiOpts = {};
    if (options.variables) apiOpts.variables = options.variables;
    if (options.apiVersion) apiOpts.apiVersion = options.apiVersion;
    const rawResponse = Object.keys(apiOpts).length
      ? await monday.api(query, apiOpts)
      : await monday.api(query);
    lastRawResponse = rawResponse;
    const duration = Date.now() - lastStartTime;
    logger.apiResponse(callerName, rawResponse, duration);
    logger.health('api_latency', { bucket: latencyBucket(duration), ok: true });

    // GraphQL soft errors: logged at ERROR level, NOT thrown and NOT retried
    // (they are permanent). Recorded via apiError with the raw response in
    // context so the UI sink can extract monday's specific message.
    if (rawResponse?.errors?.length > 0) {
      const softError = new Error(
        rawResponse.errors[0]?.message || `${callerName} - GraphQL errors in response`
      );
      logger.apiError(callerName, softError, {
        query,
        variables: options.variables || null,
        rawResponse,
        queryWarnings,
      });
      // Tie the record to the response so assertNoGraphQLErrors' MondayApiError
      // can inherit the correlationId — one failure, one record, one toast.
      if (softError.correlationId !== undefined) {
        try {
          Object.defineProperty(rawResponse, '__softErrorLoggedId', {
            value: softError.correlationId,
            enumerable: false,
            configurable: true,
          });
        } catch (tagErr) {
          // A frozen response only costs the downstream dedup; the soft error is
          // already recorded above. Log at warn so the trace is not lost.
          logger.warn(
            'API',
            `${callerName} - סימון __softErrorLoggedId נכשל (תשובה קפואה); dedup בהמשך הזרימה יוותר`,
            tagErr
          );
        }
      }
    }
    return rawResponse;
  };

  try {
    if (options.retry === false) return await oneAttempt();
    return await executeWithRetry(oneAttempt, {
      onRetry: ({ error, attempt, delay }) => {
        const retryCode = error?.errorCode || _getErrorExtensions(error)?.code;
        logger.warn(
          'API',
          `${callerName} - Retryable error, attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms`,
          { errorCode: retryCode, attempt }
        );
      },
    });
  } catch (error) {
    const duration = Date.now() - lastStartTime;
    logger.health('api_latency', { bucket: latencyBucket(duration), ok: false });
    logger.apiError(callerName, error, {
      query,
      variables: options.variables || null,
      rawResponse: lastRawResponse,
      duration,
      queryWarnings,
    });
    if (error instanceof MondayApiError) throw error;
    const wrapped = new MondayApiError(error?.message || 'Unknown error', {
      response: error?.response || error?.data || lastRawResponse,
      apiRequest: {
        query,
        variables: options.variables || null,
        operationName: extractOperationName(query),
      },
      errorCode: error?.errorCode || error?.data?.errors?.[0]?.extensions?.code,
      functionName: callerName,
      duration,
    });
    // The wrapper inherits the already-logged error's id so every re-log of the
    // wrapper upstream is marked duplicate (one record + one toast per failure).
    if (error?.correlationId !== undefined) {
      try {
        Object.defineProperty(wrapped, '__loggedId', {
          value: error.correlationId,
          enumerable: false,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(wrapped, 'correlationId', {
          value: error.correlationId,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      } catch (tagErr) {
        logger.warn(
          'API',
          `${callerName} - הורשת correlationId ל-wrapped נכשלה; dedup בהמשך הזרימה יוותר`,
          tagErr
        );
      }
    }
    throw wrapped;
  }
};

// @visibleForTesting
export const _testHelpers = {
  MAX_RETRIES,
  validateQuery,
  isRetryableCode,
  isRetryableMessage,
  isRetryableError,
  getRetryDelay,
  executeWithRetry,
  _getErrorExtensions,
};

/**
 * The app-facing API call: `api(query, variables, fnName)` → `res.data`.
 *
 * @module services/monday-client
 *
 * This is the ONLY place that turns monday's "HTTP 200 carrying errors[]" into a
 * thrown failure. `safeApi` deliberately does not (it logs and returns the raw
 * response — see services/client.js), so every read path must funnel through here
 * or it will happily destructure `undefined` off a nulled board node and report
 * success. Probe finding 4 is the concrete case: one mirror rule inside
 * `query_params` answers 200 with `data.boards: [null]`.
 *
 * `assertNoGraphQLErrors` throws WITHOUT logging again, inheriting the soft
 * error's correlationId from the `__softErrorLoggedId` marker safeApi stamped on
 * the response. That is what keeps one failure = one log record = one toast.
 */
import { API_VERSION } from './monday-sdk.js';
import { safeApi, MondayApiError, extractOperationName } from './client.js';
import logger from '../utils/logger.js';

/**
 * Enforce "GraphQL soft error ≠ success". Returns the response for chaining.
 *
 * Does NOT log: safeApi already recorded this exact failure. A second record here
 * would double the toast the user sees.
 *
 * @param {Object} res - the raw response from safeApi
 * @param {Object} [meta]
 * @param {string} [meta.functionName]
 * @param {string} [meta.query]
 * @param {Object} [meta.variables]
 * @returns {Object} res, unchanged, when there are no errors
 * @throws {MondayApiError} when res.errors is a non-empty array
 */
export function assertNoGraphQLErrors(res, { functionName = null, query = null, variables = null } = {}) {
  const errors = res?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return res;

  const firstError = errors[0];
  const apiErr = new MondayApiError(firstError?.message || 'GraphQL error', {
    response: res,
    apiRequest: query
      ? { query, variables: variables || null, operationName: extractOperationName(query) }
      : null,
    errorCode: firstError?.extensions?.code || null,
    functionName,
  });

  // Inherit the id of the record safeApi already wrote, so logger's log-once
  // marks any re-log of this throw as a duplicate.
  if (res?.__softErrorLoggedId !== undefined) {
    try {
      Object.defineProperty(apiErr, '__loggedId', {
        value: res.__softErrorLoggedId,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(apiErr, 'correlationId', {
        value: res.__softErrorLoggedId,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch (tagErr) {
      // Losing the marker only costs dedup — the error itself is thrown and will
      // be recorded by the caller's catch either way.
      logger.warn('API', 'הורשת correlationId ל-MondayApiError נכשלה; dedup בהמשך הזרימה יוותר', tagErr);
    }
  }

  throw apiErr;
}

/**
 * Run a GraphQL document and return its `data`.
 *
 * @param {string} query - the document; `$variables` only, never interpolation
 * @param {Object} [variables]
 * @param {string} [fnName] - caller name for the logs (defaults to the operation name)
 * @param {Object} [requestOptions]
 * @param {boolean} [requestOptions.retry] - pass false for a non-idempotent call
 * @returns {Promise<Object>} res.data
 * @throws {MondayApiError} on a hard failure or a GraphQL soft error
 */
export async function api(query, variables = {}, fnName, requestOptions = {}) {
  const caller = fnName || extractOperationName(query) || 'api';
  const safeOptions = { variables, apiVersion: API_VERSION };
  if (requestOptions.retry === false) safeOptions.retry = false;

  const res = await safeApi(caller, query, safeOptions);

  if (!res) {
    // Happens outside the monday iframe with no token configured: safeApi saw no
    // error (the SDK resolved with nothing), so log it here once so it still
    // reaches the UI error sink.
    const noResp = new MondayApiError(
      'monday.api returned no response. Set VITE_MONDAY_TOKEN in .env.local for local dev, ' +
        'or run inside monday (seamless auth).',
      { functionName: caller, apiRequest: { query, variables, operationName: caller } }
    );
    logger.apiError(caller, noResp, { query, variables });
    throw noResp;
  }

  assertNoGraphQLErrors(res, { functionName: caller, query, variables });
  return res.data;
}

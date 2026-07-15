// Structured logging. The /confirm attempt line is the spec §6 contract:
// exactly { ts, ip, itemId, outcome } — never secrets, never item content.

/**
 * Log one /confirm attempt as a single JSON line to stdout.
 * Shape: {"ts":"<ISO-8601>","ip":"<ip>","itemId":"<id|null>","outcome":"<outcome>"}
 * outcome ∈ ok | bad_key | rate_limited | wrong_status | wrong_board |
 *           expired | not_found | no_config | api_error | bad_request
 * @param {{ ip: string, itemId: string|null, outcome: string }} entry
 */
export function logAttempt({ ip, itemId, outcome }) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ip, itemId, outcome }));
}

/**
 * Server-side error detail (guard reasons, API failures). Single JSON line to
 * stderr: {"ts", "level":"error", "tag", "message", ...context}. Context must
 * never include secrets or tokens.
 * @param {string} tag
 * @param {string} message
 * @param {object} [context]
 */
export function logError(tag, message, context = {}) {
  console.error(
    JSON.stringify({ ts: new Date().toISOString(), level: 'error', tag, message, ...context })
  );
}

/**
 * Operational info line to stdout: {"ts", "level":"info", "tag", "message", ...context}.
 * @param {string} tag
 * @param {string} message
 * @param {object} [context]
 */
export function logInfo(tag, message, context = {}) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level: 'info', tag, message, ...context })
  );
}

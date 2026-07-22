// Env access — the only place besides index.js that reads process.env.
// index.js copies the monday-code platform secrets into process.env via the
// SDK's EnvironmentVariablesManager BEFORE this runs, so a single process.env
// read covers both local .env and the platform-mounted secrets file.
//
// This module has NO logger (it must stay import-free and side-effect-free):
// malformed JSON env vars silently fall back to their inert defaults here,
// and index.js — which has the logger — warns about set-but-unusable values.

/**
 * Parse a JSON env var expected to hold a plain object.
 * Missing/empty/malformed/non-object input → {} (inert default).
 * Handling of the parse failure = the default + the logger.warn in index.js
 * (environment.js is deliberately logger-free — see header).
 * @param {string|undefined} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    // Malformed JSON → inert default; index.js detects and logger.warn's it.
    return {};
  }
}

export function getEnv() {
  const allowedAccountIds = (process.env.ALLOWED_ACCOUNT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    // Session-token verification secret (the app's monday Client Secret).
    clientSecret: process.env.MONDAY_CLIENT_SECRET || '',
    // Empty list = every authenticated account is admitted; non-empty = the
    // dashboard is restricted to these monday account ids.
    allowedAccountIds,
    // Axiom read config — server-only, never reaches the client bundle. When
    // the token is unset the app runs in seed/demo mode (no real data).
    axiomToken: process.env.AXIOM_QUERY_TOKEN || '',
    axiomDataset: process.env.AXIOM_DATASET || 'app-errors',
    axiomOrgId: process.env.AXIOM_ORG_ID || '',
    port: Number(process.env.PORT || 8080),
    version: process.env.npm_package_version || '',

    // --- OAuth app-identity token flow (Change #143 continuation) ----------
    // monday app Client ID for the /oauth/start authorize redirect. The
    // Client Secret is `clientSecret` above (reused for the token exchange —
    // it is the same monday app Client Secret used for session-token verify).
    mondayClientId: process.env.MONDAY_CLIENT_ID || '',
    // This app's own stable base URL, used to build the oauth2 redirect_uri
    // (`${baseUrl}/oauth/callback`) — must match the redirect URI registered
    // in the monday Developer Center OAuth config exactly.
    baseUrl: process.env.BASE_URL || '',
    // OAuth config (scopes/redirects + the New OAuth Flow toggle) is per app
    // version — during draft testing the authorize request targets this
    // version instead of the live one (deadline-confirm's idiom).
    oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID || '',

    // --- Lifecycle events → monday board (all inert by default) -----------
    // Optional fallback: a personal monday API token used to WRITE items on
    // the lifecycle events board when the owner has not authorized via
    // /oauth/start yet (or for local dev). The OAuth-issued token (stored in
    // SecureStorage) takes priority — see services/storage.js + index.js.
    mondayApiToken: process.env.MONDAY_API_TOKEN || '',
    // Override for tests only — production uses the default endpoint.
    mondayApiUrl: process.env.MONDAY_API_URL || 'https://api.monday.com/v2',
    // NOTE: the events board id + column map are NO LONGER read from env. They
    // are provisioned via the in-app Settings UI (POST /api/settings/board) and
    // stored in SecureStorage (key lifecycle:board_config); events-board.js
    // reads them per event. This removes the old LIFECYCLE_BOARD_ID /
    // LIFECYCLE_BOARD_COLUMNS env vars entirely.
    // JSON map appSlug → Signing Secret (feature-level lifecycle webhooks).
    // Empty map = fail-closed 401 on POST /api/webhooks/lifecycle.
    lifecycleSigningSecrets: parseJsonObject(process.env.LIFECYCLE_SIGNING_SECRETS),
    // JSON map appSlug → Client Secret (app-level install/subscription webhooks).
    // Empty map = fail-closed 401 on POST /api/webhooks/app-events.
    appEventsClientSecrets: parseJsonObject(process.env.APP_EVENTS_CLIENT_SECRETS),
  };
}

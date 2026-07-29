// Env access — the only file besides index.js that reads process.env.
// Spec §5 + V3: MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET, ALLOWED_ACCOUNT_IDS
// (comma-separated allowlist; legacy single ALLOWED_ACCOUNT_ID is merged in),
// BASE_URL (set via `mapps code:env` on the platform, .env locally).

/** Comma-separated sender list → trimmed, lowercased, de-duplicated addresses. */
function parseSenderList(raw) {
  const seen = new Set(
    (raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
  return [...seen];
}

export function getEnv() {
  const allowedAccountIds = (process.env.ALLOWED_ACCOUNT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const legacy = (process.env.ALLOWED_ACCOUNT_ID || '').trim();
  if (legacy && !allowedAccountIds.includes(legacy)) allowedAccountIds.push(legacy);

  return {
    clientId: process.env.MONDAY_CLIENT_ID || '',
    clientSecret: process.env.MONDAY_CLIENT_SECRET || '',
    // V6 D15: tenant roster for admin admit + scheduler/send. Empty =
    // default-deny (nobody admitted, nobody sent to). Breaking change from
    // the v3 "empty = any installing account" default.
    allowedAccountIds,
    baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
    // Draft-testing only (OAuth settings are per app version): when set, the
    // authorize request targets this version instead of the live one.
    oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID || '',
    port: Number(process.env.PORT || 8080),
    useLocalStorage: process.env.USE_LOCAL_STORAGE === 'true',
    // V5 Gmail dynamic email: senders whose AMP forms may call /amp/confirm.
    // Empty = endpoint admits NOBODY (default deny, see helpers/amp-cors.js).
    ampAllowedSenders: parseSenderList(process.env.AMP_ALLOWED_SENDERS),
    // D8 operator summary destination. Absent → summary is skipped (logged).
    operatorEmail: (process.env.OPERATOR_EMAIL || '').trim().toLowerCase() || null,
    // T9b Gmail sending. App-level FALLBACK credentials: each organization is
    // expected to run its own OAuth client (owner decision 2026-07-29), and a
    // tenant's own pair on its google_sender record wins over these. Absent
    // both → no sender is constructed and /api/digest/send answers 409.
    googleOauthClientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
    googleOauthClientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
  };
}

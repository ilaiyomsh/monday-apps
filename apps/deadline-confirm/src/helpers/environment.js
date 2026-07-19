// Env access — the only file besides index.js that reads process.env.
// Spec §5 + V3: MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET, ALLOWED_ACCOUNT_IDS
// (comma-separated allowlist; legacy single ALLOWED_ACCOUNT_ID is merged in),
// BASE_URL (set via `mapps code:env` on the platform, .env locally).

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
    // Empty list = every installing account is admitted (isolation is
    // structural); non-empty = private-app allowlist.
    allowedAccountIds,
    baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
    // Draft-testing only (OAuth settings are per app version): when set, the
    // authorize request targets this version instead of the live one.
    oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID || '',
    port: Number(process.env.PORT || 8080),
    useLocalStorage: process.env.USE_LOCAL_STORAGE === 'true',
    // v4 digest (phase 1): Resend sender. Both optional — when either is
    // missing the app runs without outbound email and /api/digest/send
    // answers 409 email_not_configured.
    resendApiKey: process.env.RESEND_API_KEY || '',
    digestFrom: process.env.DIGEST_FROM || '',
  };
}

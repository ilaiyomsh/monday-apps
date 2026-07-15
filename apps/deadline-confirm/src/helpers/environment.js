// Env access — the only file besides index.js that reads process.env.
// Spec §5: MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET, ALLOWED_ACCOUNT_ID,
// BASE_URL (set via `mapps code:env` on the platform, .env locally).

export function getEnv() {
  return {
    clientId: process.env.MONDAY_CLIENT_ID || '',
    clientSecret: process.env.MONDAY_CLIENT_SECRET || '',
    allowedAccountId: process.env.ALLOWED_ACCOUNT_ID || '',
    baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
    // Draft-testing only (OAuth settings are per app version): when set, the
    // authorize request targets this version instead of the live one.
    oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID || '',
    port: Number(process.env.PORT || 8080),
    useLocalStorage: process.env.USE_LOCAL_STORAGE === 'true',
  };
}

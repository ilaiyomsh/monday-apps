// Env access — the only place besides index.js that reads process.env.
// index.js copies the monday-code platform secrets into process.env via the
// SDK's EnvironmentVariablesManager BEFORE this runs, so a single process.env
// read covers both local .env and the platform-mounted secrets file.

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
  };
}

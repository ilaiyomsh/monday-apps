export function getEnv() {
  return {
    port: Number(process.env.PORT || 8080),
    clientId: process.env.MONDAY_CLIENT_ID || '',
    clientSecret: process.env.MONDAY_CLIENT_SECRET || '',
    signingSecret: process.env.MONDAY_SIGNING_SECRET || '',
    oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID || '',
    baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
    useMemoryStorage: process.env.USE_MEMORY_STORAGE === 'true',
  };
}

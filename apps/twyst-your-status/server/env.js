function managerValue(manager, key) {
  if (!manager?.get) return '';
  const value = manager.get(key, { invalidate: false });
  return typeof value === 'string' ? value : '';
}

function configuredValue(manager, processEnv, key) {
  return managerValue(manager, key) || processEnv[key] || '';
}

export function getEnv({
  environmentManager,
  secretsManager,
  processEnv = process.env,
} = {}) {
  return {
    port: Number(processEnv.PORT || 8080),
    clientId: configuredValue(environmentManager, processEnv, 'MONDAY_CLIENT_ID'),
    clientSecret: configuredValue(secretsManager, processEnv, 'MONDAY_CLIENT_SECRET'),
    signingSecret: configuredValue(secretsManager, processEnv, 'MONDAY_SIGNING_SECRET'),
    oauthAppVersionId: configuredValue(environmentManager, processEnv, 'MONDAY_APP_VERSION_ID'),
    baseUrl: configuredValue(environmentManager, processEnv, 'BASE_URL').replace(/\/+$/, ''),
    useMemoryStorage: processEnv.USE_MEMORY_STORAGE === 'true',
  };
}

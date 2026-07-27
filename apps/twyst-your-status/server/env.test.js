import { describe, expect, it, vi } from 'vitest';
import { getEnv } from './env.js';

function manager(values) {
  return {
    get: vi.fn((key) => values[key] ?? null),
  };
}

describe('getEnv', () => {
  it('loads public configuration and secrets from their monday code managers', () => {
    const environmentManager = manager({
      MONDAY_CLIENT_ID: 'client-from-manager',
      MONDAY_APP_VERSION_ID: 'version-from-manager',
      BASE_URL: 'https://workflow.example///',
    });
    const secretsManager = manager({
      MONDAY_CLIENT_SECRET: 'client-secret-from-manager',
      MONDAY_SIGNING_SECRET: 'signing-secret-from-manager',
    });

    expect(getEnv({
      environmentManager,
      secretsManager,
      processEnv: { PORT: '9090', USE_MEMORY_STORAGE: 'true' },
    })).toEqual({
      port: 9090,
      clientId: 'client-from-manager',
      clientSecret: 'client-secret-from-manager',
      signingSecret: 'signing-secret-from-manager',
      oauthAppVersionId: 'version-from-manager',
      baseUrl: 'https://workflow.example',
      useMemoryStorage: true,
    });

    expect(environmentManager.get).toHaveBeenCalledWith('MONDAY_CLIENT_ID', { invalidate: false });
    expect(secretsManager.get).toHaveBeenCalledWith('MONDAY_CLIENT_SECRET', { invalidate: false });
  });

  it('falls back to process.env for local development', () => {
    const processEnv = {
      MONDAY_CLIENT_ID: 'local-client',
      MONDAY_CLIENT_SECRET: 'local-client-secret',
      MONDAY_SIGNING_SECRET: 'local-signing-secret',
      MONDAY_APP_VERSION_ID: 'local-version',
      BASE_URL: 'http://localhost:8080/',
    };

    expect(getEnv({ processEnv })).toMatchObject({
      port: 8080,
      clientId: 'local-client',
      clientSecret: 'local-client-secret',
      signingSecret: 'local-signing-secret',
      oauthAppVersionId: 'local-version',
      baseUrl: 'http://localhost:8080',
      useMemoryStorage: false,
    });
  });
});

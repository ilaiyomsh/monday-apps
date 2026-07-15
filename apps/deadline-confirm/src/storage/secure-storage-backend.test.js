// Platform quirk (apps-sdk 0.1.4, source-verified + production-observed):
// SecureStorage.set wraps PRIMITIVES as { value } and get returns the wrapper
// verbatim. The adapter must unwrap, or stored strings (oauth_token,
// link_secret) come back as objects and every downstream use breaks
// ('[object Object]' Authorization → 401 → admin shows "broken").

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdkGet = vi.fn();
const sdkSet = vi.fn();
const sdkDelete = vi.fn();

vi.mock('@mondaycom/apps-sdk', () => ({
  SecureStorage: class {
    get = sdkGet;
    set = sdkSet;
    delete = sdkDelete;
  },
}));

const { createSecureStorageBackend } = await import('./secure-storage-backend.js');

beforeEach(() => {
  sdkGet.mockReset();
  sdkSet.mockReset();
  sdkDelete.mockReset();
});

describe('createSecureStorageBackend.get', () => {
  it("unwraps the platform's primitive wrapper: {value:'tok'} → 'tok'", async () => {
    sdkGet.mockResolvedValue({ value: 'at-secret-token' });
    const backend = createSecureStorageBackend();
    await expect(backend.get('oauth_token')).resolves.toBe('at-secret-token');
  });

  it('unwraps wrapped numbers too ({value: 5} → 5)', async () => {
    sdkGet.mockResolvedValue({ value: 5 });
    const backend = createSecureStorageBackend();
    await expect(backend.get('n')).resolves.toBe(5);
  });

  it('returns real objects (config, nonces) untouched', async () => {
    const config = { boardId: '1', buttons: [], templates: [] };
    sdkGet.mockResolvedValue(config);
    const backend = createSecureStorageBackend();
    await expect(backend.get('config')).resolves.toBe(config);

    const nonce = { createdAt: 123 };
    sdkGet.mockResolvedValue(nonce);
    await expect(backend.get('oauth_state:x')).resolves.toBe(nonce);
  });

  it('does NOT unwrap objects that merely contain a value key among others', async () => {
    const obj = { value: 'x', other: 1 };
    sdkGet.mockResolvedValue(obj);
    const backend = createSecureStorageBackend();
    await expect(backend.get('k')).resolves.toBe(obj);
  });

  it('normalizes undefined/null to null', async () => {
    sdkGet.mockResolvedValue(undefined);
    const backend = createSecureStorageBackend();
    await expect(backend.get('missing')).resolves.toBeNull();
  });
});

describe('createSecureStorageBackend.set/delete passthrough', () => {
  it('forwards set(key, value) verbatim to the SDK', async () => {
    sdkSet.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.set('link_secret', 'sec-1');
    expect(sdkSet).toHaveBeenCalledWith('link_secret', 'sec-1');
  });

  it('forwards delete(key) to the SDK', async () => {
    sdkDelete.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.delete('oauth_state:n');
    expect(sdkDelete).toHaveBeenCalledWith('oauth_state:n');
  });
});

// Contract tests for src/storage/secure-storage-backend.js — the CRITICAL
// platform quirk: SecureStorage.set wraps PRIMITIVES as { value } and get
// returns the wrapper verbatim. Without unwrapping, the stored owner OAuth
// token comes back as an object and every Authorization header downstream
// becomes '[object Object]'. Modeled on deadline-confirm's
// src/storage/secure-storage-backend.test.js. The @mondaycom/apps-sdk
// SecureStorage class is mocked — zero real platform calls.

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

const { createSecureStorageBackend } = await import('../src/storage/secure-storage-backend.js');

beforeEach(() => {
  sdkGet.mockReset();
  sdkSet.mockReset();
  sdkDelete.mockReset();
});

describe('createSecureStorageBackend.get', () => {
  it("unwraps the platform's primitive wrapper: {value:'tok'} → 'tok'", async () => {
    sdkGet.mockResolvedValue({ value: 'at-owner-secret' });
    const backend = createSecureStorageBackend();
    await expect(backend.get('owner:oauth_token')).resolves.toBe('at-owner-secret');
  });

  it('unwraps wrapped numbers too ({value: 5} → 5)', async () => {
    sdkGet.mockResolvedValue({ value: 5 });
    const backend = createSecureStorageBackend();
    await expect(backend.get('n')).resolves.toBe(5);
  });

  it('returns real objects untouched', async () => {
    const record = { foo: 'bar', list: [1, 2] };
    sdkGet.mockResolvedValue(record);
    const backend = createSecureStorageBackend();
    await expect(backend.get('k')).resolves.toBe(record);
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

    sdkGet.mockResolvedValue(null);
    await expect(backend.get('missing2')).resolves.toBeNull();
  });
});

describe('createSecureStorageBackend.set/delete passthrough', () => {
  it('forwards set(key, value) verbatim to the SDK', async () => {
    sdkSet.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.set('owner:oauth_token', 'at-1');
    expect(sdkSet).toHaveBeenCalledWith('owner:oauth_token', 'at-1');
  });

  it('forwards delete(key) to the SDK', async () => {
    sdkDelete.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.delete('owner:oauth_token');
    expect(sdkDelete).toHaveBeenCalledWith('owner:oauth_token');
  });
});

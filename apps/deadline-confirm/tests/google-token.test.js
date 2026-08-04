// The Google token lifecycle, extracted from gmail-sender.js so the SMTP
// channel (findings §2) shares one implementation. The refresh/memo/kill-switch
// semantics are already characterized end-to-end through the two senders'
// suites — this file covers ONLY the new module surface (senderFor /
// forceRefresh / markDisconnected called directly), not those behaviors again.

import { describe, it, expect } from 'vitest';
import { createGoogleTokenSource } from '../src/services/google-token.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function fakeStorage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    forAccount: (accountId) => ({
      getGoogleSender: async () => records.get(accountId) ?? null,
      setGoogleSender: async (r) => records.set(accountId, r),
    }),
  };
}

function connected(overrides = {}) {
  return {
    refreshToken: 'rt1',
    accessToken: 'at1',
    accessTokenExpiresAt: 10_000_000,
    senderAddress: 'digest@twyst.co.il',
    connectedAt: 1,
    ...overrides,
  };
}

const neverFetch = async (url) => {
  throw new Error(`unexpected fetch to ${url}`);
};

function refreshEndpoint() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url !== TOKEN_URL) throw new Error(`unexpected fetch to ${url}`);
    return { ok: true, status: 200, json: async () => ({ access_token: 'at2', expires_in: 3600 }), text: async () => '{}' };
  };
  return { calls, impl };
}

describe('createGoogleTokenSource — senderFor', () => {
  it('returns the record and a still-valid stored token without any network call', async () => {
    const storage = fakeStorage({ 111: connected() });
    const source = createGoogleTokenSource({
      storage, clientId: 'c', clientSecret: 's', fetchImpl: neverFetch, now: () => 9_000_000,
    });
    const { record, accessToken } = await source.senderFor('111');
    expect(accessToken).toBe('at1');
    expect(record.senderAddress).toBe('digest@twyst.co.il');
  });

  it('refuses a tenant that never connected', async () => {
    const source = createGoogleTokenSource({
      storage: fakeStorage(), clientId: 'c', clientSecret: 's', fetchImpl: neverFetch, now: () => 1,
    });
    await expect(source.senderFor('111')).rejects.toMatchObject({ code: 'google_not_connected' });
  });
});

describe('createGoogleTokenSource — forceRefresh', () => {
  it('bypasses a still-valid memo, hits the token endpoint and persists the fresh token', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = refreshEndpoint();
    const source = createGoogleTokenSource({
      storage, clientId: 'c', clientSecret: 's', fetchImpl: impl, now: () => 9_000_000,
    });
    await source.senderFor('111'); // memoizes at1, no fetch
    const { accessToken } = await source.forceRefresh('111');
    expect(accessToken).toBe('at2');
    expect(calls).toHaveLength(1);
    expect(storage.records.get('111').accessToken).toBe('at2');
    expect(storage.records.get('111').refreshToken).toBe('rt1');
  });
});

describe('createGoogleTokenSource — markDisconnected', () => {
  it('persists disconnectedAt + lastError and a later senderFor refuses', async () => {
    const storage = fakeStorage({ 111: connected() });
    const source = createGoogleTokenSource({
      storage, clientId: 'c', clientSecret: 's', fetchImpl: neverFetch, now: () => 5_000,
    });
    await source.senderFor('111'); // memoized — markDisconnected must also clear it
    await source.markDisconnected('111', 'smtp_auth_failed');
    expect(storage.records.get('111').disconnectedAt).toBe(5_000);
    expect(storage.records.get('111').lastError).toBe('smtp_auth_failed');
    await expect(source.senderFor('111')).rejects.toMatchObject({ code: 'google_disconnected' });
  });

  it('is a no-op for a tenant with no record — never invents one', async () => {
    const storage = fakeStorage();
    const source = createGoogleTokenSource({
      storage, clientId: 'c', clientSecret: 's', fetchImpl: neverFetch, now: () => 5_000,
    });
    await source.markDisconnected('999', 'smtp_auth_failed');
    expect(storage.records.has('999')).toBe(false);
  });
});

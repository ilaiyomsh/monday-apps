// T9b env surface. App-level FALLBACK OAuth client credentials: each
// organization is expected to run its own client (owner decision 2026-07-29),
// and a tenant's own pair on its google_sender record wins over these. Absent
// both → index.js builds no sender and /api/digest/send answers 409.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv } from '../src/helpers/environment.js';

const KEYS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'];

describe('getEnv — Google OAuth client', () => {
  /** @type {Record<string, string|undefined>} */
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reads both halves of the client pair', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'shhh';
    const env = getEnv();
    expect(env.googleOauthClientId).toBe('cid.apps.googleusercontent.com');
    expect(env.googleOauthClientSecret).toBe('shhh');
  });

  it('defaults to empty strings when unset — no sender is constructed', () => {
    const env = getEnv();
    expect(env.googleOauthClientId).toBe('');
    expect(env.googleOauthClientSecret).toBe('');
  });

  it('trims surrounding whitespace — a copy-paste newline must not become part of the id', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '  cid  ';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = '\tshhh\n';
    const env = getEnv();
    expect(env.googleOauthClientId).toBe('cid');
    expect(env.googleOauthClientSecret).toBe('shhh');
  });

  it('does not lowercase the secret — credentials are case-sensitive', () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'AbCdEf';
    expect(getEnv().googleOauthClientSecret).toBe('AbCdEf');
  });
});

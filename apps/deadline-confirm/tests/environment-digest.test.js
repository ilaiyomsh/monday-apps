// v4 digest env additions: RESEND_API_KEY + DIGEST_FROM (both optional —
// absent means the app runs without an email sender).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv } from '../src/helpers/environment.js';

const SAVED = {};
const KEYS = ['RESEND_API_KEY', 'DIGEST_FROM'];

beforeEach(() => {
  for (const k of KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('getEnv digest fields', () => {
  it('reads RESEND_API_KEY and DIGEST_FROM', () => {
    process.env.RESEND_API_KEY = 'rk_live_1';
    process.env.DIGEST_FROM = 'עדכוני דדליין <d@x.co>';
    const env = getEnv();
    expect(env.resendApiKey).toBe('rk_live_1');
    expect(env.digestFrom).toBe('עדכוני דדליין <d@x.co>');
  });

  it('defaults both to empty string when unset', () => {
    const env = getEnv();
    expect(env.resendApiKey).toBe('');
    expect(env.digestFrom).toBe('');
  });
});

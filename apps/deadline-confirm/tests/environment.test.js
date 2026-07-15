// Contract tests for src/helpers/environment.js — v3 multi-tenant:
// getEnv().allowedAccountIds is a string[] parsed from the comma-separated
// ALLOWED_ACCOUNT_IDS (entries trimmed, empty entries dropped), merged with
// the legacy single ALLOWED_ACCOUNT_ID (appended when set and not already
// present, trimmed). Env is stubbed per test via vi.stubEnv and restored
// after each one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { getEnv } from '../src/helpers/environment.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getEnv().allowedAccountIds (v3)', () => {
  it("parses a comma-separated ALLOWED_ACCOUNT_IDS with trimming and empty entries dropped: ' 11, 22,,33 ' → ['11','22','33']", () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', ' 11, 22,,33 ');
    vi.stubEnv('ALLOWED_ACCOUNT_ID', '');

    expect(getEnv().allowedAccountIds).toEqual(['11', '22', '33']);
  });

  it("appends the legacy ALLOWED_ACCOUNT_ID when it is not already in the list: ' 11, 22,,33 ' + '44' → ['11','22','33','44']", () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', ' 11, 22,,33 ');
    vi.stubEnv('ALLOWED_ACCOUNT_ID', '44');

    expect(getEnv().allowedAccountIds).toEqual(['11', '22', '33', '44']);
  });

  it("does NOT duplicate a legacy id already present: ALLOWED_ACCOUNT_IDS='22' + ALLOWED_ACCOUNT_ID='22' → ['22']", () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', '22');
    vi.stubEnv('ALLOWED_ACCOUNT_ID', '22');

    expect(getEnv().allowedAccountIds).toEqual(['22']);
  });

  it("yields the trimmed legacy id alone when only ALLOWED_ACCOUNT_ID=' 44 ' is set → ['44']", () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', '');
    vi.stubEnv('ALLOWED_ACCOUNT_ID', ' 44 ');

    expect(getEnv().allowedAccountIds).toEqual(['44']);
  });

  it('resolves to the EMPTY array when both variables are unset', () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', undefined);
    vi.stubEnv('ALLOWED_ACCOUNT_ID', undefined);

    expect(getEnv().allowedAccountIds).toEqual([]);
  });

  it('resolves to the EMPTY array when both variables are empty strings', () => {
    vi.stubEnv('ALLOWED_ACCOUNT_IDS', '');
    vi.stubEnv('ALLOWED_ACCOUNT_ID', '');

    expect(getEnv().allowedAccountIds).toEqual([]);
  });
});

describe('getEnv() sanity (unchanged v2 behavior)', () => {
  it('strips trailing slashes from BASE_URL', () => {
    vi.stubEnv('BASE_URL', 'https://app.example///');

    expect(getEnv().baseUrl).toBe('https://app.example');
  });
});

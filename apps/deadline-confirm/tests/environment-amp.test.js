// TDD red phase (V5) — AMP_ALLOWED_SENDERS parsing in getEnv().
//
// The Gmail dynamic-email endpoint is default-deny: it only answers senders on
// this allowlist. Parsing rules mirror ALLOWED_ACCOUNT_IDS (comma-separated,
// trimmed, blanks dropped) plus address normalization (lowercase, dedup) so the
// route can compare without re-normalizing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv } from '../src/helpers/environment.js';

const KEY = 'AMP_ALLOWED_SENDERS';
let saved;

beforeEach(() => {
  saved = process.env[KEY];
  delete process.env[KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('getEnv().ampAllowedSenders', () => {
  it('is an empty array when the variable is unset (feature off)', () => {
    expect(getEnv().ampAllowedSenders).toEqual([]);
  });

  it('is an empty array when the variable is blank or only separators', () => {
    process.env[KEY] = '  , ,';
    expect(getEnv().ampAllowedSenders).toEqual([]);
  });

  it('splits on commas, trims and lowercases each address', () => {
    process.env[KEY] = ' Deadline@Twyst.co.IL , AMP@gmail.dev ';
    expect(getEnv().ampAllowedSenders).toEqual(['deadline@twyst.co.il', 'amp@gmail.dev']);
  });

  it('de-duplicates addresses that differ only by case or padding', () => {
    process.env[KEY] = 'a@b.com,A@B.COM, a@b.com ';
    expect(getEnv().ampAllowedSenders).toEqual(['a@b.com']);
  });
});

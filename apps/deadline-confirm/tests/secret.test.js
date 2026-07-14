// Contract tests for src/services/secret.js — spec §4 (link_secret format),
// §6.3 (constant-time compare), §9 (masked secret). TDD red phase: stubs
// throw NOT_IMPLEMENTED, so every test here must fail until implemented.

import { describe, it, expect } from 'vitest';
import { generateSecret, secretEquals, maskSecret } from '../src/services/secret.js';

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

describe('generateSecret', () => {
  it('returns exactly 43 chars drawn only from the base64url alphabet [A-Za-z0-9_-]', () => {
    const secret = generateSecret();
    expect(typeof secret).toBe('string');
    expect(secret).toHaveLength(43);
    expect(secret).toMatch(BASE64URL_43);
  });

  it('returns a secret containing no "=" padding', () => {
    expect(generateSecret()).not.toContain('=');
  });

  it('returns a different secret on each call', () => {
    const first = generateSecret();
    const second = generateSecret();
    expect(second).not.toBe(first);
  });
});

describe('secretEquals', () => {
  const stored = 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3'; // 43-char base64url-shaped fixture

  it('returns true when provided and stored secrets are identical', () => {
    expect(secretEquals(stored, stored)).toBe(true);
  });

  it('returns false for two different secrets of the SAME length', () => {
    // differ only in the last char — same length, so a length-only compare would pass
    const other = stored.slice(0, 42) + (stored.endsWith('3') ? '4' : '3');
    expect(other).toHaveLength(stored.length);
    expect(secretEquals(other, stored)).toBe(false);
  });

  it.each([
    ['undefined provided', undefined, stored],
    ['null provided', null, stored],
    ['empty-string provided', '', stored],
    ['number provided', 12345, stored],
    ['object provided', { k: stored }, stored],
    ['undefined stored', stored, undefined],
    ['null stored', stored, null],
    ['empty-string stored', stored, ''],
    ['number stored', stored, 12345],
    ['both empty strings', '', ''],
    ['both undefined', undefined, undefined],
  ])('returns false without throwing when %s', (_label, provided, actual) => {
    let result;
    expect(() => {
      result = secretEquals(provided, actual);
    }).not.toThrow();
    expect(result).toBe(false);
  });
});

describe('maskSecret', () => {
  it('returns "****" + exactly the last 4 chars for a 43-char secret', () => {
    const secret = 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3';
    expect(maskSecret(secret)).toBe('****xWk3');
  });

  it('returns the exact masked string for a known short input', () => {
    expect(maskSecret('abcdefgh')).toBe('****efgh');
  });

  it.each([
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['number', 12345],
    ['object', { secret: 'abcdefgh' }],
  ])('returns null for a %s input', (_label, input) => {
    expect(maskSecret(input)).toBeNull();
  });
});

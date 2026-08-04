/**
 * guardBase — the base-URL resolver for guard calls after the same-origin
 * unification (round324). The contract under test: an explicit override wins
 * and is normalized; with no override the base is '' (same-origin relative)
 * in a real build and null (skip) only under the dev-harness mock flag.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveGuardBase } from './guardBase.js';

describe('resolveGuardBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns '' (same-origin relative) by default in a real build", () => {
    vi.stubEnv('VITE_MONDAY_MOCK', '');
    expect(resolveGuardBase(undefined)).toBe('');
  });

  it('returns null (skip) by default under the dev-harness mock flag', () => {
    vi.stubEnv('VITE_MONDAY_MOCK', '1');
    expect(resolveGuardBase(undefined)).toBeNull();
  });

  it('an explicit null overrides to skip even when NOT mocking', () => {
    vi.stubEnv('VITE_MONDAY_MOCK', '');
    expect(resolveGuardBase(null)).toBeNull();
  });

  it("an explicit '' resolves to same-origin even under the mock flag (override wins)", () => {
    vi.stubEnv('VITE_MONDAY_MOCK', '1');
    expect(resolveGuardBase('')).toBe('');
  });

  it('an explicit absolute base is returned unchanged', () => {
    expect(resolveGuardBase('https://guard.example')).toBe('https://guard.example');
  });

  it('a trailing slash on an explicit base is trimmed (so path joins never double the separator)', () => {
    expect(resolveGuardBase('https://guard.example/')).toBe('https://guard.example');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isLanguagePickerEnabled } from '../featureFlags';

const originalEnv = { ...import.meta.env };

const setEnv = (value: string | undefined) => {
  vi.stubEnv('VITE_ENABLE_LANGUAGE_PICKER', value as string);
};

describe('isLanguagePickerEnabled', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.assign(import.meta.env, originalEnv);
  });

  it('returns true only for the literal string "true"', () => {
    setEnv('true');
    expect(isLanguagePickerEnabled()).toBe(true);
  });

  it('returns false for "false"', () => {
    setEnv('false');
    expect(isLanguagePickerEnabled()).toBe(false);
  });

  it('returns false for undefined', () => {
    setEnv(undefined);
    expect(isLanguagePickerEnabled()).toBe(false);
  });

  it('returns false for "TRUE" (case-sensitive)', () => {
    setEnv('TRUE');
    expect(isLanguagePickerEnabled()).toBe(false);
  });

  it('returns false for "1"', () => {
    setEnv('1');
    expect(isLanguagePickerEnabled()).toBe(false);
  });
});

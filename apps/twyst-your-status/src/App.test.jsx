import { describe, expect, it } from 'vitest';
import { resolveAppRoute } from './App.jsx';

describe('resolveAppRoute', () => {
  it('routes /picker and nested CDN paths to the cell-attached picker', () => {
    expect(resolveAppRoute('/picker')).toBe('picker');
    expect(resolveAppRoute('/picker/')).toBe('picker');
    expect(resolveAppRoute('/apps/twyst/picker')).toBe('picker');
  });

  it('routes /settings to the slim launcher and /settings-full to the overlay editor', () => {
    expect(resolveAppRoute('/settings')).toBe('settings');
    expect(resolveAppRoute('/settings/')).toBe('settings');
    expect(resolveAppRoute('/apps/twyst/settings')).toBe('settings');
    expect(resolveAppRoute('/settings-full')).toBe('settings-full');
    expect(resolveAppRoute('/settings-full/')).toBe('settings-full');
    expect(resolveAppRoute('/apps/twyst/settings-full')).toBe('settings-full');
  });

  it('routes /required-fields to the sized fill modal', () => {
    expect(resolveAppRoute('/required-fields')).toBe('required-fields');
    expect(resolveAppRoute('/required-fields/')).toBe('required-fields');
    expect(resolveAppRoute('/apps/twyst/required-fields')).toBe('required-fields');
  });

  it('rejects unknown paths', () => {
    expect(resolveAppRoute('/')).toBeNull();
    expect(resolveAppRoute('/board')).toBeNull();
    expect(resolveAppRoute('/picker-full')).toBeNull();
    expect(resolveAppRoute('/required-fields-full')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { resolveAppRoute } from './App.jsx';

describe('resolveAppRoute', () => {
  it('routes /picker and nested CDN paths to picker', () => {
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

  it('rejects unknown paths', () => {
    expect(resolveAppRoute('/')).toBeNull();
    expect(resolveAppRoute('/board')).toBeNull();
  });
});

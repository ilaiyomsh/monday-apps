import { describe, expect, it } from 'vitest';
import { resolveAppRoute } from './App.jsx';

describe('resolveAppRoute', () => {
  it('routes /picker and nested CDN paths to picker', () => {
    expect(resolveAppRoute('/picker')).toBe('picker');
    expect(resolveAppRoute('/picker/')).toBe('picker');
    expect(resolveAppRoute('/apps/twyst/picker')).toBe('picker');
  });

  it('routes /settings to settings and rejects unknown paths', () => {
    expect(resolveAppRoute('/settings')).toBe('settings');
    expect(resolveAppRoute('/')).toBeNull();
    expect(resolveAppRoute('/board')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The i18n bootstrap initialises i18next at import time and, on failure, must route the
// error through `logger` (so it SHIPS to Axiom) rather than a bare console.error which the
// observability funnel never sees. These tests drive i18next.init to reject and assert the
// failure reaches logger.error.

describe('i18n init failure ships through logger.error (not console)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('calls logger.error tagged "i18n" when i18next.init rejects', async () => {
    const rejected = Promise.reject(new Error('init boom'));
    rejected.catch(() => {}); // keep the setup rejection from surfacing as unhandled

    vi.doMock('i18next', () => {
      const inst = {
        use() { return inst; },
        init() { return rejected; },
        t: (k) => k,
      };
      return { default: inst };
    });

    const errorSpy = vi.fn();
    vi.doMock('../utils/logger.js', () => ({
      default: { error: errorSpy, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));

    await import('./index.js');
    await new Promise((r) => setTimeout(r, 0)); // flush the rejection handler microtask

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('i18n');
    expect(errorSpy.mock.calls[0][2]).toBeInstanceOf(Error);
  });
});

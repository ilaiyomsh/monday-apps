import { describe, it, expect, vi } from 'vitest';
import { isSdkReadNoise, installSdkLogFilter } from '../src/helpers/sdk-log-filter.js';

// The exact shape apps-sdk 0.1.4 emits per read: one JSON.stringify line.
const sdkSecureRead = JSON.stringify({
  severity: 'INFO',
  tag: 'SecureStorage',
  message: '[SecureStorage] Got data for key from secure storage\nkey: 14334098:token:48274917',
  mondayInternal: false,
});
const sdkStorageRead = JSON.stringify({
  severity: 'INFO',
  tag: 'Storage',
  message: '[Storage.get] Got data for key from storage\nkey: twystStatus:5098:status_col',
  mondayInternal: false,
});
// The guard's own info line (helpers/logger.js line()): different tag, no phrase.
const guardOwnLine = JSON.stringify({
  ts: '2026-08-05T10:00:00.000Z',
  level: 'info',
  tag: 'guard',
  message: 'column enrolled',
  context: { boardId: '5098', columnId: 'status_col' },
});

describe('isSdkReadNoise', () => {
  it('matches the SDK SecureStorage read record', () => {
    expect(isSdkReadNoise(sdkSecureRead)).toBe(true);
  });

  it('matches the SDK Storage read record', () => {
    expect(isSdkReadNoise(sdkStorageRead)).toBe(true);
  });

  it("does NOT match the guard's own info line (different tag, no read phrase)", () => {
    expect(isSdkReadNoise(guardOwnLine)).toBe(false);
  });

  it('does NOT match an SDK line from a different tag even if it mentions a key read', () => {
    // Only SecureStorage/Storage read chatter is noise; anything else is kept.
    const other = JSON.stringify({
      severity: 'INFO', tag: 'ApiClient',
      message: 'Got data for key from cache', mondayInternal: false,
    });
    expect(isSdkReadNoise(other)).toBe(false);
  });

  it('does NOT match an SDK-tagged line that is not the read record', () => {
    const err = JSON.stringify({
      severity: 'ERROR', tag: 'SecureStorage',
      message: 'secure storage unavailable', mondayInternal: false,
    });
    expect(isSdkReadNoise(err)).toBe(false);
  });

  it('does NOT match a mondayInternal:true SecureStorage read (never emitted to console anyway)', () => {
    const internal = JSON.stringify({
      severity: 'INFO', tag: 'SecureStorage',
      message: '[SecureStorage] Got data for key from secure storage\nkey: x', mondayInternal: true,
    });
    expect(isSdkReadNoise(internal)).toBe(false);
  });

  it('ignores non-string and multi-arg input', () => {
    expect(isSdkReadNoise({ tag: 'SecureStorage' })).toBe(false);
    expect(isSdkReadNoise(undefined)).toBe(false);
  });
});

describe('installSdkLogFilter', () => {
  it('drops SDK read noise but passes the guard own line and restores on teardown', () => {
    const original = vi.fn();
    const fakeConsole = { log: original };

    const restore = installSdkLogFilter(fakeConsole);
    fakeConsole.log(sdkSecureRead); // suppressed
    fakeConsole.log(sdkStorageRead); // suppressed
    fakeConsole.log(guardOwnLine); // kept
    fakeConsole.log('plain human line'); // kept

    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenNthCalledWith(1, guardOwnLine);
    expect(original).toHaveBeenNthCalledWith(2, 'plain human line');

    restore();
    expect(fakeConsole.log).toBe(original);
  });

  it('never suppresses a multi-arg call even if the first arg is SDK noise', () => {
    // Suppression is only for the SDK's own single-string emit; be conservative.
    const original = vi.fn();
    const fakeConsole = { log: original };
    installSdkLogFilter(fakeConsole);

    fakeConsole.log(sdkSecureRead, 'extra');
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(sdkSecureRead, 'extra');
  });
});

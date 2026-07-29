/**
 * Characterization tests for the ONE user-visible version label.
 *
 * The label is what a support conversation runs on ("which build are you on?"),
 * so both branches and the sha truncation are pinned exactly. setupTests.js
 * stubs the three vite `define` constants; each test re-stubs the ones it needs
 * so the release / draft branches are both fed real values.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getVersionLabel } from '../versionLabel';

// A realistic 40-char git SHA — long enough that a wrong slice length shows.
const FULL_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getVersionLabel', () => {
  it('returns just v<version> for a release build, with no sha and no draft marker', () => {
    vi.stubGlobal('__IS_RELEASE__', true);
    vi.stubGlobal('__APP_VERSION__', '1.4.2');
    vi.stubGlobal('__BUILD_SHA__', FULL_SHA);

    expect(getVersionLabel()).toBe('v1.4.2');
  });

  it('marks a draft build and appends exactly the first 7 sha characters', () => {
    vi.stubGlobal('__IS_RELEASE__', false);
    vi.stubGlobal('__APP_VERSION__', '1.4.2');
    vi.stubGlobal('__BUILD_SHA__', FULL_SHA);

    expect(getVersionLabel()).toBe('v1.4.2 · draft · a1b2c3d');
  });

  it("uses vite's 'local' sha placeholder verbatim when it is shorter than 7 chars", () => {
    vi.stubGlobal('__IS_RELEASE__', false);
    vi.stubGlobal('__APP_VERSION__', '0.1.0');
    vi.stubGlobal('__BUILD_SHA__', 'local');

    expect(getVersionLabel()).toBe('v0.1.0 · draft · local');
  });
});

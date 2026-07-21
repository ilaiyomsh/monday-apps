import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleResourceError } from '../globalErrorHandler';
import logger from '../logger';

// The capture-phase resource listener must NOT silently drop non-chunk resource failures
// (broken IMG / stylesheet / non-chunk script). handleResourceError is the extracted, pure
// decision: chunk -> caller preventDefault()s (returns true); everything else is logged at
// WARN with url + tag and returns false (so the browser default still runs).

describe('handleResourceError — non-chunk resource failures are logged, not dropped', () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('logs a WARN tagged globalErrorHandler with { url, tag } for a broken IMG and returns false', () => {
    const event = { target: { tagName: 'IMG', src: 'https://cdn.example/logo.png' } };
    const handled = handleResourceError(event, {});
    expect(handled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('globalErrorHandler');
    expect(warn.mock.calls[0][2]).toEqual({ url: 'https://cdn.example/logo.png', tag: 'IMG' });
  });

  it('uses href for LINK (stylesheet) failures', () => {
    const event = { target: { tagName: 'LINK', href: 'https://cdn.example/app.css' } };
    handleResourceError(event, {});
    expect(warn.mock.calls[0][2]).toEqual({ url: 'https://cdn.example/app.css', tag: 'LINK' });
  });

  it('ignores non-resource targets (e.g. a DIV) without logging', () => {
    expect(handleResourceError({ target: { tagName: 'DIV' } }, {})).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a window-target (a real uncaught JS error, owned by the bubble listener)', () => {
    const win = {};
    expect(handleResourceError({ target: win }, win)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

// M3: the capture listener exists to recover a failed main bundle / module-preload
// after a redeploy (CDN served stale HTML for a hashed asset). SCRIPT tags and preload
// LINKs are CODE resources and MUST get the one-shot reload; IMG + plain stylesheets are
// CONTENT and must never trigger a reload. Previously ALL resource errors built a neutral
// pseudo-error that matched no chunk pattern, so the code-resource reload branch was dead.
describe('handleResourceError — code-resource failures get the one-shot reload (M3)', () => {
  let reloadSpy;
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    reloadSpy = vi.fn();
    // jsdom location.reload is non-configurable; replace the whole location object.
    delete window.location;
    window.location = { reload: reloadSpy };
  });
  afterEach(() => vi.restoreAllMocks());

  it('a failed <script> triggers a single reload and returns true (caller preventDefaults)', () => {
    const event = { target: { tagName: 'SCRIPT', src: 'https://cdn.example/assets/index-abc123.js' } };
    const handled = handleResourceError(event, window);
    expect(handled).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed module-preload <link> triggers the reload path', () => {
    const event = { target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://cdn.example/assets/chunk-def456.js' } };
    expect(handleResourceError(event, window)).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload again if the one-shot was already spent this session (returns true, no 2nd reload)', () => {
    window.sessionStorage.setItem('lazy-retry:global', '1');
    const event = { target: { tagName: 'SCRIPT', src: 'https://cdn.example/assets/index-abc123.js' } };
    expect(handleResourceError(event, window)).toBe(true);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('a broken IMG still never reloads (content resource)', () => {
    const event = { target: { tagName: 'IMG', src: 'https://cdn.example/logo.png' } };
    expect(handleResourceError(event, window)).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('a plain stylesheet <link> (no preload rel) still never reloads', () => {
    const event = { target: { tagName: 'LINK', href: 'https://cdn.example/app.css' } };
    expect(handleResourceError(event, window)).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

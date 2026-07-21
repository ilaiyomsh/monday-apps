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

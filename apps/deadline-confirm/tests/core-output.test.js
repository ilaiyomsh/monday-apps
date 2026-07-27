// Contract tests for the user-facing output surfaces:
// - src/helpers/pages.js  — spec §8 OAuth result pages. V6 deleted the three
//                           /confirm pages and the JS auto-POST landing page
//                           together with the /confirm route family (T1/T2).
// - src/helpers/logger.js — spec §6 log line {ts, ip, itemId, outcome}
// Security constraints: static pages only, no JS, no external assets.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { oauthDonePage, oauthErrorPage } from '../src/helpers/pages.js';
import { logAttempt, logError, logInfo } from '../src/helpers/logger.js';

describe('pages', () => {
  const allPages = [
    ['oauthDonePage', () => oauthDonePage()],
    ['oauthErrorPage', () => oauthErrorPage('סיבה קצרה')],
  ];

  it.each(allPages)('%s declares an RTL Hebrew document: <html dir="rtl" lang="he">', (_name, render) => {
    expect(render()).toContain('<html dir="rtl" lang="he">');
  });

  it.each(allPages)('%s contains no <script tag', (_name, render) => {
    expect(render().toLowerCase()).not.toContain('<script');
  });

  it.each(allPages)('%s references no external assets (no http:// or https:// anywhere)', (_name, render) => {
    const html = render();
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('oauthDonePage shows the exact completion heading "החיבור הושלם ✓"', () => {
    expect(oauthDonePage()).toContain('החיבור הושלם ✓');
  });

  it('oauthDonePage tells the user to close the window and refresh the settings screen', () => {
    expect(oauthDonePage()).toContain('אפשר לסגור את החלון ולרענן את מסך ההגדרות.');
  });

  it('oauthErrorPage shows the exact failure heading "החיבור נכשל"', () => {
    expect(oauthErrorPage('שגיאה')).toContain('החיבור נכשל');
  });

  it('oauthErrorPage HTML-escapes the reason: "<img>" never appears raw, appears escaped', () => {
    const html = oauthErrorPage('<img>');
    expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;img&gt;');
  });

  it('oauthErrorPage without a reason still renders the heading and no "undefined" text', () => {
    const html = oauthErrorPage();
    expect(html).toContain('החיבור נכשל');
    expect(html).not.toContain('undefined');
  });
});

describe('logger', () => {
  /** @type {import('vitest').MockInstance} */
  let logSpy;
  /** @type {import('vitest').MockInstance} */
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

  it('logAttempt emits exactly ONE stdout line whose JSON has exactly the keys {ts, ip, itemId, outcome}', () => {
    logAttempt({ ip: '1.2.3.4', itemId: '42', outcome: 'ok' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]).toHaveLength(1);
    const line = logSpy.mock.calls[0][0];
    expect(typeof line).toBe('string');

    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(['ip', 'itemId', 'outcome', 'ts']);
    expect(parsed.ip).toBe('1.2.3.4');
    expect(parsed.itemId).toBe('42');
    expect(parsed.outcome).toBe('ok');
    expect(parsed.ts).toMatch(ISO_8601);
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it('logAttempt writes nothing to stderr', () => {
    logAttempt({ ip: '1.2.3.4', itemId: '42', outcome: 'ok' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logError emits ONE stderr JSON line with level:"error", the exact tag/message, and the context fields', () => {
    logError('confirm.guard', 'wrong_board', { itemId: '42' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled(); // errors never leak to stdout

    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(Object.keys(parsed).sort()).toEqual(['itemId', 'level', 'message', 'tag', 'ts']);
    expect(parsed.level).toBe('error');
    expect(parsed.tag).toBe('confirm.guard');
    expect(parsed.message).toBe('wrong_board');
    expect(parsed.itemId).toBe('42');
    expect(parsed.ts).toMatch(ISO_8601);
  });

  it('logInfo emits ONE stdout JSON line with level:"info" and the exact tag/message', () => {
    logInfo('oauth', 'token stored');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.level).toBe('info');
    expect(parsed.tag).toBe('oauth');
    expect(parsed.message).toBe('token stored');
    expect(parsed.ts).toMatch(ISO_8601);
  });
});

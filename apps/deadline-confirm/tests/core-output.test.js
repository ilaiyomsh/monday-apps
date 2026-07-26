// Contract tests for the user-facing output surfaces (v2):
// - src/helpers/pages.js   — spec §7 (three /confirm pages) + §8 (OAuth pages)
//                            + v2 confirmLandingPage (mail-scanner protection,
//                            owner decision 2026-07-15)
// - src/helpers/snippet.js — v2 dynamic button snippet (per-button status
//                            column + label + style color/icon/size); v3 adds
//                            accountId → the a= param in every confirm href
// - src/helpers/logger.js  — spec §6 log line {ts, ip, itemId, outcome}
// Security constraints from §13: static pages only, no JS (EXCEPT the
// landing page's inline auto-submit script), no external assets.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  successPage,
  invalidPage,
  badRequestPage,
  oauthDonePage,
  oauthErrorPage,
  confirmLandingPage,
} from '../src/helpers/pages.js';
import { renderSnippet, BUTTON_SIZES } from '../src/helpers/snippet.js';
import { logAttempt, logError, logInfo } from '../src/helpers/logger.js';

describe('pages', () => {
  const allPages = [
    ['successPage', () => successPage('בוצע')],
    ['invalidPage', () => invalidPage()],
    ['badRequestPage', () => badRequestPage()],
    ['oauthDonePage', () => oauthDonePage()],
    ['oauthErrorPage', () => oauthErrorPage('סיבה קצרה')],
  ];

  it.each(allPages)('%s declares an RTL Hebrew document: <html dir="rtl" lang="he">', (_name, render) => {
    expect(render()).toContain('<html dir="rtl" lang="he">');
  });

  // v4 phase 1 (owner decision 2026-07-19): the SUCCESS page is the ONE
  // result page allowed an inline script — auto-close after 2s (pinned in
  // tests/pages-autoclose.test.js). Every other page stays JS-free.
  const jsFreePages = allPages.filter(([name]) => name !== 'successPage');

  it.each(jsFreePages)('%s contains no <script tag', (_name, render) => {
    expect(render().toLowerCase()).not.toContain('<script');
  });

  it.each(allPages)('%s references no external assets (no http:// or https:// anywhere)', (_name, render) => {
    const html = render();
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('successPage shows the exact heading "המשימה עודכנה ✓"', () => {
    expect(successPage('בוצע')).toContain('המשימה עודכנה ✓');
  });

  it('successPage shows the exact body line for toLabel="בוצע"', () => {
    expect(successPage('בוצע')).toContain('הסטטוס שונה ל"בוצע".');
  });

  it('successPage HTML-escapes toLabel: "<b>&x" never appears raw, appears escaped', () => {
    const html = successPage('<b>&x');
    expect(html).not.toContain('<b>&x');
    expect(html).toContain('&lt;b&gt;&amp;x');
  });

  it('invalidPage shows the exact heading "הקישור אינו בתוקף"', () => {
    expect(invalidPage()).toContain('הקישור אינו בתוקף');
  });

  it('invalidPage shows the exact §7.2 body line', () => {
    expect(invalidPage()).toContain(
      'ייתכן שהמשימה כבר טופלה או שהקישור הוחלף. אפשר לבדוק את הסטטוס ישירות בלוח.',
    );
  });

  it('badRequestPage shows the exact heading "בקשה שגויה"', () => {
    expect(badRequestPage()).toContain('בקשה שגויה');
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

describe('confirmLandingPage', () => {
  const params = { itemId: '9876543210', k: 'SEC123', btn: 'b_test1234', a: '777' };
  const render = (overrides = {}) => confirmLandingPage({ ...params, ...overrides });

  /** the opening <form ...> tag, or '' when absent */
  const formTag = (html) => html.match(/<form\b[^>]*>/i)?.[0] ?? '';
  /** the full <input ...> tag whose name attribute equals `name`, or undefined */
  const inputByName = (html, name) =>
    (html.match(/<input\b[^>]*>/gi) ?? []).find((tag) => tag.includes(`name="${name}"`));

  it('declares an RTL Hebrew document: <html dir="rtl" lang="he">', () => {
    expect(render()).toContain('<html dir="rtl" lang="he">');
  });

  it('renders a form that POSTs back to /confirm (method="post", action="/confirm")', () => {
    const tag = formTag(render());
    expect(tag).toContain('method="post"');
    expect(tag).toContain('action="/confirm"');
  });

  it.each([
    ['itemId', '9876543210'],
    ['k', 'SEC123'],
    ['btn', 'b_test1234'],
    ['a', '777'],
  ])('carries %s as a HIDDEN input with the exact passed value "%s"', (name, value) => {
    const tag = inputByName(render(), name);
    expect(tag).toBeDefined();
    expect(tag).toContain('type="hidden"');
    expect(tag).toContain(`value="${value}"`);
  });

  it('attribute-escapes input values: k=\'a"b<c\' never appears raw, appears as a&quot;b&lt;c', () => {
    const html = render({ k: 'a"b<c' });
    expect(html).not.toContain('a"b<c');
    expect(html).toContain('a&quot;b&lt;c');
  });

  it('attribute-escapes the a value exactly like the others: a=\'7"7<7\' appears as 7&quot;7&lt;7', () => {
    const html = render({ a: '7"7<7' });
    expect(html).not.toContain('7"7<7');
    expect(html).toContain('7&quot;7&lt;7');
  });

  it('contains an INLINE <script> (no src=) that submits the form', () => {
    const script = render().match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    expect(script).not.toBeNull();
    expect(script[0]).not.toContain('src=');
    expect(script[1]).toContain('.submit()');
  });

  it('contains a <noscript> fallback INSIDE the form with a submit button reading "המשך לאישור"', () => {
    const html = render();
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/i);
    expect(noscript).not.toBeNull();
    expect(noscript[1]).toMatch(/<button\b|<input\b[^>]*type="submit"/i);
    expect(noscript[1]).toContain('המשך לאישור');
    // inside the form: <form ...> ... <noscript> ... </form>
    const formOpen = html.search(/<form\b/i);
    const formClose = html.search(/<\/form>/i);
    const noscriptAt = html.search(/<noscript>/i);
    expect(formOpen).toBeGreaterThanOrEqual(0);
    expect(noscriptAt).toBeGreaterThan(formOpen);
    expect(noscriptAt).toBeLessThan(formClose);
  });

  it('shows the interim text "מאשר את המשימה"', () => {
    expect(render()).toContain('מאשר את המשימה');
  });

  it('references no external http(s) assets (form action is relative)', () => {
    const html = render();
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });
});

describe('renderSnippet (v2 dynamic buttons, v3 accountId)', () => {
  const baseUrl = 'https://x.example';
  const secret = 'SEC123';
  const accountId = '777';
  const button = {
    id: 'b_test1234',
    name: 'בוצע',
    style: { color: '#00854d', icon: '✓', size: 'md' },
  };
  const render = (btn = button) => renderSnippet({ baseUrl, secret, button: btn, accountId });
  const withStyle = (style) => ({ ...button, style: { ...button.style, ...style } });
  /** inner HTML of the first <a> element, or undefined */
  const anchorText = (html) => html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];

  it('BUTTON_SIZES pins exactly sm/md/lg with the email-safe px values', () => {
    expect(BUTTON_SIZES).toEqual({
      sm: { fontSize: 13, padding: '8px 20px' },
      md: { fontSize: 16, padding: '12px 32px' },
      lg: { fontSize: 20, padding: '16px 40px' },
    });
  });

  it('renders the exact href with the PINNED param order itemId, a, k, btn: baseUrl/confirm?itemId={ITEM_ID}&amp;a=<accountId>&amp;k=<secret>&amp;btn=<id> ({ITEM_ID} literal)', () => {
    expect(render()).toContain(
      'href="https://x.example/confirm?itemId={ITEM_ID}&amp;a=777&amp;k=SEC123&amp;btn=b_test1234"',
    );
  });

  it('joins query params with the HTML entity &amp; — a bare & separator never appears in the href', () => {
    expect(render()).not.toContain('itemId={ITEM_ID}&a=');
    expect(render()).not.toContain('&k=');
    expect(render()).not.toContain('&btn=');
  });

  it('shows the visible label "✓ בוצע" (icon, space, name)', () => {
    expect(render()).toContain('✓ בוצע');
  });

  it('uses the button style color as background-color:#00854d', () => {
    expect(render()).toContain('background-color:#00854d');
  });

  it.each([
    ['sm', '13px', '8px 20px'],
    ['md', '16px', '12px 32px'],
    ['lg', '20px', '16px 40px'],
  ])('size "%s" renders font-size:%s and padding:%s', (size, fontSize, padding) => {
    const html = render(withStyle({ size }));
    expect(html).toContain(`font-size:${fontSize}`);
    expect(html).toContain(`padding:${padding}`);
  });

  it('unknown size "xl" falls back to md sizing (font-size:16px, padding:12px 32px)', () => {
    const html = render(withStyle({ size: 'xl' }));
    expect(html).toContain('font-size:16px');
    expect(html).toContain('padding:12px 32px');
  });

  it('missing icon → the visible text is exactly the name "בוצע" with NO leading space', () => {
    const { icon: _dropped, ...styleWithoutIcon } = button.style;
    const html = render({ ...button, style: styleWithoutIcon });
    expect(anchorText(html)).toBe('בוצע');
  });

  it('empty-string icon → the visible text is exactly the name "בוצע" with NO leading space', () => {
    const html = render(withStyle({ icon: '' }));
    expect(anchorText(html)).toBe('בוצע');
  });

  it('HTML-escapes the name: "<b>&x" never appears raw, appears as &lt;b&gt;&amp;x', () => {
    const html = render({ ...button, name: '<b>&x' });
    expect(html).not.toContain('<b>&x');
    expect(html).toContain('&lt;b&gt;&amp;x');
  });

  it('HTML-escapes the icon: "<i>" never appears raw, appears as &lt;i&gt;', () => {
    const html = render(withStyle({ icon: '<i>' }));
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;i&gt;');
  });

  it('wraps the button in an email-safe table with role="presentation"', () => {
    expect(render()).toMatch(/<table\b[^>]*\brole="presentation"/i);
  });

  it('contains no <script tag', () => {
    expect(render().toLowerCase()).not.toContain('<script');
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

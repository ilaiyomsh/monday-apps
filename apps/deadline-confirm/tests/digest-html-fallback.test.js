// 0.10.3 — the non-actionable text/html fallback part.
//
// Two things carry weight here and are why this is its own suite:
//
//  1. NON-ACTIONABILITY. V6's locked D1/D2 bans an ACTIONABLE text/html body
//     (the /confirm link family that put a secret in a URL). This part is
//     derived from the plain-text digest and must stay inert: no anchors, no
//     forms, no scripts, no remote images. Asserted, not just documented —
//     otherwise the next person to "improve the fallback" reopens the hole
//     that retiring /confirm closed.
//  2. ESCAPING. The digest carries user-controlled strings — monday item names
//     and status labels. An item literally named `<script>` must not become
//     markup in the recipient's mail client.

import { describe, it, expect } from 'vitest';
import { escapeHtml, renderHtmlFallback } from '../src/helpers/digest-html-fallback.js';

const PLAIN = [
  'שלום עילי שלם,',
  'אלו המשימות שממתינות לעדכון סטטוס:',
  '',
  'משימות שנדרש להתחיל וטרם התחילו:',
  '- Item 1 · תאריך התחלה: 22/07/2026 · סטטוס: טרם החל',
].join('\n');

describe('escapeHtml', () => {
  it('escapes every character that could open a tag or attribute', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
    );
  });

  it('escapes the ampersand FIRST — otherwise entities get double-escaped', () => {
    // A naive replace order turns '<' into '&lt;' and then that '&' into
    // '&amp;lt;', which renders as literal "&lt;" to the recipient.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves Hebrew and ordinary punctuation untouched', () => {
    expect(escapeHtml('משימה · 22/07/2026')).toBe('משימה · 22/07/2026');
  });
});

describe('renderHtmlFallback — structure', () => {
  it('produces a complete RTL document', () => {
    const html = renderHtmlFallback(PLAIN);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html dir="rtl" lang="he">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('carries every non-empty source line through as its own block', () => {
    const html = renderHtmlFallback(PLAIN);
    expect(html).toContain('<div>שלום עילי שלם,</div>');
    expect(html).toContain('<div>משימות שנדרש להתחיל וטרם התחילו:</div>');
    expect(html).toContain('<div>- Item 1 · תאריך התחלה: 22/07/2026 · סטטוס: טרם החל</div>');
  });

  it('turns a blank source line into spacing, not an empty paragraph', () => {
    const html = renderHtmlFallback('a\n\nb');
    expect(html).toContain('<div style="height:10px"></div>');
    expect(html).not.toContain('<div></div>');
  });

  it('normalizes CRLF so a Windows-style plain part does not double up', () => {
    expect(renderHtmlFallback('a\r\nb')).toBe(renderHtmlFallback('a\nb'));
  });

  it('rejects a missing or empty plain part instead of shipping a blank body', () => {
    expect(() => renderHtmlFallback('')).toThrow(/required/);
    expect(() => renderHtmlFallback(null)).toThrow(/required/);
    expect(() => renderHtmlFallback(undefined)).toThrow(/required/);
  });
});

describe('renderHtmlFallback — non-actionable (V6 D1/D2)', () => {
  it('emits no anchor, form, script or remote image — nothing to click', () => {
    const html = renderHtmlFallback(PLAIN);
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('href');
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<img[\s>]/i);
    expect(html).not.toMatch(/https?:/i);
  });

  it('cannot be turned actionable by a hostile item name', () => {
    // An item named to inject a confirm link: the whole point of D1/D2 is that
    // no clickable write path reaches the recipient's client.
    const hostile = '- <a href="https://evil.example/confirm?k=secret">בוצע</a>';
    const html = renderHtmlFallback(`שלום,\n${hostile}`);
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain('&lt;a href=&quot;https://evil.example');
  });

  it('neutralizes a script tag in a status label', () => {
    const html = renderHtmlFallback('שלום,\n- <script>alert(1)</script>');
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain('&lt;script&gt;');
  });
});

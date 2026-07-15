// Contract tests for src/helpers/email-template.js (v2 block-based email
// templates, rendered server-side to email-client-safe HTML: nested tables,
// inline styles, no JS/external assets, {ITEM_ID} literal in button hrefs).
// v3: renderEmailTemplate takes accountId and forwards it to every embedded
// button snippet — each href carries a=<accountId>.

import { describe, it, expect } from 'vitest';
import { renderEmailTemplate, ALLOWED_FONTS } from '../src/helpers/email-template.js';

const baseUrl = 'https://x.example';
const secret = 'SEC123';
const accountId = '777';

const buttons = [
  { id: 'b_aaaa1111', name: 'בוצע', style: { color: '#00854d', icon: '✓', size: 'md' } },
  { id: 'b_bbbb2222', name: 'בעבודה', style: { color: '#fdab3d', icon: '', size: 'sm' } },
];

const template = {
  id: 'tpl_1',
  name: 'תבנית ברירת מחדל',
  blocks: [
    {
      type: 'text',
      text: 'שלום!\nהמשימה שלך מתחילה',
      direction: 'rtl',
      font: 'Arial',
      fontSize: 16,
      align: 'right',
    },
    { type: 'buttons', buttonIds: ['b_aaaa1111', 'b_bbbb2222'] },
    {
      type: 'text',
      text: 'בברכה <צוות>',
      direction: 'ltr',
      font: 'Georgia',
      fontSize: 12,
      align: 'left',
    },
  ],
};

const render = (tpl = template) =>
  renderEmailTemplate({ baseUrl, secret, template: tpl, buttons, accountId });

describe('renderEmailTemplate', () => {
  it('wraps everything in an outer <table role="presentation"> with width="600"', () => {
    const outerTag = render().match(/<table\b[^>]*>/i)?.[0] ?? '';
    expect(outerTag).toContain('role="presentation"');
    expect(outerTag).toContain('width="600"');
  });

  it('first text block renders a dir="rtl" cell with Arial, font-size:16px, text-align:right', () => {
    const html = render();
    expect(html).toMatch(/<td\b[^>]*dir="rtl"/i);
    expect(html).toMatch(/font-family:[^;]*Arial/);
    expect(html).toContain('font-size:16px');
    expect(html).toContain('text-align:right');
  });

  it('converts the newline inside a text block to <br> (raw \\n between the lines is gone)', () => {
    const html = render();
    expect(html).toContain('שלום!<br>המשימה שלך מתחילה');
    expect(html).not.toContain('שלום!\nהמשימה שלך מתחילה');
  });

  it('third text block renders a dir="ltr" cell with Georgia, font-size:12px, text-align:left', () => {
    const html = render();
    expect(html).toMatch(/<td\b[^>]*dir="ltr"/i);
    expect(html).toMatch(/font-family:[^;]*Georgia/);
    expect(html).toContain('font-size:12px');
    expect(html).toContain('text-align:left');
  });

  it('HTML-escapes text content: "<צוות>" never appears raw, appears as &lt;צוות&gt;', () => {
    const html = render();
    expect(html).not.toContain('<צוות>');
    expect(html).toContain('&lt;צוות&gt;');
  });

  it('buttons block renders BOTH button hrefs with the literal {ITEM_ID}, a=<accountId>, &amp;k=<secret> and each btn id (pinned param order)', () => {
    const html = render();
    expect(html).toContain(
      'href="https://x.example/confirm?itemId={ITEM_ID}&amp;a=777&amp;k=SEC123&amp;btn=b_aaaa1111"',
    );
    expect(html).toContain(
      'href="https://x.example/confirm?itemId={ITEM_ID}&amp;a=777&amp;k=SEC123&amp;btn=b_bbbb2222"',
    );
  });

  it('every rendered button href carries the a= account param (none is missing it)', () => {
    const html = render();
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(href).toContain('a=777');
    }
  });

  it('renders the two button snippets in buttonIds order (b_aaaa1111 before b_bbbb2222)', () => {
    const html = render();
    const first = html.indexOf('btn=b_aaaa1111');
    const second = html.indexOf('btn=b_bbbb2222');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it('each rendered button carries its own config: b_bbbb2222 gets sm sizing and its exact icon-less label', () => {
    const html = render();
    expect(html).toContain('font-size:13px');
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const second = anchors.find(([, href]) => href.includes('btn=b_bbbb2222'));
    expect(second).toBeDefined();
    expect(second[2]).toBe('בעבודה'); // empty icon → name only, no leading space
  });

  it('a buttons block referencing a MISSING button id renders without throwing and omits that id', () => {
    const tpl = {
      ...template,
      blocks: [{ type: 'buttons', buttonIds: ['b_aaaa1111', 'b_missing99'] }],
    };
    let html;
    expect(() => {
      html = render(tpl);
    }).not.toThrow();
    expect(html).toContain('btn=b_aaaa1111');
    expect(html).not.toContain('b_missing99');
  });

  it('contains no <script tag anywhere', () => {
    expect(render().toLowerCase()).not.toContain('<script');
  });
});

describe('ALLOWED_FONTS', () => {
  it('pins exactly the six email-safe fonts, including Arial and Times New Roman', () => {
    expect(ALLOWED_FONTS).toEqual([
      'Arial',
      'Tahoma',
      'Verdana',
      'Georgia',
      'Times New Roman',
      'Courier New',
    ]);
  });
});

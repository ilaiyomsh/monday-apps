// TDD red phase (0.14.0) — the text/plain part is built from the same BLOCKS as
// the AMP part, so the two can never say different things. It keeps its hard
// V6 requirement unchanged: no links, no signatures, no credential of any kind
// (D2/D3) — and now that the operator authors the text, that has to hold for
// what THEY typed too: their text is inserted as text, never turned into a link.
//
// The html fallback is derived from this part (digest-html-fallback.js), so
// whatever is asserted here is what non-AMP clients render.

import { describe, it, expect } from 'vitest';
import { renderDigestPlain } from '../src/helpers/digest-plain.js';
import { renderHtmlFallback } from '../src/helpers/digest-html-fallback.js';
import { LEGACY_TEXTS, legacyBlocksFromSections } from '../src/services/digest-blocks.js';

const SECTION = {
  sectionId: 's_done0001',
  title: 'משימות לסיום:',
  dateColumnTitle: 'תאריך סיום',
  buttonId: 'b_done0001',
  tasks: [
    { itemId: '9001', name: 'דוח רבעוני', date: '2026-02-28', statusText: 'בעבודה' },
    { itemId: '9002', name: 'סקירת יעדים', date: '2026-03-01', statusText: '' },
  ],
};

const RECIPIENT = {
  email: 'dana@example.com',
  name: 'דנה כהן',
  personId: '501',
  taskCount: 2,
  sections: [SECTION],
};

const text = (over = {}) => ({
  type: 'text',
  id: 'x_t0000001',
  text: 'שלום',
  direction: 'rtl',
  font: 'Default',
  fontSize: 16,
  align: 'right',
  color: '#323338',
  bold: false,
  ...over,
});

const cluster = (id = 's_done0001') => ({ type: 'cluster', id });
const render = (blocks, recipient = RECIPIENT) => renderDigestPlain({ recipient, blocks });

describe('renderDigestPlain — the blocks are the content', () => {
  it('carries none of the pre-0.14.0 sentences when the blocks carry none', () => {
    const out = render([cluster()]);
    expect(out).not.toContain('שלום');
    expect(out).not.toContain('אלו המשימות שממתינות לעדכון סטטוס');
    expect(out).not.toContain('לעדכון המשימות היכנסו');
  });

  it('still lists the tasks — the fallback has to be readable on its own', () => {
    const out = render([cluster()]);
    expect(out).toContain('משימות לסיום:');
    expect(out).toContain('דוח רבעוני');
    expect(out).toContain('תאריך סיום: 28/02/2026');
    expect(out).toContain('סטטוס: בעבודה');
  });

  it('renders text blocks in block order, around the clusters', () => {
    const out = render([
      text({ text: 'פתיחה' }),
      cluster(),
      text({ id: 'x_t0000002', text: 'סגירה' }),
    ]);
    expect(out.indexOf('פתיחה')).toBeLessThan(out.indexOf('דוח רבעוני'));
    expect(out.indexOf('סגירה')).toBeGreaterThan(out.indexOf('דוח רבעוני'));
  });

  it('substitutes the name token', () => {
    expect(render([text({ text: 'שלום {{שם}},' })])).toContain('שלום דנה כהן,');
  });

  it('keeps the authored line breaks', () => {
    expect(render([text({ text: 'שורה א\nשורה ב' })])).toContain('שורה א\nשורה ב');
  });

  it('separates blocks with a blank line so the text does not run together', () => {
    expect(render([text({ text: 'א' }), text({ id: 'x_t0000002', text: 'ב' })])).toContain('א\n\nב');
  });

  it('skips an empty text block instead of emitting stray blank lines', () => {
    expect(render([text({ text: '  ' }), text({ id: 'x_t0000002', text: 'ב' })]).trim()).toBe('ב');
  });

  it('drops a cluster the recipient has no tasks in', () => {
    const out = render([cluster('s_empty001')], {
      ...RECIPIENT,
      sections: [{ ...SECTION, sectionId: 's_empty001', tasks: [] }],
    });
    expect(out).not.toContain('משימות לסיום:');
  });

  it('falls back to the clusters alone when no blocks are passed (legacy call)', () => {
    const out = renderDigestPlain({ recipient: RECIPIENT });
    expect(out).toContain('דוח רבעוני');
    expect(out).not.toContain('שלום');
  });
});

describe('renderDigestPlain — V6 negative space survives operator-authored text', () => {
  it('never adds a link of its own', () => {
    expect(render([text({ text: 'טקסט' }), cluster()])).not.toMatch(/https?:\/\//);
  });

  it('inserts a typed URL as inert text — the html fallback cannot anchor it', () => {
    const plain = render([text({ text: 'ראו https://example.com/x' })]);
    expect(plain).toContain('https://example.com/x');
    const html = renderHtmlFallback(plain);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });

  it('carries no signature, slot or secret material', () => {
    const out = render(legacyBlocksFromSections([{ id: 's_done0001', title: 'משימות לסיום:' }]));
    expect(out).not.toMatch(/sig=|&s=|manifest/i);
  });
});

describe('renderDigestPlain — a legacy config still sends the legacy text', () => {
  const blocks = legacyBlocksFromSections([
    {
      id: 's_done0001',
      title: 'משימות לסיום:',
      dateColumnId: 'date_due',
      dateColumnTitle: 'תאריך סיום',
      buttonId: 'b_done0001',
      buttonIds: ['b_done0001'],
      includeStatusLabelIds: [1],
    },
  ]);

  it('greets by name and keeps the lead and footer sentences', () => {
    const out = render(blocks);
    expect(out).toContain('שלום דנה כהן,');
    expect(out).toContain(LEGACY_TEXTS.lead);
    expect(out).toContain(LEGACY_TEXTS.footer);
  });

  it('puts the tasks between them', () => {
    const out = render(blocks);
    expect(out.indexOf('שלום דנה כהן,')).toBeLessThan(out.indexOf('דוח רבעוני'));
    expect(out.indexOf(LEGACY_TEXTS.footer)).toBeGreaterThan(out.indexOf('דוח רבעוני'));
  });
});

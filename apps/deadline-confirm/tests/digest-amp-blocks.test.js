// TDD red phase (0.14.0) — the amp4email digest renders the operator's BLOCKS,
// in their order, and nothing else. Two properties are under test here and both
// were product decisions (owner, 2026-08-05):
//
//   * NO PRE-WRITTEN CONTENT. Without blocks the document carries clusters and
//     operational chrome only — no greeting, no instruction paragraph, no
//     footer. Every sentence a reader sees was authored in the admin.
//   * TEXT IS DATA. A block's text is escaped and its styling is emitted as a
//     generated class (amp4email strict CSS), so neither the operator's text nor
//     the substituted recipient name can introduce markup, and a font name can
//     never reach the stylesheet unless it is on the allowlist.
//
// A cluster block whose recipient has no matching tasks is dropped; the text
// blocks around it still render (owner decision: text is unconditional).

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';
import { LEGACY_TEXTS, legacyBlocksFromSections } from '../src/services/digest-blocks.js';

const BASE = 'https://app.example.com';
const SECRET = 'S3cr3t-link-secret-value-0123456789';
const ACCOUNT = '4242';
const PERSON_ID = '501';
const NOW = new Date('2026-08-05T09:00:00.000Z');

const BTN_DONE = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const section = (over = {}) => ({
  sectionId: 's_done0001',
  title: 'משימות לסיום:',
  dateColumnTitle: 'תאריך סיום',
  buttonId: BTN_DONE.id,
  buttonIds: [BTN_DONE.id],
  button: BTN_DONE,
  buttons: [BTN_DONE],
  tasks: [{ itemId: '9001', name: 'דוח רבעוני', date: '2026-02-28', statusText: 'בעבודה' }],
  ...over,
});

const RECIPIENT = {
  email: 'dana@example.com',
  name: 'דנה כהן',
  personId: PERSON_ID,
  taskCount: 1,
  sections: [section()],
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

const render = (blocks, recipient = RECIPIENT) =>
  renderDigestAmp({
    baseUrl: BASE,
    secret: SECRET,
    accountId: ACCOUNT,
    recipient,
    blocks,
    sendHour: 8,
    now: NOW,
  });

describe('renderDigestAmp — no content text of its own', () => {
  it('ships none of the pre-0.14.0 sentences when the blocks carry none', () => {
    const doc = render([cluster()]);
    expect(doc).not.toContain('שלום');
    expect(doc).not.toContain(LEGACY_TEXTS.lead);
    expect(doc).not.toContain(LEGACY_TEXTS.footer);
    expect(doc).not.toContain('מייל אוטומטי');
  });

  it('still ships the operational chrome — the mail has to be usable', () => {
    const doc = render([cluster()]);
    expect(doc).toContain('סטטוס'); // the status caption / column header
    expect(doc).toContain('תאריך סיום'); // the board column's own title
    expect(doc).toContain('<div submitting>');
    expect(doc).toContain('משימות לסיום:'); // the cluster title, authored per block
  });

  it('renders the tasks with no blocks passed at all (legacy call shape)', () => {
    const doc = renderDigestAmp({
      baseUrl: BASE,
      secret: SECRET,
      accountId: ACCOUNT,
      recipient: RECIPIENT,
      sendHour: 8,
      now: NOW,
    });
    expect(doc).toContain('דוח רבעוני');
    expect(doc).not.toContain('מייל אוטומטי');
  });
});

describe('renderDigestAmp — text blocks', () => {
  it('renders a text block above the cluster it precedes', () => {
    const doc = render([text({ text: 'לפני' }), cluster(), text({ id: 'x_t0000002', text: 'אחרי' })]);
    expect(doc.indexOf('לפני')).toBeLessThan(doc.indexOf('דוח רבעוני'));
    expect(doc.indexOf('אחרי')).toBeGreaterThan(doc.indexOf('דוח רבעוני'));
  });

  it('substitutes the recipient name token', () => {
    expect(render([text({ text: 'שלום {{שם}}, יש לך משימות' })])).toContain('שלום דנה כהן, יש לך משימות');
  });

  it('preserves the authored line breaks instead of collapsing them', () => {
    const doc = render([text({ text: 'שורה\nשורה שנייה' })]);
    expect(doc).toContain('שורה\nשורה שנייה');
    expect(doc).toMatch(/\.tb \{[^}]*white-space:pre-wrap/);
  });

  it('escapes the authored text — a block can never inject markup', () => {
    const doc = render([text({ text: '<script>alert(1)</script> & <b>' })]);
    expect(doc).not.toContain('<script>');
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).toContain('&amp;');
  });

  it('escapes the substituted name too', () => {
    const doc = render([text({ text: '{{שם}}' })], { ...RECIPIENT, name: '<img src=x>' });
    expect(doc).not.toContain('<img src=x>');
    expect(doc).toContain('&lt;img src=x&gt;');
  });

  it('emits the block style as a generated class, not an inline style attribute', () => {
    const doc = render([text({ fontSize: 18, align: 'center', color: '#676879', bold: true })]);
    expect(doc).toMatch(/<div class="tb tb0" dir="rtl">/);
    expect(doc).toMatch(/\.tb0 \{[^}]*font-size:18px/);
    expect(doc).toMatch(/\.tb0 \{[^}]*text-align:center/);
    expect(doc).toMatch(/\.tb0 \{[^}]*color:#676879/);
    expect(doc).toMatch(/\.tb0 \{[^}]*font-weight:bold/);
  });

  it('gives each text block its own class so two blocks cannot share styling', () => {
    const doc = render([
      text({ fontSize: 12 }),
      text({ id: 'x_t0000002', fontSize: 28 }),
    ]);
    expect(doc).toMatch(/\.tb0 \{[^}]*font-size:12px/);
    expect(doc).toMatch(/\.tb1 \{[^}]*font-size:28px/);
    expect(doc).toContain('class="tb tb1"');
  });

  it('carries the block direction on the element, not just in the sheet', () => {
    expect(render([text({ direction: 'ltr', align: 'left' })])).toContain('<div class="tb tb0" dir="ltr">');
  });

  it("maps the 'Default' font to the document's own stack", () => {
    const doc = render([text({ font: 'Default' })]);
    expect(doc).toMatch(/\.tb0 \{[^}]*font-family:Figtree/);
  });

  it('emits a picked font by name', () => {
    expect(render([text({ font: 'Georgia' })])).toMatch(/\.tb0 \{[^}]*font-family:Georgia/);
  });

  it('refuses a font that is not on the allowlist — CSS is not a free-text field', () => {
    // Asserting the PAYLOAD verbatim, not the substring 'display:none': the base
    // sheet legitimately hides .thead below the wide breakpoint, so a bare
    // substring check passes on a document that never sanitized anything.
    const doc = render([text({ font: 'Arial; } body { display:none } .x {' })]);
    expect(doc).not.toContain('body { display:none }');
    expect(doc).not.toContain('.x {');
    expect(doc).toMatch(/\.tb0 \{[^}]*font-family:Figtree/);
  });

  it('skips a block whose text is empty rather than emitting a hollow element', () => {
    const doc = render([text({ text: '   ' }), cluster()]);
    expect(doc).not.toContain('class="tb tb0"');
    expect(doc).toContain('דוח רבעוני');
  });
});

describe('renderDigestAmp — cluster blocks', () => {
  it('renders only the clusters the block list names', () => {
    const recipient = {
      ...RECIPIENT,
      sections: [section(), section({ sectionId: 's_other001', title: 'מקבץ אחר:', tasks: [{ itemId: '9002', name: 'משימה אחרת', date: '2026-02-01', statusText: '' }] })],
    };
    const doc = render([cluster('s_other001')], recipient);
    expect(doc).toContain('משימה אחרת');
    expect(doc).not.toContain('דוח רבעוני');
  });

  it('follows block order, not the order the recipient data arrived in', () => {
    const recipient = {
      ...RECIPIENT,
      sections: [section(), section({ sectionId: 's_other001', title: 'מקבץ אחר:', tasks: [{ itemId: '9002', name: 'משימה אחרת', date: '2026-02-01', statusText: '' }] })],
    };
    const doc = render([cluster('s_other001'), cluster('s_done0001')], recipient);
    expect(doc.indexOf('משימה אחרת')).toBeLessThan(doc.indexOf('דוח רבעוני'));
  });

  it('drops a cluster this recipient has no tasks in, and keeps the text around it', () => {
    const doc = render(
      [text({ text: 'כותרת' }), cluster('s_empty001'), text({ id: 'x_t0000002', text: 'סיום' })],
      { ...RECIPIENT, sections: [section({ sectionId: 's_empty001', tasks: [] })] }
    );
    expect(doc).toContain('כותרת');
    expect(doc).toContain('סיום');
    expect(doc).not.toContain('<div submitting>');
    // The whole cluster goes, not just its rows: a title and a column-header
    // strip with nothing under them is the bug this drop exists to prevent.
    expect(doc).not.toContain('class="cluster"');
    expect(doc).not.toContain('משימות לסיום:');
    expect(doc).not.toContain('class="thead"');
  });

  it('ignores a cluster block the recipient data has no section for', () => {
    const doc = render([cluster('s_ghost001'), cluster()]);
    expect(doc).toContain('דוח רבעוני');
    expect((doc.match(/<div class="cluster">/g) ?? []).length).toBe(1);
  });
});

describe('renderDigestAmp — a legacy config still sends the legacy mail', () => {
  const blocks = legacyBlocksFromSections([
    {
      id: 's_done0001',
      title: 'משימות לסיום:',
      dateColumnId: 'date_due',
      dateColumnTitle: 'תאריך סיום',
      buttonId: BTN_DONE.id,
      buttonIds: [BTN_DONE.id],
      includeStatusLabelIds: [1],
    },
  ]);

  it('greets by name, keeps the instruction paragraph and the footer', () => {
    const doc = render(blocks);
    expect(doc).toContain('שלום דנה כהן,');
    expect(doc).toContain(LEGACY_TEXTS.lead);
    expect(doc).toContain('מייל אוטומטי');
  });

  it('puts the greeting before the tasks and the footer after them', () => {
    const doc = render(blocks);
    expect(doc.indexOf('שלום דנה כהן,')).toBeLessThan(doc.indexOf('דוח רבעוני'));
    expect(doc.indexOf('מייל אוטומטי')).toBeGreaterThan(doc.indexOf('דוח רבעוני'));
  });
});

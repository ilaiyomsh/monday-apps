// TDD red phase (0.16.2) — the status menu of the LAST row must be fully
// visible, and the document must carry an outer safety margin.
//
// The bug, reported from a real inbox: the bottom row's dropdown was cut off by
// the email's bottom edge. The menu is `position:absolute; top:100%`, so it
// lives OUTSIDE the flow — the document's height at load time does not include
// it, and the dynamic-email frame is sized from that height. Opening the menu of
// the last row therefore paints into space the frame does not have.
//
// amp4email cannot do what a browser widget does here: there is no JS, no
// viewport API and no container query, so nothing can measure the space below a
// trigger and flip the menu upward. The deterministic equivalent — and the only
// one available — is to GUARANTEE the space exists: reserve, in the flow, the
// height of the tallest menu the document can open.
//
// Two properties are under test:
//   * The reserve exists, sits LAST inside the card (so the menu opens onto the
//     card, and the tap-away overlay still covers it), and is sized from the
//     WIDEST cluster in the document — one cluster with four buttons dictates
//     the reserve even if every other cluster has one.
//   * A document with no cluster reserves nothing: there is no menu to open.
//
// The reserve deliberately does NOT net out the padding that already sits below
// the last row (form padding, card padding, body padding). A number derived from
// five other numbers breaks silently the day one of them changes; a full-height
// reserve can only ever be too generous, and "too generous" is what the owner
// asked for ("מרווח ביטחון").

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';

const BASE = 'https://app.example.com';
const SECRET = 'S3cr3t-link-secret-value-0123456789';
const ACCOUNT = '4242';
const PERSON_ID = '501';
const NOW = new Date('2026-08-06T09:00:00.000Z');

/** Mirrors the sheet: .dd-menu margin-top + padding*2 + n*38 + (n-1)*4. */
const menuHeight = (n) => 4 + 16 + n * 38 + (n - 1) * 4;

const button = (id, color) => ({
  id,
  name: id,
  statusColumnId: 'status',
  targetIndex: 1,
  targetLabel: id,
  style: { color },
});

const BTN_A = button('b_aaaa0001', '#00854d');
const BTN_B = button('b_bbbb0001', '#fdab3d');
const BTN_C = button('b_cccc0001', '#e2445c');
const BTN_D = button('b_dddd0001', '#0073ea');

const section = (sectionId, buttons, tasks) => ({
  sectionId,
  title: `מקבץ ${sectionId}`,
  dateColumnTitle: 'תאריך סיום',
  buttonId: buttons[0].id,
  buttonIds: buttons.map((b) => b.id),
  button: buttons[0],
  buttons,
  tasks,
});

const task = (itemId) => ({ itemId, name: `משימה ${itemId}`, date: '2026-08-01', statusText: 'בעבודה' });

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

const render = (sections, blocks) =>
  renderDigestAmp({
    baseUrl: BASE,
    secret: SECRET,
    accountId: ACCOUNT,
    recipient: { email: 'dana@example.com', name: 'דנה כהן', personId: PERSON_ID, sections },
    blocks,
    sendHour: 8,
    now: NOW,
  });

/** The generated `.dd-tail { … height:NNNpx … }` rule's height, or null. */
const reservedHeight = (doc) => {
  const rule = doc.match(/\.dd-tail \{([^}]*)\}/);
  if (!rule) return null;
  const height = rule[1].match(/height:(\d+)px/);
  return height ? Number(height[1]) : null;
};

describe('amp digest — room for the last row\'s status menu', () => {
  it('reserves the tallest menu\'s height in the flow', () => {
    const doc = render([section('s_1', [BTN_A, BTN_B], [task('9001')])]);

    expect(doc).toContain('class="dd-tail"');
    expect(reservedHeight(doc)).toBe(menuHeight(2));
  });

  it('sizes the reserve from the WIDEST cluster, not the last one', () => {
    const wide = section('s_wide', [BTN_A, BTN_B, BTN_C, BTN_D], [task('9001')]);
    const narrow = section('s_narrow', [BTN_A], [task('9002')]);

    expect(reservedHeight(render([wide, narrow]))).toBe(menuHeight(4));
    // Order must not matter — the reserve is a document-wide property.
    expect(reservedHeight(render([narrow, wide]))).toBe(menuHeight(4));
  });

  it('puts the reserve LAST inside the card, so the menu opens onto the card', () => {
    const doc = render([section('s_1', [BTN_A, BTN_B], [task('9001')])]);

    // Last child of .wrap: the tap-away overlay (absolute, inset 0 of .wrap)
    // then covers it, and the menu never paints onto the page background.
    expect(doc).toMatch(/<div class="dd-tail"><\/div>\s*<\/div>\s*<\/body>/);
  });

  it('reserves nothing when the document has no cluster', () => {
    const doc = render([], [text()]);

    expect(doc).not.toContain('dd-tail');
    expect(reservedHeight(doc)).toBeNull();
  });

  it('keeps the reserve out of the media query — it must not depend on width', () => {
    const doc = render([section('s_1', [BTN_A, BTN_B], [task('9001')])]);
    const queries = doc.match(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? [];

    for (const query of queries) expect(query).not.toContain('dd-tail');
  });
});

describe('amp digest — outer safety margin', () => {
  const doc = render([section('s_1', [BTN_A], [task('9001')])]);

  it('gives the page a wide bottom gutter under the card', () => {
    const body = doc.match(/body \{([^}]*)\}/);
    const padding = body[1].match(/padding:(\d+)px (\d+)px (\d+)px/);

    expect(padding, `body padding is not a 3-value shorthand: ${body[1]}`).not.toBeNull();
    const [, top, side, bottom] = padding.map(Number);
    expect(bottom).toBeGreaterThanOrEqual(24);
    expect(top).toBeGreaterThanOrEqual(18);
    expect(side).toBeGreaterThanOrEqual(14);
  });

  it('gives the card itself room to breathe', () => {
    const wrap = doc.match(/\.wrap \{([^}]*)\}/);
    const padding = Number(wrap[1].match(/padding:(\d+)px/)[1]);

    expect(padding).toBeGreaterThanOrEqual(20);
  });
});

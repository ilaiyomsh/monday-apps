// TDD — one document, two layouts (owner decision 2026-08-04): a card per task
// on a narrow screen, aligned columns with a header strip on a wide one.
//
// The DIRECTION is the load-bearing decision. amp4email has no JS, no viewport
// API, and the `media` attribute only applies to amp-* elements, so the only
// detection available is a CSS media query. Therefore the CARD layout is the
// BASE and the wide layout is added inside `@media (min-width: …)`:
//   - a client that honours media queries gets the table on a desktop screen;
//   - a client that strips them gets cards everywhere, which is exactly what
//     0.13.0 already ships. The inverse polarity (table base + max-width query)
//     would hand that same client a squashed table on a phone.
//
// The wide layout is a VISUAL table, not a <table>: a <form> cannot span two
// <td>s and per-row forms are what give each row its own loader and ✓. Columns
// line up because every row is the same width and the cells carry the same
// percentages — which is also why the widths must leave room for the whitespace
// gaps between inline-blocks and must NOT sum to 100%.

import { describe, it, expect } from 'vitest';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';

const BASE = 'https://app.example';
const SECRET = 'SECRET43';

const BTN_WORK = {
  id: 'b_work0001',
  name: 'התחלתי',
  statusColumnId: 'color_x',
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#fdab3d' },
};
const BTN_DONE = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'color_x',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d' },
};

const task = (itemId, name) => ({ itemId, name, date: '2026-03-01', statusText: 'טרם החל' });

const section = (over = {}) => ({
  title: 'להתחיל:',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: BTN_WORK.id,
  buttonIds: [BTN_WORK.id],
  button: BTN_WORK,
  buttons: [BTN_WORK],
  tasks: [task('9001', 'גיבוש תכנית')],
  ...over,
});

const noteSection = (over = {}) =>
  section({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע', ...over });

const render = (sections) =>
  renderDigestAmp({
    baseUrl: BASE,
    secret: SECRET,
    accountId: '777',
    recipient: { name: 'דנה', personId: '501', sections },
    sendHour: 8,
    now: new Date('2026-03-05T10:00:00+03:00'),
  });

/**
 * The `<style amp-custom>` contents. The offset matters: `<style
 * amp4email-boilerplate>` comes FIRST in the head, so slicing to the document's
 * first `</style>` reads an empty sheet and every assertion below passes or
 * fails for the wrong reason.
 */
const css = (html) => {
  const from = html.indexOf('<style amp-custom>');
  return html.slice(from, html.indexOf('</style>', from));
};

/** Every `@media (...) { … }` block body, brace-matched. */
function mediaBlocks(html) {
  const sheet = css(html);
  const out = [];
  let from = 0;
  for (;;) {
    const at = sheet.indexOf('@media', from);
    if (at === -1) return out;
    const open = sheet.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < sheet.length; i += 1) {
      if (sheet[i] === '{') depth += 1;
      else if (sheet[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(sheet.slice(at, i + 1));
    from = i + 1;
  }
}

/** Sum of the `width:NN%` declarations in one CSS chunk. */
const widthSum = (chunk) =>
  [...chunk.matchAll(/width:(\d+(?:\.\d+)?)%/g)].reduce((acc, hit) => acc + Number(hit[1]), 0);

describe('renderDigestAmp — the card layout is the base, the table is additive', () => {
  it('adds the wide layout in a min-width query and never uses max-width', () => {
    const html = render([section()]);
    const blocks = mediaBlocks(html);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toMatch(/@media \(min-width:\s*\d+px\)/);
      expect(block).not.toContain('max-width:');
    }
  });

  it('uses ONE breakpoint for every query, so the layouts cannot disagree', () => {
    const html = render([noteSection()]);
    const widths = mediaBlocks(html).map((b) => b.match(/min-width:\s*(\d+)px/)?.[1]);
    expect(widths.length).toBeGreaterThan(1); // the note variant adds its own
    expect(new Set(widths).size).toBe(1);
  });

  it('stacks the cells full-width OUTSIDE any query — the phone needs no query', () => {
    const html = render([noteSection()]);
    const outside = mediaBlocks(html).reduce((sheet, block) => sheet.replace(block, ''), css(html));
    for (const cell of ['.c-name', '.c-date', '.c-note', '.c-act']) {
      expect(outside).toContain(cell);
    }
    expect(outside).toMatch(/\.c-name[^{}]*\{[^}]*display:block/);
    expect(outside).toMatch(/\.c-name[^{}]*\{[^}]*width:100%/);
  });

  it('turns the cells into aligned columns only in the wide layout', () => {
    const wide = mediaBlocks(render([section()])).join('\n');
    expect(wide).toMatch(/\.c-name[^{}]*\{[^}]*display:inline-block/);
    expect(wide).toMatch(/\.c-act[^{}]*\{[^}]*display:inline-block/);
  });

  // Inline-blocks are separated by a whitespace gap (~0.25em each). Widths that
  // sum to exactly 100% overflow and drop the last column onto its own line.
  //
  // Asserted PER BLOCK, not over the joined sheet: the note variant emits its own
  // block that overrides the base widths, so a joined sum counts both partitions
  // and is meaningless (193%).
  it('leaves room for the inline-block gaps — column widths stay under 100%', () => {
    for (const html of [render([section()]), render([noteSection()])]) {
      const blocks = mediaBlocks(html);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(widthSum(block)).toBeLessThan(100);
        expect(widthSum(block)).toBeGreaterThan(90);
      }
    }
  });

  it('re-partitions the columns when a note column claims a fourth', () => {
    const wide = mediaBlocks(render([noteSection()])).join('\n');
    expect(wide).toMatch(/\.c-note[^{}]*\{[^}]*display:inline-block/);
    // The name column has to give room up: 4 columns in the same width. Read the
    // LAST declaration — the note block overrides the base one, and the last
    // wins at equal specificity, so that is the width the reader sees.
    const effective = (sheet) =>
      Number([...sheet.matchAll(/\.th-name, \.c-name \{ width:(\d+)%/g)].pop()?.[1]);
    const nameFour = effective(wide);
    const nameThree = effective(mediaBlocks(render([section()])).join('\n'));
    expect(nameFour).toBeLessThan(nameThree);
  });
});

describe('renderDigestAmp — the two layouts label the fields differently', () => {
  it('emits a column header strip per populated cluster, hidden until wide', () => {
    const html = render([noteSection()]);
    expect(html).toContain('class="thead"');
    expect(html).toContain('שם הפעולה');
    const outside = mediaBlocks(html).reduce((sheet, block) => sheet.replace(block, ''), css(html));
    expect(outside).toMatch(/\.thead \{[^}]*display:none/);
    expect(mediaBlocks(html).join('\n')).toMatch(/\.thead \{[^}]*display:block/);
  });

  it('heads the note and date columns with the mapped board titles', () => {
    const html = render([noteSection()]);
    const head = html.slice(html.indexOf('class="thead"'), html.indexOf('<form '));
    expect(head).toContain('תאריך התחלה');
    expect(head).toContain('סיכום ביצוע');
    expect(head).toContain('סטטוס');
  });

  it('shows the per-field captions on the phone and drops them when wide', () => {
    const html = render([noteSection()]);
    const outside = mediaBlocks(html).reduce((sheet, block) => sheet.replace(block, ''), css(html));
    expect(outside).toMatch(/\.row-cap \{[^}]*display:block/);
    expect(mediaBlocks(html).join('\n')).toMatch(/\.row-cap \{[^}]*display:none/);
  });

  it('renders the date as a chip carrying its own caption', () => {
    const html = render([section()]);
    expect(html).toMatch(/<span class="chip">[^<]*תאריך התחלה[^<]*01\/03\/2026/);
  });
});

describe('renderDigestAmp — the card look from the monday app', () => {
  it('stripes each card in its cluster’s primary color', () => {
    const html = render([section()]);
    expect(html).toContain('class="row ac_fdab3d"');
    expect(css(html)).toContain('.row.ac_fdab3d { border-right-color:#fdab3d; }');
  });

  it('takes the stripe from the cluster, not from the row’s current status', () => {
    // Both rows sit in a cluster whose primary button is green, so both stripe
    // green even though their current statuses differ — the stripe groups.
    const html = render([
      section({
        buttons: [BTN_DONE],
        buttonIds: [BTN_DONE.id],
        button: BTN_DONE,
        buttonId: BTN_DONE.id,
        tasks: [task('9001', 'א'), { ...task('9002', 'ב'), statusText: 'בעבודה' }],
      }),
    ]);
    expect((html.match(/class="row ac_00854d"/g) ?? []).length).toBe(2);
  });

  it('gives the card the rounded, bordered chrome of the mobile card', () => {
    const outside = mediaBlocks(render([section()])).reduce(
      (sheet, block) => sheet.replace(block, ''),
      css(render([section()]))
    );
    expect(outside).toMatch(/form\.row \{[^}]*border-radius:8px/);
    expect(outside).toMatch(/form\.row \{[^}]*border-right-width:4px/);
  });
});

// A layout bug must never be able to break the write path. Everything the
// reader taps has to survive both layouts.
describe('renderDigestAmp — the media query cannot disable the control', () => {
  it('hides nothing interactive inside a query', () => {
    const wide = mediaBlocks(render([noteSection()])).join('\n');
    for (const selector of ['.dd-trig', '.dd-menu', '.dd-opt', '.pick', 'form.row', '.note-in']) {
      const rules = [...wide.matchAll(new RegExp(`\\${selector}[^{}]*\\{([^}]*)\\}`, 'g'))];
      for (const rule of rules) expect(rule[1]).not.toContain('display:none');
    }
  });

  it('keeps the radio, the trigger and the state blocks out of the query entirely', () => {
    const wide = mediaBlocks(render([noteSection()])).join('\n');
    expect(wide).not.toContain('.pick');
    expect(wide).not.toContain('submit-success');
    expect(wide).not.toContain('[disabled]');
  });

  it('still renders one form per row in the responsive document', () => {
    const html = render([noteSection({ tasks: [task('9001', 'א'), task('9002', 'ב')] })]);
    expect((html.match(/<form /g) ?? []).length).toBe(2);
    expect((html.match(/<div submitting>/g) ?? []).length).toBe(2);
    expect(html).not.toContain('<table');
  });
});

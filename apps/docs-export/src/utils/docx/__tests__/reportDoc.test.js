/*
 * buildReportDocx turns the report model into the .docx BODY (the template splice
 * adds the header/footer later). These tests assert on the packed OOXML rather than
 * on docx objects, because the XML is what Word reads — and because the two things
 * that actually break in production are invisible at the object level: a vertical
 * merge that does not line up, and a row whose cell widths no longer add up to the
 * grid (which is what collapses the columns and stacks Hebrew one glyph per line).
 */
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { HEADER_FILL } from '../rtl.js';
import { COLUMN_WIDTHS_DXA, DEFAULT_HEADERS, buildReportDocx } from '../reportDoc.js';

const TOTAL_DXA = COLUMN_WIDTHS_DXA.reduce((sum, w) => sum + w, 0);

/** Unzip the produced .docx and hand back word/document.xml. */
async function docXml(model) {
  const bytes = await buildReportDocx(model);
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

const rowsOf = (xml) => xml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
const widthsOf = (row) => [...row.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
const cellCountOf = (row) => (row.match(/<w:tc>/g) || []).length;
const textsOf = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
const tableOf = (xml) => (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/) || [''])[0];
/** Body flow with the table removed — the paragraph stream around it. */
const outsideTable = (xml) => xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '@@TABLE@@');

const cell = (text, rowSpan) => (rowSpan ? { text, rowSpan } : { text });

/** A four-row model: one action group of 3 merged rows, then a lone row. */
function mergedModel() {
  return {
    title: '',
    blocks: [{ type: 'table' }],
    table: {
      headers: ['פעולה', 'ועדה', 'דיווח', 'תאריך'],
      rows: [
        { cells: [cell('ביקור', 3), cell('צפון', 2), cell('דיווח 1'), cell('2026-07-01')] },
        { cells: [null, null, cell('דיווח 2'), cell('2026-07-02')] },
        { cells: [null, cell('דרום'), cell('דיווח 3'), cell('2026-07-03')] },
        { cells: [cell('מפגש'), cell('מרכז'), cell('דיווח 4'), cell('2026-07-04')] },
      ],
    },
  };
}

describe('COLUMN_WIDTHS_DXA / DEFAULT_HEADERS', () => {
  it('describes exactly the four table columns', () => {
    expect(COLUMN_WIDTHS_DXA).toHaveLength(4);
    expect(DEFAULT_HEADERS).toHaveLength(4);
  });

  it('pins the width of each column by GRID INDEX: action, committee, report, date', () => {
    // Pinned as literals on purpose. Every other width assertion in this file
    // derives its expected value from COLUMN_WIDTHS_DXA, which makes all of them
    // blind to a PERMUTATION of the array (a mutation that swapped the action and
    // committee widths survived the whole suite until this assertion existed).
    // Index 0 is `action` — the RIGHTMOST column, since the table is bidiVisual —
    // and it holds a short label, so it must not be wider than the committee-name
    // column next to it.
    expect(COLUMN_WIDTHS_DXA).toEqual([1440, 1900, 3860, 1440]);
    expect(TOTAL_DXA).toBe(8640);
  });

  it('gives every column a positive DXA width', () => {
    // A zero width is the failure mode the whole DXA recipe exists to prevent.
    expect(COLUMN_WIDTHS_DXA.every((w) => Number.isInteger(w) && w > 0)).toBe(true);
  });

  it('fits inside the usable width of A4 and Letter at 1in margins', () => {
    // The template is owner-uploaded, so the page setup is unknown at build time.
    // A FIXED-layout table wider than the text column runs off the page.
    // A4 11906 - 2880 = 9026; Letter 12240 - 2880 = 9360.
    expect(TOTAL_DXA).toBeLessThanOrEqual(9026);
  });

  it('gives the report column the most room, since it holds the free text', () => {
    const [action, committee, report, date] = COLUMN_WIDTHS_DXA;
    expect(report).toBeGreaterThan(action);
    expect(report).toBeGreaterThan(committee);
    expect(report).toBeGreaterThan(date);
  });

  it('names the four roles in grid order — action first, because RTL puts it rightmost', () => {
    expect(DEFAULT_HEADERS).toEqual(['פעולה', 'שם הועדה האזורית', 'דיווח', 'תאריך דיווח']);
  });
});

describe('buildReportDocx — output shape', () => {
  it('returns a Uint8Array that unzips as a WordprocessingML package', async () => {
    const bytes = await buildReportDocx(mergedModel());
    expect(bytes).toBeInstanceOf(Uint8Array);
    const parts = unzipSync(bytes);
    expect(Object.keys(parts)).toContain('word/document.xml');
    expect(Object.keys(parts)).toContain('word/styles.xml');
  });

  it('carries section-level w:bidi, for viewers that ignore paragraph-level bidi', async () => {
    const xml = await docXml(mergedModel());
    const sect = (xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
    expect(sect).toContain('<w:bidi/>');
  });

  it('applies the RTL document defaults', async () => {
    const bytes = await buildReportDocx(mergedModel());
    const styles = strFromU8(unzipSync(bytes)['word/styles.xml']);
    const defaults = (styles.match(/<w:docDefaults[\s\S]*?<\/w:docDefaults>/) || [''])[0];
    expect(defaults).toContain('<w:rtl/>');
  });
});

describe('buildReportDocx — blocks render in the author order', () => {
  const model = (blocks, table) => ({
    title: '',
    blocks,
    table: table || { headers: DEFAULT_HEADERS, rows: [{ cells: [cell('א'), cell('ב'), cell('ג'), cell('ד')] }] },
  });

  it('puts the table exactly where the table block sits between the text blocks', async () => {
    const xml = await docXml(model([
      { type: 'text', text: 'פתיח' },
      { type: 'table' },
      { type: 'text', text: 'סיום' },
    ]));
    const flow = outsideTable(xml);
    expect(flow.indexOf('פתיח')).toBeLessThan(flow.indexOf('@@TABLE@@'));
    expect(flow.indexOf('@@TABLE@@')).toBeLessThan(flow.indexOf('סיום'));
  });

  it('keeps two text blocks in order when the table comes last', async () => {
    const xml = await docXml(model([
      { type: 'text', text: 'ראשון' },
      { type: 'text', text: 'שני' },
      { type: 'table' },
    ]));
    const flow = outsideTable(xml);
    expect(flow.indexOf('ראשון')).toBeLessThan(flow.indexOf('שני'));
    expect(flow.indexOf('שני')).toBeLessThan(flow.indexOf('@@TABLE@@'));
  });

  it('turns each line of a text block into its own paragraph, preserving blank lines', async () => {
    const xml = await docXml(model([{ type: 'text', text: 'שורה א\n\nשורה ב' }, { type: 'table' }]));
    // The three paragraphs of the block, in order, blank one included.
    expect(textsOf(outsideTable(xml))).toEqual(['שורה א', '', 'שורה ב']);
  });

  it('renders a text block with no text as a single empty paragraph rather than "undefined"', async () => {
    const xml = await docXml(model([{ type: 'text' }, { type: 'table' }]));
    expect(textsOf(outsideTable(xml))).toEqual(['']);
  });

  it('emits no table at all when the blocks carry no table block', async () => {
    const xml = await docXml(model([{ type: 'text', text: 'טקסט בלבד' }]));
    expect(xml).not.toContain('<w:tbl>');
    expect(textsOf(xml)).toEqual(['טקסט בלבד']);
  });

  it('ignores a block of an unknown type instead of throwing', async () => {
    const xml = await docXml(model([
      { type: 'text', text: 'לפני' },
      { type: 'image', src: 'x' },
      { type: 'text', text: 'אחרי' },
    ]));
    expect(textsOf(xml)).toEqual(['לפני', 'אחרי']);
  });

  it('produces a document with no table and no text when blocks is missing entirely', async () => {
    const xml = await docXml({ title: '', table: { headers: DEFAULT_HEADERS, rows: [] } });
    expect(xml).not.toContain('<w:tbl>');
    expect(textsOf(xml)).toEqual([]);
  });

  it('renders only one table even if a second table block slips through', async () => {
    // The settings schema allows exactly one, but a corrupt saved blob must not
    // duplicate the whole report.
    const xml = await docXml(model([{ type: 'table' }, { type: 'table' }]));
    expect((xml.match(/<w:tbl>/g) || []).length).toBe(1);
  });
});

describe('buildReportDocx — the title', () => {
  const withTitle = (title) => ({
    title,
    blocks: [{ type: 'text', text: 'גוף' }, { type: 'table' }],
    table: { headers: DEFAULT_HEADERS, rows: [] },
  });

  it('renders a non-empty title as the first paragraph, styled as Heading1', async () => {
    const xml = await docXml(withTitle('דוח יומי — 01/07/2026'));
    expect(textsOf(xml)[0]).toBe('דוח יומי — 01/07/2026');
    const firstParagraph = (xml.match(/<w:p>[\s\S]*?<\/w:p>/) || [''])[0];
    expect(firstParagraph).toContain('<w:pStyle w:val="Heading1"/>');
  });

  it('omits the title paragraph entirely when the title is empty', async () => {
    const xml = await docXml(withTitle(''));
    expect(xml).not.toContain('<w:pStyle w:val="Heading1"/>');
    expect(textsOf(outsideTable(xml))).toEqual(['גוף']);
  });

  it('omits the title paragraph when the title is missing', async () => {
    const xml = await docXml({
      blocks: [{ type: 'text', text: 'גוף' }],
      table: { headers: DEFAULT_HEADERS, rows: [] },
    });
    expect(xml).not.toContain('<w:pStyle w:val="Heading1"/>');
  });
});

describe('buildReportDocx — the table header row', () => {
  const headerModel = (headers) => ({
    title: '',
    blocks: [{ type: 'table' }],
    table: { headers, rows: [{ cells: [cell('א'), cell('ב'), cell('ג'), cell('ד')] }] },
  });

  it('renders the four headers in grid order', async () => {
    const xml = await docXml(headerModel(['פ', 'ו', 'ד', 'ת']));
    const [header] = rowsOf(tableOf(xml));
    expect(textsOf(header)).toEqual(['פ', 'ו', 'ד', 'ת']);
  });

  it('shades, bolds and repeats the header row across page breaks', async () => {
    const xml = await docXml(headerModel(['פ', 'ו', 'ד', 'ת']));
    const [header, body] = rowsOf(tableOf(xml));
    expect(header).toContain('<w:tblHeader/>');
    expect(header).toContain(`<w:shd w:fill="${HEADER_FILL}" w:color="auto" w:val="clear"/>`);
    expect(header).toContain('<w:b/>');
    // and the styling must not leak into the data rows
    expect(body).not.toContain('<w:tblHeader/>');
    expect(body).not.toContain('<w:shd');
  });

  it('falls back to the default header for a column left blank in settings', async () => {
    // settings.headers.<role> === '' means "use the board column title"; that
    // resolution happens upstream, so an empty string arriving here is a gap and
    // must not render as a blank column heading.
    const xml = await docXml(headerModel(['', 'ועדה', '', 'תאריך']));
    const [header] = rowsOf(tableOf(xml));
    expect(textsOf(header)).toEqual([DEFAULT_HEADERS[0], 'ועדה', DEFAULT_HEADERS[2], 'תאריך']);
  });

  it('falls back to the default header for a whitespace-only override', async () => {
    // An owner who types a space into a header override must not get a heading cell
    // that renders blank. reportModel trims upstream, but buildReportDocx is an
    // exported entry point and owns its own contract.
    const xml = await docXml(headerModel([' ', '\t', 'דיווח', '\n ']));
    const [header] = rowsOf(tableOf(xml));
    expect(textsOf(header)).toEqual([
      DEFAULT_HEADERS[0], DEFAULT_HEADERS[1], 'דיווח', DEFAULT_HEADERS[3],
    ]);
  });

  it('falls back to every default header when headers is missing', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'table' }],
      table: { rows: [{ cells: [cell('א'), cell('ב'), cell('ג'), cell('ד')] }] },
    });
    const [header] = rowsOf(tableOf(xml));
    expect(textsOf(header)).toEqual(DEFAULT_HEADERS);
  });

  it('renders the header row alone when the range produced no items', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'table' }],
      table: { headers: DEFAULT_HEADERS, rows: [] },
    });
    const rows = rowsOf(tableOf(xml));
    expect(rows).toHaveLength(1);
    expect(textsOf(rows[0])).toEqual(DEFAULT_HEADERS);
  });
});

describe('buildReportDocx — the table grid and widths', () => {
  it('declares one gridCol per configured column width, in order', async () => {
    const xml = await docXml(mergedModel());
    const grid = COLUMN_WIDTHS_DXA.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
    expect(tableOf(xml)).toContain(`<w:tblGrid>${grid}</w:tblGrid>`);
  });

  it('uses a FIXED layout with the summed DXA table width', async () => {
    const table = tableOf(await docXml(mergedModel()));
    expect(table).toContain('<w:tblLayout w:type="fixed"/>');
    expect(table).toContain(`<w:tblW w:type="dxa" w:w="${TOTAL_DXA}"/>`);
  });

  it('marks the table visually RTL so the action column renders rightmost', async () => {
    expect(tableOf(await docXml(mergedModel()))).toContain('<w:bidiVisual/>');
  });

  it('gives every row a full four-column grid, merged cells included', async () => {
    const rows = rowsOf(tableOf(await docXml(mergedModel())));
    expect(rows).toHaveLength(5); // header + 4 data rows
    for (const row of rows) expect(cellCountOf(row)).toBe(4);
  });

  it('keeps each row accounted for across the full grid width, merges included', async () => {
    // This is the assertion that catches a broken merge: docx omits w:tcW on a
    // vMerge CONTINUE cell, so a row's explicit widths only sum to the total once
    // the merged-away columns are added back. If a width were taken from the
    // cell's position in the shortened array instead of its grid index, this fails.
    const model = mergedModel();
    const xml = await docXml(model);
    const rows = rowsOf(tableOf(xml));

    // header row: all four columns are explicit
    expect(widthsOf(rows[0])).toEqual(COLUMN_WIDTHS_DXA);

    model.table.rows.forEach((modelRow, i) => {
      const nullIndexes = modelRow.cells.map((c, idx) => (c == null ? idx : -1)).filter((idx) => idx >= 0);
      const carried = COLUMN_WIDTHS_DXA.filter((_, idx) => !nullIndexes.includes(idx));
      const mergedAway = nullIndexes.reduce((sum, idx) => sum + COLUMN_WIDTHS_DXA[idx], 0);
      const explicit = widthsOf(rows[i + 1]);
      expect(explicit).toEqual(carried);
      expect(explicit.reduce((a, b) => a + b, 0) + mergedAway).toBe(TOTAL_DXA);
    });
  });

  it('keeps rows unsplittable so a row never straddles a page break', async () => {
    const rows = rowsOf(tableOf(await docXml(mergedModel())));
    expect(rows.every((r) => r.includes('<w:cantSplit/>'))).toBe(true);
  });
});

describe('buildReportDocx — vertical merges', () => {
  it('starts a merge on the spanning cell and continues it on the following rows', async () => {
    const table = tableOf(await docXml(mergedModel()));
    const rows = rowsOf(table);
    const [, r1, r2, r3, r4] = rows;

    // action spans rows 1..3, committee spans rows 1..2 inside that action group
    expect((r1.match(/<w:vMerge w:val="restart"\/>/g) || []).length).toBe(2);
    expect((r2.match(/<w:vMerge w:val="continue"\/>/g) || []).length).toBe(2);
    // row 3 continues the ACTION merge only — the committee changed
    expect((r3.match(/<w:vMerge w:val="continue"\/>/g) || []).length).toBe(1);
    expect((r3.match(/<w:vMerge w:val="restart"\/>/g) || []).length).toBe(0);
    // the second action group starts fresh, with no merge at all
    expect(r4).not.toContain('<w:vMerge');
  });

  it('writes the merged text once, in the row that starts the span', async () => {
    const rows = rowsOf(tableOf(await docXml(mergedModel())));
    expect(textsOf(rows[1])).toEqual(['ביקור', 'צפון', 'דיווח 1', '2026-07-01']);
    // the continuation cells carry no text of their own
    expect(textsOf(rows[2])).toEqual(['דיווח 2', '2026-07-02']);
    expect(textsOf(rows[3])).toEqual(['דרום', 'דיווח 3', '2026-07-03']);
    expect(textsOf(rows[4])).toEqual(['מפגש', 'מרכז', 'דיווח 4', '2026-07-04']);
  });

  it('emits no vMerge for a rowSpan of 1, which is not a merge', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'table' }],
      table: {
        headers: DEFAULT_HEADERS,
        rows: [{ cells: [cell('א', 1), cell('ב'), cell('ג'), cell('ד')] }],
      },
    });
    expect(xml).not.toContain('<w:vMerge');
  });

  it('renders an empty cell text as an empty cell, never the string "undefined"', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'table' }],
      table: {
        headers: DEFAULT_HEADERS,
        rows: [{ cells: [{ text: '' }, { text: undefined }, { text: 'ג' }, { text: null }] }],
      },
    });
    const [, row] = rowsOf(tableOf(xml));
    expect(textsOf(row)).toEqual(['', '', 'ג', '']);
  });
});

describe('buildReportDocx — RTL is applied to the report content', () => {
  it('marks the body paragraphs bidirectional', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'text', text: 'טקסט' }],
      table: { headers: DEFAULT_HEADERS, rows: [] },
    });
    expect(xml).toContain('<w:bidi/>');
  });

  it('marks the table cell runs rightToLeft', async () => {
    const table = tableOf(await docXml(mergedModel()));
    expect(table).toContain('<w:rtl/>');
  });

  it('leaves no w:jc on a body text paragraph, so it sits on the RTL leading edge', async () => {
    const xml = await docXml({
      title: '',
      blocks: [{ type: 'text', text: 'טקסט' }],
      table: { headers: DEFAULT_HEADERS, rows: [] },
    });
    const paragraph = (xml.match(/<w:p>[\s\S]*?<\/w:p>/) || [''])[0];
    expect(paragraph).not.toContain('<w:jc');
  });
});

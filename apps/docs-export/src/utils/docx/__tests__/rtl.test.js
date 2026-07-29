/*
 * The RTL recipe is the single most fragile part of the export: every rule it
 * encodes was learned from a broken document (Hebrew stacking one glyph per
 * line, columns collapsing to zero width, text flipping to the left edge). These
 * tests therefore assert on the packed OOXML, not on the JS objects — the XML is
 * what Word reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as docx from 'docx';
import { Packer } from 'docx';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import logger from '../../logger.js';
import {
  DOCX_MIME,
  DEFAULT_FONT,
  HEADER_FILL,
  createRtl,
  rtlStyles,
  rtlTableFromCells,
  injectSectionRtl,
} from '../rtl.js';

// Pack a document made of `children` and hand back its parts as strings.
async function packed(children) {
  const doc = new docx.Document({ styles: rtlStyles(docx), sections: [{ children }] });
  const bytes = new Uint8Array(await Packer.toArrayBuffer(doc));
  const files = unzipSync(bytes);
  return {
    bytes,
    body: strFromU8(files['word/document.xml']),
    styles: strFromU8(files['word/styles.xml']),
  };
}

const rowsOf = (xml) => xml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
const widthsOf = (row) => [...row.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
const cellCountOf = (row) => (row.match(/<w:tc>/g) || []).length;
// Only the text element itself: `<w:t[^>]*>` would also match <w:tc> and <w:trPr>.
const textsOf = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
const styleBlock = (styles, id) =>
  (styles.match(new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`)) || [''])[0];

const W = [1000, 2000, 3000, 4000]; // deliberately distinct so a grid-index bug shows
const TOTAL = 10000;

describe('constants', () => {
  it('exposes the WordprocessingML document mime type used for the download Blob', () => {
    expect(DOCX_MIME).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('names a font that carries a Hebrew complex-script face', () => {
    expect(DEFAULT_FONT).toBe('Arial');
  });

  it('exposes the header fill as a bare 6-digit hex (OOXML w:fill takes no #)', () => {
    expect(HEADER_FILL).toMatch(/^[0-9A-F]{6}$/);
  });
});

describe('createRtl — paragraphs and runs', () => {
  it('marks every body paragraph bidirectional', async () => {
    const { para } = createRtl(docx);
    const { body } = await packed([para('שלום')]);
    expect(body).toContain('<w:pPr><w:bidi/></w:pPr>');
  });

  it('emits NO w:jc on a body paragraph, so the text sits on the RTL leading edge', async () => {
    // ECMA-376 Transitional treats w:jc "left"/"right" as aliases of the LOGICAL
    // start/end, so <w:jc w:val="right"/> inside a bidi paragraph is read as END and
    // flips Hebrew to the LEFT margin. A bidi paragraph with no w:jc defaults to
    // start = the right edge, which is what we want. Do not "fix" this by adding
    // AlignmentType.RIGHT.
    const { para } = createRtl(docx);
    const { body } = await packed([para('שלום')]);
    const firstParagraph = body.slice(body.indexOf('<w:body>'), body.indexOf('</w:p>'));
    expect(firstParagraph).not.toContain('<w:jc');
  });

  it('marks every run rightToLeft so Hebrew glyphs order correctly', async () => {
    const { para } = createRtl(docx);
    const { body } = await packed([para('שלום')]);
    expect(body).toContain('<w:rtl/>');
    expect(textsOf(body)).toEqual(['שלום']);
  });

  it('pins the font on the run itself, including the complex-script (w:cs) slot', async () => {
    // Table cells and headings do not reliably inherit the docDefaults font; the
    // cs slot is the one Hebrew actually uses.
    const { para } = createRtl(docx);
    const { body } = await packed([para('שלום')]);
    expect(body).toContain('<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>');
  });

  it('renders a null/undefined text as an empty run rather than the string "null"', async () => {
    const { para } = createRtl(docx);
    const { body } = await packed([para(null), para(undefined)]);
    expect(textsOf(body)).toEqual(['', '']);
  });

  it('centers a heading paragraph (center is direction-neutral) and keeps it bidirectional', async () => {
    const { heading } = createRtl(docx);
    const { body } = await packed([heading('כותרת', docx.HeadingLevel.HEADING_1)]);
    expect(body).toContain('<w:pStyle w:val="Heading1"/><w:bidi/><w:jc w:val="center"/>');
  });

  it('turns each newline of a text block into its own paragraph', async () => {
    const { textToParagraphs } = createRtl(docx);
    const { body } = await packed(textToParagraphs('שורה א\nשורה ב'));
    expect((body.match(/<w:p>/g) || []).length).toBe(2);
    expect(textsOf(body)).toEqual(['שורה א', 'שורה ב']);
  });

  it('keeps a blank line as an empty paragraph so the author spacing survives', async () => {
    const { textToParagraphs } = createRtl(docx);
    const { body } = await packed(textToParagraphs('א\n\nב'));
    expect((body.match(/<w:p>/g) || []).length).toBe(3);
    expect(textsOf(body)).toEqual(['א', '', 'ב']);
  });

  it('splits CRLF line endings too (a .docx-authored block pasted into settings)', async () => {
    const { textToParagraphs } = createRtl(docx);
    const { body } = await packed(textToParagraphs('א\r\nב'));
    expect(textsOf(body)).toEqual(['א', 'ב']);
  });
});

describe('rtlStyles — document defaults', () => {
  it('sets rightToLeft on the document default run', async () => {
    const { styles } = await packed([]);
    const defaults = (styles.match(/<w:docDefaults[\s\S]*?<\/w:docDefaults>/) || [''])[0];
    expect(defaults).toContain('<w:rtl/>');
  });

  it('declares Hebrew as the complex-script proofing language (no red squiggles)', async () => {
    const { styles } = await packed([]);
    expect(styles).toContain('w:bidi="he-IL"');
  });

  it('repeats rightToLeft on heading1..3, which otherwise override the default', async () => {
    const { styles } = await packed([]);
    for (const id of ['Heading1', 'Heading2', 'Heading3']) {
      expect(styleBlock(styles, id)).toContain('<w:rtl/>');
    }
  });
});

describe('rtlTableFromCells — the table recipe', () => {
  const build = (rows) => rtlTableFromCells(docx, { columnWidths: W, rows });
  const simpleRows = [
    { header: true, cells: [{ text: 'כ1' }, { text: 'כ2' }, { text: 'כ3' }, { text: 'כ4' }] },
    { cells: [{ text: 'א' }, { text: 'ב' }, { text: 'ג' }, { text: 'ד' }] },
  ];

  it('uses a FIXED layout with an explicit DXA table width (auto layout collapses RTL columns)', async () => {
    const { body } = await packed([build(simpleRows)]);
    expect(body).toContain('<w:tblLayout w:type="fixed"/>');
    expect(body).toContain(`<w:tblW w:type="dxa" w:w="${TOTAL}"/>`);
  });

  it('marks the table visually right-to-left so cell 0 renders as the RIGHTMOST column', async () => {
    const { body } = await packed([build(simpleRows)]);
    expect(body).toContain('<w:bidiVisual/>');
  });

  it('emits one gridCol per column width, in logical order', async () => {
    const { body } = await packed([build(simpleRows)]);
    expect(body).toContain('<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:gridCol w:w="4000"/></w:tblGrid>');
  });

  it('gives every cell its own DXA width matching its grid column', async () => {
    const { body } = await packed([build(simpleRows)]);
    const rows = rowsOf(body);
    expect(rows).toHaveLength(2);
    expect(widthsOf(rows[0])).toEqual(W);
    expect(widthsOf(rows[1])).toEqual(W);
    expect(widthsOf(rows[1]).reduce((a, b) => a + b, 0)).toBe(TOTAL);
  });

  it('shades the header row, bolds it, centers it and repeats it across pages', async () => {
    const { body } = await packed([build(simpleRows)]);
    const [header, data] = rowsOf(body);
    expect(header).toContain('<w:tblHeader/>');
    expect(header).toContain(`<w:shd w:fill="${HEADER_FILL}" w:color="auto" w:val="clear"/>`);
    expect(header).toContain('<w:b/>');
    expect(header).toContain('<w:jc w:val="center"/>');
    // body cells are NOT shaded and NOT bold — the header styling must not leak
    expect(data).not.toContain('<w:shd');
    expect(data).not.toContain('<w:b/>');
  });

  it('keeps rows unsplittable across a page break', async () => {
    const { body } = await packed([build(simpleRows)]);
    expect(rowsOf(body).every((r) => r.includes('<w:cantSplit/>'))).toBe(true);
  });

  it('centers a cell asked to be centered and leaves the rest on the RTL leading edge', async () => {
    const rows = [{ cells: [{ text: 'א', center: true }, { text: 'ב' }, { text: 'ג' }, { text: 'ד' }] }];
    const { body } = await packed([build(rows)]);
    const cells = rowsOf(body)[0].match(/<w:tc>[\s\S]*?<\/w:tc>/g);
    expect(cells[0]).toContain('<w:jc w:val="center"/>');
    expect(cells[1]).not.toContain('<w:jc');
  });

  it('turns rowSpan into a vMerge restart and continuation rows that Word can merge', async () => {
    const rows = [
      { cells: [{ text: 'פעולה', rowSpan: 3 }, { text: 'ו1' }, { text: 'ר1' }, { text: 'ת1' }] },
      { cells: [null, { text: 'ו2' }, { text: 'ר2' }, { text: 'ת2' }] },
      { cells: [null, { text: 'ו3' }, { text: 'ר3' }, { text: 'ת3' }] },
    ];
    const { body } = await packed([build(rows)]);
    const trs = rowsOf(body);
    expect(trs).toHaveLength(3);
    expect(trs[0]).toContain('<w:vMerge w:val="restart"/>');
    expect(trs[1]).toContain('<w:vMerge w:val="continue"/>');
    expect(trs[2]).toContain('<w:vMerge w:val="continue"/>');
    // exactly one merge origin — a second restart would break the span in two
    expect((body.match(/<w:vMerge w:val="restart"\/>/g) || []).length).toBe(1);
  });

  it('omits a null cell so the continuation cell docx inserts lands on the right column', async () => {
    const rows = [
      { cells: [{ text: 'פעולה', rowSpan: 2 }, { text: 'ו1' }, { text: 'ר1' }, { text: 'ת1' }] },
      { cells: [null, { text: 'ו2' }, { text: 'ר2' }, { text: 'ת2' }] },
    ];
    const { body } = await packed([build(rows)]);
    const trs = rowsOf(body);
    // Every row still spans all four grid columns...
    expect(cellCountOf(trs[0])).toBe(4);
    expect(cellCountOf(trs[1])).toBe(4);
    // ...and the surviving cells keep the width of THEIR grid column, not of the
    // position they happen to occupy in the shortened array.
    expect(widthsOf(trs[0])).toEqual([1000, 2000, 3000, 4000]);
    expect(widthsOf(trs[1])).toEqual([2000, 3000, 4000]);
    expect(textsOf(trs[1])).toEqual(['ו2', 'ר2', 'ת2']);
  });

  it('does not emit vMerge for rowSpan 1 (a lone row is not a merge)', async () => {
    const rows = [{ cells: [{ text: 'א', rowSpan: 1 }, { text: 'ב' }, { text: 'ג' }, { text: 'ד' }] }];
    const { body } = await packed([build(rows)]);
    expect(body).not.toContain('<w:vMerge');
    expect(widthsOf(rowsOf(body)[0])).toEqual(W);
  });
});

describe('injectSectionRtl', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('adds section-level w:bidi so viewers that ignore paragraph bidi still render RTL', async () => {
    const { bytes } = await packed([createRtl(docx).para('שלום')]);
    const before = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(before).not.toContain('<w:bidi/><w:docGrid');

    const after = strFromU8(unzipSync(await injectSectionRtl(bytes))['word/document.xml']);
    expect(after).toContain('<w:bidi/><w:docGrid');
  });

  it('is idempotent — a second pass leaves exactly one w:bidi in the sectPr', async () => {
    const { bytes } = await packed([createRtl(docx).para('שלום')]);
    const once = await injectSectionRtl(bytes);
    const twice = await injectSectionRtl(once);
    const xml = strFromU8(unzipSync(twice)['word/document.xml']);
    const sect = (xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
    expect((sect.match(/<w:bidi\/>/g) || []).length).toBe(1);
  });

  it('leaves a sectPr that already declares w:bidi before w:rtlGutter untouched', async () => {
    // A Word-authored RTL template puts <w:bidi/> before <w:rtlGutter/>, which comes
    // before <w:docGrid> — a "is it already there" check anchored on docGrid misses
    // it and produces a SECOND w:bidi, which is invalid (CT_SectPr allows one).
    const xml =
      '<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr><w:bidi/><w:rtlGutter/>' +
      '<w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const out = strFromU8(unzipSync(await injectSectionRtl(zip))['word/document.xml']);
    expect((out.match(/<w:bidi\/>/g) || []).length).toBe(1);
  });

  it('flips a sectPr that explicitly declares LTR (w:bidi w:val="0") to RTL', async () => {
    // `w:bidi` is a CT_OnOff: a bare <w:bidi/> is ON, but an explicit w:val="0"
    // means the section is LEFT-to-right. Counting that as "already declared" and
    // skipping it left the spliced report rendering LTR in exactly the viewers
    // injectSectionRtl exists for (macOS Quick Look, Pages) — the mitigation
    // silently did not apply. Replace, never add: CT_SectPr allows one w:bidi.
    const xml =
      '<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr><w:bidi w:val="0"/>' +
      '<w:pgSz w:w="11906"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const out = strFromU8(unzipSync(await injectSectionRtl(zip))['word/document.xml']);
    expect(out).not.toContain('w:val="0"');
    expect((out.match(/<w:bidi/g) || []).length).toBe(1);
    expect(out).toContain('<w:bidi/>');
  });

  it.each(['false', 'off'])('treats w:val="%s" as LTR and flips it too', async (val) => {
    const xml =
      `<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr><w:bidi w:val="${val}"/>` +
      '<w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const out = strFromU8(unzipSync(await injectSectionRtl(zip))['word/document.xml']);
    expect(out).toContain('<w:bidi/>');
    expect((out.match(/<w:bidi/g) || []).length).toBe(1);
  });

  it.each(['1', 'true', 'on'])('leaves an explicitly-ON w:val="%s" alone', async (val) => {
    const xml =
      `<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr><w:bidi w:val="${val}"/>` +
      '<w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const out = strFromU8(unzipSync(await injectSectionRtl(zip))['word/document.xml']);
    expect(out).toContain(`<w:bidi w:val="${val}"/>`);
    expect((out.match(/<w:bidi/g) || []).length).toBe(1);
  });

  it('returns the very same byte array when every sectPr already declares RTL', async () => {
    // The no-op short-circuit is contract, not just an optimisation: download.js
    // documents that a clean re-injection "returns the input bytes unchanged", and
    // re-zipping would hand the caller a different object for no reason.
    const xml =
      '<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr><w:bidi/>' +
      '<w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    expect(await injectSectionRtl(zip)).toBe(zip);
  });

  it('injects into a sectPr that has no docGrid at all', async () => {
    const xml =
      '<?xml version="1.0"?><w:document><w:body><w:p/><w:sectPr>' +
      '<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const out = strFromU8(unzipSync(await injectSectionRtl(zip))['word/document.xml']);
    expect(out).toContain('<w:bidi/></w:sectPr>');
  });

  it('returns the original bytes and logs a warning when the input is not a zip', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(await injectSectionRtl(garbage)).toBe(garbage);
    expect(warn).toHaveBeenCalled();
  });

  it('returns the original bytes when the zip carries no word/document.xml', async () => {
    const zip = zipSync({ 'word/styles.xml': strToU8('<w:styles/>') });
    expect(await injectSectionRtl(zip)).toBe(zip);
  });
});

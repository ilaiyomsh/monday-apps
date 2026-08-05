/*
 * The RTL recipe — every .docx this app produces goes through these primitives.
 *
 * Extracted from `apps/discussions/src/utils/docxExport.js` (a 1066-line exporter;
 * only its RTL/table recipe lives here). Every rule below is load-bearing and was
 * learned from a broken document, so treat them as facts, not preferences:
 *
 *   1. The document defaults set `run.rightToLeft`, and heading1..3 REPEAT it —
 *      heading styles do not inherit the docDefaults run properties, so a heading
 *      silently reverts to LTR + the theme font without the repetition.
 *   2. Every Paragraph sets `bidirectional: true` (→ `<w:bidi/>`) and NO `w:jc`.
 *      ECMA-376 Transitional defines `w:jc` "left"/"right" as aliases of the
 *      LOGICAL start/end, so `<w:jc w:val="right"/>` inside a bidi paragraph is
 *      read as END and flips Hebrew to the LEFT margin (observed in Word and
 *      Google Docs — it is why the discussions exporter carries
 *      `const RTL = { bidirectional: true }` with an explicit "no explicit w:jc"
 *      comment). A bidi paragraph with no `w:jc` defaults to start = the right
 *      edge, which is what we want. `AlignmentType.START`/`END` are the same trap
 *      from the other side. Only `CENTER` is direction-neutral and therefore safe
 *      to set explicitly — that is why the title and the table header row are the
 *      only places that carry a `w:jc`.
 *      NOTE: `apps/docs-export/CLAUDE.md` and that file's own header comment both
 *      claim "every paragraph sets an ABSOLUTE AlignmentType.RIGHT" — that
 *      describes an EARLIER revision, contradicts the code that actually ships,
 *      and would left-align the report. A test pins the absence of `w:jc`.
 *   3. Every TextRun sets `rightToLeft: true` (→ `<w:rtl/>`) and pins the font on
 *      the run itself, including the complex-script (`w:cs`) slot Hebrew uses —
 *      table cells and headings do not reliably inherit the document font.
 *   4. Tables need explicit DXA `columnWidths` + FIXED layout + a per-cell DXA
 *      width + `visuallyRightToLeft`. Without them the columns collapse to zero
 *      width and Hebrew stacks one glyph per line.
 *   5. Some viewers (macOS Quick Look / Pages) ignore paragraph-level bidi, so
 *      `injectSectionRtl` adds SECTION-level `<w:bidi/>` after packing (docx 9.7.1
 *      cannot express it).
 *
 * `docx` is never imported here: the caller passes the module namespace in, so
 * this module stays free of the heavy dependency and off the boot path.
 */
import logger from '../logger.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Body font. Arial ships a Hebrew complex-script face on Windows, macOS and Word
 * Online, so the report renders the same everywhere; the uploaded template only
 * supplies the header/footer, never the body typography.
 */
export const DEFAULT_FONT = 'Arial';

/** Table header row fill — a bare 6-digit hex (OOXML `w:fill` takes no `#`). */
export const HEADER_FILL = '4F6B8F';

/** Spread onto EVERY paragraph. See rule 2 — deliberately carries no alignment. */
export const RTL = { bidirectional: true };

// Cell padding / border, kept identical to the discussions export so both apps'
// documents look like the same product.
const CELL_MARGIN_DXA = { top: 90, bottom: 90, left: 130, right: 130 };
const BORDER_COLOR = 'D9D9D9';

/**
 * Document-level styles: RTL + font defaults, repeated on heading1..3 (rule 1).
 * Sizes are half-points: body 12pt, heading1 18pt, heading2 14pt, heading3 12pt.
 *
 * @param {object} docx - the `docx` module namespace
 * @param {{ font?: string }} [options]
 * @returns {object} the `styles` option for `new Document({ styles })`
 */
export function rtlStyles(docx, { font = DEFAULT_FONT } = {}) {
  return {
    default: {
      // `language.bidirectional: 'he-IL'` is the complex-script proofing language:
      // without it Word flags every Hebrew word as a spelling error.
      document: {
        run: { rightToLeft: true, font, size: 24, language: { value: 'en-US', bidirectional: 'he-IL' } },
      },
      heading1: {
        run: { rightToLeft: true, font, bold: true, size: 36, color: '1F3864' },
        paragraph: { spacing: { before: 240, after: 160 } },
      },
      heading2: {
        run: { rightToLeft: true, font, bold: true, size: 28, color: '2E5496' },
        paragraph: { spacing: { before: 400, after: 160 } },
      },
      heading3: {
        run: { rightToLeft: true, font, bold: true, size: 24, color: '44546A' },
        paragraph: { spacing: { before: 200, after: 80 } },
      },
    },
  };
}

/**
 * The RTL paragraph/run primitives, bound to a `docx` namespace.
 *
 * @param {object} docx - the `docx` module namespace
 * @param {{ font?: string }} [options]
 * @returns {{ RTL: object, run: Function, para: Function, heading: Function, textToParagraphs: Function }}
 */
export function createRtl(docx, { font = DEFAULT_FONT } = {}) {
  const { Paragraph, TextRun, AlignmentType } = docx;

  const run = (text, extra) => new TextRun({ text: String(text ?? ''), rightToLeft: true, font, ...extra });
  const para = (text, extra) => new Paragraph({ ...RTL, ...extra, children: [run(text)] });
  // CENTER is the one direction-neutral alignment (rule 2), so the title can be
  // centered without risking a flip.
  const heading = (text, level, extra) =>
    new Paragraph({ ...RTL, heading: level, alignment: AlignmentType.CENTER, ...extra, children: [run(text)] });
  // One paragraph per line — Word has no "soft" line inside a paragraph that
  // survives a template splice reliably, and a blank line must stay a blank
  // paragraph so the author's spacing is preserved verbatim.
  const textToParagraphs = (text, extra) => String(text ?? '').split(/\r?\n/).map((line) => para(line, extra));

  return { RTL, run, para, heading, textToParagraphs };
}

/**
 * Build one RTL table cell.
 *
 * @param {object} docx
 * @param {object} spec
 * @param {string} spec.text
 * @param {number} spec.widthDxa - the width of the cell's GRID column, in twips
 * @param {boolean} [spec.header] - shaded + bold + white + centered
 * @param {boolean} [spec.center] - center a body cell (dates, short codes)
 * @param {number} [spec.rowSpan] - >1 starts a vertical merge (`w:vMerge`)
 * @param {string} [spec.font]
 */
function rtlCell(docx, { text = '', widthDxa, header = false, center = false, rowSpan, font = DEFAULT_FONT }) {
  const { Paragraph, TextRun, TableCell, WidthType, VerticalAlignTable, AlignmentType } = docx;
  const centered = header || center;
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    // docx only emits w:vMerge for rowSpan > 1, and it inserts the CONTINUE cells
    // into the following rows itself — which is why the caller omits them.
    ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
    ...(header ? { shading: { type: 'clear', color: 'auto', fill: HEADER_FILL } } : {}),
    margins: { marginUnitType: WidthType.DXA, ...CELL_MARGIN_DXA },
    children: [
      new Paragraph({
        ...RTL,
        ...(centered ? { alignment: AlignmentType.CENTER } : {}),
        // keepNext holds the cell with the next row so Word pushes a table to the
        // next page instead of slicing it.
        keepNext: true,
        children: [new TextRun({
          text: String(text ?? ''),
          rightToLeft: true,
          font,
          ...(header ? { bold: true, color: 'FFFFFF' } : {}),
        })],
      }),
    ],
  });
}

/**
 * Build the RTL table (rule 4) from a plain cell matrix.
 *
 * A `null` cell is OMITTED from its row: that is exactly what `docx` expects for a
 * vertical merge — it injects the `w:vMerge="continue"` cell at the right grid
 * index itself. Because of that omission the per-cell width MUST come from the
 * cell's index in the ORIGINAL row (its grid column), never from its position in
 * the shortened array.
 *
 * @param {object} docx - the `docx` module namespace
 * @param {object} options
 * @param {number[]} options.columnWidths - DXA width per grid column
 * @param {Array<{cells: Array<{text: string, rowSpan?: number, center?: boolean}|null>, header?: boolean}>} options.rows
 * @param {string} [options.font]
 * @returns {object} a `docx` Table
 */
export function rtlTableFromCells(docx, { columnWidths, rows, font = DEFAULT_FONT }) {
  const { Table, TableRow, TableLayoutType, WidthType, BorderStyle } = docx;
  const border = { style: BorderStyle.SINGLE, size: 2, color: BORDER_COLOR };

  const tableRows = (rows || []).map((row) => new TableRow({
    ...(row?.header ? { tableHeader: true } : {}),
    cantSplit: true,
    children: (row?.cells || [])
      .map((cell, gridIndex) => (
        cell == null
          ? null
          : rtlCell(docx, { ...cell, header: !!row?.header, widthDxa: columnWidths[gridIndex], font })
      ))
      .filter((cell) => cell !== null),
  }));

  return new Table({
    columnWidths,
    layout: TableLayoutType.FIXED,
    width: { size: columnWidths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    visuallyRightToLeft: true,
    borders: {
      top: border, bottom: border, left: border, right: border,
      insideHorizontal: border, insideVertical: border,
    },
    rows: tableRows,
  });
}

// `w:bidi` is a CT_OnOff, so "the element is present" and "the section is RTL" are
// NOT the same thing: a bare <w:bidi/> means ON, but an explicit w:val="0"/"false"/
// "off" means the section is LEFT-to-right. An uploaded template can legally carry
// the off form (a section toggled RTL and back in an RTL-locale Word writes it), and
// treating that as "already declared" left the report rendering LTR in precisely the
// viewers this function exists for (macOS Quick Look, Pages) — the rule-5 mitigation
// silently did not apply. So an off-value is REPLACED rather than skipped or added to;
// CT_SectPr allows exactly one w:bidi.
const BIDI_EL = /<w:bidi(?:\s[^>]*)?\s*\/>/;
const BIDI_OFF = /w:val="(?:0|false|off)"/;

// Add <w:bidi/> to every <w:sectPr> that does not already turn it ON. Anchored per
// SECTION rather than on the first <w:docGrid> in the file: a Word-authored RTL
// template already carries <w:bidi/> (legally placed before <w:rtlGutter/>, which
// precedes <w:docGrid>), and a document-wide "already injected?" probe misses it and
// emits a SECOND <w:bidi/> — invalid, since CT_SectPr allows exactly one. That is a
// real bug in the discussions original this was extracted from.
function addSectionBidi(xml) {
  return xml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, (sect) => {
    const existing = sect.match(BIDI_EL);
    // Present already — keep it, unless it explicitly says LTR, which we flip ON.
    if (existing) {
      return BIDI_OFF.test(existing[0]) ? sect.replace(existing[0], '<w:bidi/>') : sect;
    }
    // Per CT_SectPr's sequence, w:bidi must precede w:rtlGutter/w:docGrid.
    if (sect.includes('<w:rtlGutter')) return sect.replace('<w:rtlGutter', '<w:bidi/><w:rtlGutter');
    if (sect.includes('<w:docGrid')) return sect.replace('<w:docGrid', '<w:bidi/><w:docGrid');
    return sect.replace('</w:sectPr>', '<w:bidi/></w:sectPr>');
  });
}

/**
 * Inject SECTION-level RTL into packed .docx bytes (rule 5). Pure byte surgery;
 * on any failure the ORIGINAL bytes are returned, because right-to-left section
 * metadata is a rendering nicety and must never cost the user the report.
 *
 * fflate is imported dynamically so it stays in the lazy export chunk.
 *
 * @param {Uint8Array} bytes - a packed .docx
 * @returns {Promise<Uint8Array>} the same bytes, or a re-zipped copy
 */
export async function injectSectionRtl(bytes) {
  try {
    const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate');
    const files = unzipSync(bytes);
    const key = 'word/document.xml';
    if (!files[key]) return bytes;
    const xml = strFromU8(files[key]);
    const patched = addSectionBidi(xml);
    if (patched === xml) return bytes;
    files[key] = strToU8(patched);
    return zipSync(files, { level: 6 });
  } catch (err) {
    logger.warn('docx/rtl', 'הזרקת RTL ברמת ה-section נכשלה — הקובץ מופק ללא ההתאמה', err);
    return bytes;
  }
}

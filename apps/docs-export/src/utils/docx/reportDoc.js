/**
 * Build the report BODY as .docx bytes.
 *
 * @module utils/docx/reportDoc
 *
 * This is only half of the produced document: the owner's uploaded template
 * supplies the page header/footer/logo, and `templateMerge.js` splices this body
 * into it (see `download.js`). When no template was uploaded, these bytes ARE the
 * downloaded file — which is why the RTL recipe and the styles are applied here
 * rather than being left to the template.
 *
 * `docx` is reached through a DYNAMIC import so the library stays in the lazy
 * export chunk and off the boot path (see the manualChunks note in
 * vite.config.js). That is also why this function is async and why `rtl.js` takes
 * the docx namespace as an argument instead of importing it.
 */
import { createRtl, rtlStyles, rtlTableFromCells, injectSectionRtl } from './rtl.js';

/**
 * DXA (twip) width per table column, in GRID order:
 * `[action, committee, report, date]` — index 0 renders RIGHTMOST, because the
 * table is `visuallyRightToLeft`.
 *
 * The total is 8640 twips (exactly 6in). The page setup is NOT knowable here: the
 * template is uploaded by the owner, and a FIXED-layout table wider than the text
 * column runs off the page. 8640 fits the usable width of both common defaults —
 * A4 (11906 − 2×1440 = 9026) and US Letter (12240 − 2×1440 = 9360) — with slack to
 * spare. `report` takes the largest share because it is the only free-text column;
 * the other three hold a short label, a committee name and an ISO date.
 */
export const COLUMN_WIDTHS_DXA = [1440, 1900, 3860, 1440];

/**
 * Header fallbacks, in the same grid order. `settings.headers.<role> === ''` means
 * "use the board column's title", and that resolution happens upstream in
 * `domain/reportModel.js`. An empty string still arriving here means the lookup
 * found nothing, so the column falls back to its role name rather than rendering a
 * blank heading.
 */
export const DEFAULT_HEADERS = ['פעולה', 'שם הועדה האזורית', 'דיווח', 'תאריך דיווח'];

/** Resolve the four header labels, filling blanks from DEFAULT_HEADERS. */
function resolveHeaders(headers) {
  return DEFAULT_HEADERS.map((fallback, i) => {
    const given = headers?.[i];
    return typeof given === 'string' && given.trim() !== '' ? given : fallback;
  });
}

/**
 * Turn the model's table into the row shape `rtlTableFromCells` consumes.
 *
 * A `null` cell is passed through as `null` on purpose: that is how the renderer
 * knows to OMIT the cell so `docx` can inject its own `w:vMerge="continue"` at the
 * right grid index. Mapping it to an empty cell instead would silently break every
 * vertical merge.
 */
function tableRowSpecs(table) {
  const rows = [{ header: true, cells: resolveHeaders(table?.headers).map((text) => ({ text })) }];
  for (const row of table?.rows || []) {
    rows.push({
      cells: (row?.cells || []).map((cell) =>
        cell == null
          ? null
          : { text: cell.text ?? '', ...(cell.rowSpan ? { rowSpan: cell.rowSpan } : {}) }
      ),
    });
  }
  return rows;
}

/**
 * Render the report model to .docx bytes.
 *
 * @param {object} model - from `domain/reportModel.js#buildReportModel`
 * @param {string} [model.title] - rendered as a Heading1 when non-empty
 * @param {Array<{type: 'text', text?: string}|{type: 'table'}>} [model.blocks] -
 *   emitted in order; the table block is replaced by the table
 * @param {{headers?: string[], rows?: Array<{cells: Array<{text: string, rowSpan?: number}|null>}>}} [model.table]
 * @returns {Promise<Uint8Array>} a packed .docx
 */
export async function buildReportDocx(model) {
  const docx = await import('docx');
  const { Document, Packer, HeadingLevel } = docx;
  const { heading, textToParagraphs } = createRtl(docx);

  const children = [];

  const title = String(model?.title ?? '').trim();
  if (title) children.push(heading(title, HeadingLevel.HEADING_1));

  // The blocks are the owner's ordered layout, so they drive the flow. The table is
  // rendered AT the table block's position rather than appended, and only once: a
  // corrupt saved blob with two table blocks must not duplicate the whole report.
  let tableRendered = false;
  for (const block of model?.blocks || []) {
    if (block?.type === 'text') {
      children.push(...textToParagraphs(block.text));
    } else if (block?.type === 'table' && !tableRendered) {
      tableRendered = true;
      children.push(
        rtlTableFromCells(docx, {
          columnWidths: COLUMN_WIDTHS_DXA,
          rows: tableRowSpecs(model?.table),
        })
      );
    }
    // Any other type is ignored on purpose — an unknown block from a newer settings
    // version must degrade to "missing", never throw away the whole export.
  }

  const doc = new Document({ styles: rtlStyles(docx), sections: [{ children }] });
  const bytes = new Uint8Array(await Packer.toArrayBuffer(doc));
  // Section-level <w:bidi/> — docx 9.7.1 cannot express it, and viewers such as
  // macOS Quick Look ignore paragraph-level bidi without it. Fail-soft by contract.
  return injectSectionRtl(bytes);
}

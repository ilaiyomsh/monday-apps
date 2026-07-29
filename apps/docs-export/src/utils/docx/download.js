/**
 * Deliver the finished report to the user as a .docx download.
 *
 * @module utils/docx/download
 *
 * The last step of the export, and the one place that decides what happens when the
 * owner's uploaded template is unusable. The rule is absolute: **a bad template
 * costs the header and footer, never the report.** Anything that fails while
 * splicing — undecodable base64, a renamed PDF, a truncated upload, a zip with no
 * `word/document.xml` — degrades to the generated body alone plus a logged warning.
 * The alternative (throwing) would hand the user an error instead of the report they
 * asked for, over page furniture they may not even have noticed was missing.
 * Upload-time validation catches most of this while the owner is still looking at
 * the file picker (`components/SettingsPanel/templateFile.js`); this is the net
 * under a template that was valid then and is not now.
 *
 * `file-saver` and — via `templateMerge.js` — `fflate` are reached through DYNAMIC
 * imports so the zip/docx stack stays in the lazy export chunk and off the boot
 * path (see the manualChunks note in vite.config.js). Do not add a static import of
 * `docx`, `fflate` or `file-saver` to this file; a test asserts their absence.
 *
 * Output is download only — there is deliberately no upload-back-to-monday path.
 */
import logger from '../logger.js';
import { DOCX_MIME, injectSectionRtl } from './rtl.js';

/** Used when the caller passes no filename. ASCII on purpose — safe on every OS. */
export const DEFAULT_FILENAME = 'report.docx';

const DATA_URL_MARKER = ';base64,';

/**
 * Decode a stored template payload to bytes.
 *
 * `assetsStore` keeps a BARE base64 string, but a caller that hands over a raw
 * `FileReader.readAsDataURL` result must not decode to garbage and silently lose the
 * header/footer — so a `data:...;base64,` prefix is stripped when present. Split on
 * the FIRST marker only: base64 never contains that sequence, and a lastIndexOf
 * would truncate a payload that somehow did.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 * @throws {Error} when the payload is not decodable base64 (caller falls back)
 */
function bytesFromBase64(base64) {
  const raw = String(base64 ?? '');
  const at = raw.indexOf(DATA_URL_MARKER);
  const payload = at >= 0 ? raw.slice(at + DATA_URL_MARKER.length) : raw;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Save the report, splicing it into the uploaded template when there is one.
 *
 * @param {object} [options]
 * @param {Uint8Array} options.bodyBytes - the generated body, from `buildReportDocx`
 * @param {string|null} [options.templateBase64] - the uploaded template, if any
 * @param {string} [options.filename]
 * @returns {Promise<void>}
 * @throws {Error} only when there is no report to save at all
 */
export async function downloadReport({ bodyBytes, templateBase64, filename } = {}) {
  // A missing body is a caller bug, not a degraded template: saving a zero-byte
  // ".docx" would look like success and produce a file Word cannot open.
  if (!bodyBytes?.length) {
    throw new Error('downloadReport: bodyBytes is required');
  }

  let bytes = bodyBytes;

  // A blank/absent template is the ordinary "nothing uploaded" case — no splice, and
  // deliberately no warning, or every report without a template would log noise.
  if (typeof templateBase64 === 'string' && templateBase64.trim() !== '') {
    try {
      const { spliceBodyIntoTemplate } = await import('./templateMerge.js');
      const spliced = spliceBodyIntoTemplate(bytesFromBase64(templateBase64), bodyBytes);
      // Re-inject section-level RTL. The splice keeps the TEMPLATE's <w:sectPr>
      // (that is what references the header/footer parts) and therefore DISCARDS
      // the one buildReportDocx injected <w:bidi/> into — so without this, uploading
      // a template silently costs the section-level RTL that the no-template path
      // gets, and viewers which ignore paragraph-level bidi (macOS Quick Look,
      // Pages) render the Hebrew report left-to-right. Idempotent, and fail-soft:
      // it returns the input bytes unchanged on any problem.
      bytes = await injectSectionRtl(spliced);
    } catch (err) {
      logger.warn(
        'docx/download',
        'שילוב תבנית הדוח נכשל — הדוח הופק ללא הכותרת והתחתית מהתבנית',
        err
      );
      bytes = bodyBytes;
    }
  }

  const { saveAs } = await import('file-saver');
  saveAs(new Blob([bytes], { type: DOCX_MIME }), filename || DEFAULT_FILENAME);
}

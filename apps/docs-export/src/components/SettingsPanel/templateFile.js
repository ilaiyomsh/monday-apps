/**
 * Reading and VALIDATING the uploaded .docx template, at upload time.
 *
 * @module components/SettingsPanel/templateFile
 *
 * Why validation lives here and not in the export path: a wrong file (a .doc, a
 * PDF renamed to .docx, a half-finished download) only becomes visible at
 * GENERATION time otherwise — days later, to a different user, as a report that
 * silently lost its header and footer, because `utils/docx/download.js`
 * deliberately falls back to the generated body rather than costing anyone their
 * report. Validating while the owner is still looking at the file picker turns
 * that into a fixable typo.
 *
 * "Valid" is deliberately narrow and STRUCTURAL: the bytes unzip AND the archive
 * contains `word/document.xml` — exactly the entry `spliceBodyIntoTemplate` needs.
 * Everything else a template may carry (headers, footers, styles, media) is
 * legitimately optional, so checking for it would reject working templates.
 *
 * `fflate` is reached through a DYNAMIC import: this panel is part of the boot
 * bundle, and the app keeps the zip/docx libraries off the boot path on purpose
 * (see the manualChunks note in vite.config.js).
 */

/** The `accept` attribute for the file input: extension AND the OOXML mime type. */
export const TEMPLATE_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The one zip entry a template must have for the splice to work. */
const REQUIRED_ENTRY = 'word/document.xml';

const MESSAGES = {
  empty: 'לא נבחר קובץ.',
  read: 'לא ניתן לקרוא את הקובץ שנבחר. נסו לבחור אותו מחדש.',
  not_docx:
    'הקובץ שנבחר אינו קובץ Word תקין (.docx). ' +
    'ודאו שמדובר בקובץ שנשמר מ-Word ולא בקובץ מסוג אחר שהשם שלו שונה.',
};

/**
 * A Hebrew, owner-readable failure carrying a machine-readable `code` so the panel
 * can react (`empty` / `read` / `not_docx`) without matching on message text.
 * `cause` keeps the underlying zip/decode error for the log record.
 */
function templateError(code, cause) {
  const err = new Error(MESSAGES[code]);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

/**
 * The base64 payload of a `FileReader.readAsDataURL` result.
 *
 * Splits on the FIRST `;base64,` only: base64 never contains that sequence, but a
 * `lastIndexOf`/split-and-pop would silently truncate a payload that did.
 *
 * @param {string} dataUrl
 * @returns {string} base64, with no `data:` prefix
 * @throws {Error} `code === 'read'` when this is not a base64 data URL
 */
export function base64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw templateError('read');
  const marker = ';base64,';
  const at = dataUrl.indexOf(marker);
  if (at < 0) throw templateError('read');
  return dataUrl.slice(at + marker.length);
}

/**
 * Decode base64 to raw bytes.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 * @throws {Error} `code === 'read'` when the payload is not decodable base64
 */
export function bytesFromBase64(base64) {
  let binary;
  try {
    binary = atob(String(base64 ?? ''));
  } catch (err) {
    // A corrupt payload is a READ problem, not a wrong file type: telling the
    // owner "this is not a Word file" about a truncated upload sends them looking
    // for the wrong fix.
    throw templateError('read', err);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Throw unless these base64 bytes are a .docx we can splice into.
 *
 * @param {string} base64
 * @returns {Promise<void>}
 * @throws {Error} `code === 'not_docx'` (not a zip, or no word/document.xml) or
 *   `code === 'read'` (undecodable base64)
 */
export async function assertDocxTemplate(base64) {
  const bytes = bytesFromBase64(base64);

  let entries;
  try {
    const { unzipSync } = await import('fflate');
    entries = unzipSync(bytes);
  } catch (err) {
    // fflate throws on anything that is not a zip — the renamed-PDF case, and the
    // truncated-download case. Both are "wrong file", not "storage broke".
    throw templateError('not_docx', err);
  }

  if (!entries[REQUIRED_ENTRY]) throw templateError('not_docx');
}

/**
 * Read a picked file and return it as validated base64, ready for
 * `utils/assetsStore.js#saveTemplate`.
 *
 * @param {File} file - from an `<input type="file">` change event
 * @returns {Promise<string>} base64, with no `data:` prefix
 * @throws {Error} `code` in `'empty' | 'read' | 'not_docx'`
 */
export async function readTemplateFile(file) {
  if (!file) throw templateError('empty');

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    // FileReader reports failure through an EVENT, not a rejected promise — an
    // unhandled onerror here is exactly how an upload appears to hang forever.
    reader.onerror = () => reject(templateError('read', reader.error));
    reader.onabort = () => reject(templateError('read'));
    reader.onload = () => resolve(reader.result);
    // A SYNCHRONOUS throw here (a non-Blob argument) rejects this promise on its
    // own — no catch, so nothing can swallow it.
    reader.readAsDataURL(file);
  });

  const base64 = base64FromDataUrl(dataUrl);
  await assertDocxTemplate(base64);
  return base64;
}

/**
 * templateFile — reading and validating the uploaded .docx at UPLOAD time.
 *
 * The bug this module exists to prevent: a wrong file is accepted silently, and
 * the report loses its header/footer days later for a different user, because
 * `utils/docx/download.js` deliberately falls back to the generated body rather
 * than costing anyone their report. So the tests are mostly about REJECTION —
 * the happy path is one line, the failure modes are the product.
 *
 * Fixtures are REAL zip bytes built with fflate (the same library
 * `utils/docx/templateMerge.js` unzips with), not hand-written byte arrays: the
 * thing under test is "does this unzip and contain word/document.xml", and a
 * hand-built fixture would only prove the test author's idea of a zip.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  TEMPLATE_ACCEPT,
  base64FromDataUrl,
  bytesFromBase64,
  assertDocxTemplate,
  readTemplateFile,
} from '../templateFile';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** base64 of raw bytes, the same way a FileReader data URL encodes them. */
function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A minimal but STRUCTURALLY REAL .docx: the parts spliceBodyIntoTemplate needs. */
const docxBytes = zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8('<w:document><w:body><w:sectPr/></w:body></w:document>'),
  'word/header1.xml': strToU8('<w:hdr/>'),
});

/** A perfectly valid zip that simply is not a Word document. */
const plainZipBytes = zipSync({ 'notes.txt': strToU8('שלום') });

/** Not a zip at all — the classic "renamed a .pdf to .docx". */
const pdfBytes = strToU8('%PDF-1.7\n%not a zip\n');

describe('TEMPLATE_ACCEPT', () => {
  it('accepts the .docx extension AND the OOXML mime type', () => {
    expect(TEMPLATE_ACCEPT).toBe(`.docx,${DOCX_MIME}`);
  });
});

describe('base64FromDataUrl', () => {
  it('returns everything after the base64 marker', () => {
    expect(base64FromDataUrl(`data:${DOCX_MIME};base64,UEsDBBQA`)).toBe('UEsDBBQA');
  });

  it('keeps the payload intact when the base64 itself contains a comma-free "+/="', () => {
    expect(base64FromDataUrl('data:application/octet-stream;base64,a+b/c=')).toBe('a+b/c=');
  });

  it('splits on the FIRST marker only, so a payload is never truncated', () => {
    expect(base64FromDataUrl('data:x;base64,AAA;base64,BBB')).toBe('AAA;base64,BBB');
  });

  it('rejects a data URL with no base64 marker as a read failure', () => {
    expect(() => base64FromDataUrl('data:text/plain,hello')).toThrowError(
      expect.objectContaining({ code: 'read' })
    );
  });

  it('rejects a non-string result', () => {
    expect(() => base64FromDataUrl(null)).toThrowError(expect.objectContaining({ code: 'read' }));
    expect(() => base64FromDataUrl(undefined)).toThrowError(
      expect.objectContaining({ code: 'read' })
    );
  });
});

describe('bytesFromBase64', () => {
  it('decodes to the exact bytes it was given', () => {
    const decoded = bytesFromBase64(toBase64(docxBytes));
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual(Array.from(docxBytes));
  });

  it('decodes the zip local-file-header signature PK\\x03\\x04', () => {
    expect(Array.from(bytesFromBase64('UEsDBA=='))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('reports a corrupt base64 payload as a read failure', () => {
    expect(() => bytesFromBase64('!!!not base64!!!')).toThrowError(
      expect.objectContaining({ code: 'read' })
    );
  });
});

describe('assertDocxTemplate', () => {
  it('resolves for a zip that contains word/document.xml', async () => {
    await expect(assertDocxTemplate(toBase64(docxBytes))).resolves.toBeUndefined();
  });

  it('rejects a valid zip that has no word/document.xml, naming the file kind in Hebrew', async () => {
    await expect(assertDocxTemplate(toBase64(plainZipBytes))).rejects.toThrowError(
      expect.objectContaining({
        code: 'not_docx',
        message:
          'הקובץ שנבחר אינו קובץ Word תקין (.docx). ודאו שמדובר בקובץ שנשמר מ-Word ולא בקובץ מסוג אחר שהשם שלו שונה.',
      })
    );
  });

  it('rejects bytes that are not a zip at all', async () => {
    await expect(assertDocxTemplate(toBase64(pdfBytes))).rejects.toThrowError(
      expect.objectContaining({ code: 'not_docx' })
    );
  });

  it('rejects an empty payload', async () => {
    await expect(assertDocxTemplate('')).rejects.toThrowError(
      expect.objectContaining({ code: 'not_docx' })
    );
  });

  it('reports a corrupt base64 payload as a read failure, not as a wrong file type', async () => {
    await expect(assertDocxTemplate('!!!not base64!!!')).rejects.toThrowError(
      expect.objectContaining({ code: 'read' })
    );
  });
});

describe('readTemplateFile', () => {
  const fileOf = (bytes, name = 'template.docx') =>
    new File([bytes], name, { type: DOCX_MIME });

  it('resolves base64 that round-trips to the file\'s exact bytes', async () => {
    const base64 = await readTemplateFile(fileOf(docxBytes));
    expect(base64).toBe(toBase64(docxBytes));
    expect(Array.from(bytesFromBase64(base64))).toEqual(Array.from(docxBytes));
  });

  it('resolves base64 with NO data: prefix left on it', async () => {
    const base64 = await readTemplateFile(fileOf(docxBytes));
    expect(base64.startsWith('data:')).toBe(false);
    expect(base64).not.toContain('base64,');
  });

  it('rejects a wrong file while the picker is still open, rather than at export time', async () => {
    await expect(readTemplateFile(fileOf(pdfBytes, 'report.docx'))).rejects.toThrowError(
      expect.objectContaining({ code: 'not_docx' })
    );
  });

  it('rejects a zip that is not a Word document', async () => {
    await expect(readTemplateFile(fileOf(plainZipBytes))).rejects.toThrowError(
      expect.objectContaining({ code: 'not_docx' })
    );
  });

  it('rejects when no file was given at all', async () => {
    await expect(readTemplateFile(null)).rejects.toThrowError(
      expect.objectContaining({ code: 'empty', message: 'לא נבחר קובץ.' })
    );
    await expect(readTemplateFile(undefined)).rejects.toThrowError(
      expect.objectContaining({ code: 'empty' })
    );
  });
});

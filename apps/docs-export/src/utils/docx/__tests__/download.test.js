/*
 * downloadReport is the last step of the export, and its defining rule is that a bad
 * TEMPLATE must never cost the user their report: anything that goes wrong in the
 * splice degrades to "the generated body, without the uploaded header/footer" plus a
 * logged warning — never an exception, never a missing download.
 *
 * A jsdom Blob carries only `size` and `type` (no arrayBuffer/text/stream), so the
 * saved bytes are captured by recording the parts handed to the Blob constructor.
 * That is also how we can assert on the EXACT bytes instead of a size proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as docx from 'docx';
import { Packer } from 'docx';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { saveAs } from 'file-saver';
import logger from '../../logger.js';
import { DOCX_MIME } from '../rtl.js';
import { downloadReport } from '../download.js';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

// jsdom replaces the global URL, and node's fs rejects a jsdom URL instance — so
// resolve the fixture as a plain path (same reason as templateMerge.test.js).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = path.resolve(HERE, '../../../../../discussions/docs/export-template-sample.docx');
const SAMPLE = new Uint8Array(readFileSync(SAMPLE_PATH));
const SAMPLE_B64 = readFileSync(SAMPLE_PATH).toString('base64');
const HEADER_TEXT = 'ארגון לדוגמה בע״מ';
const FOOTER_TEXT = 'מסמך פנימי';
const BODY_TEXT = 'תוכן-הדוח-המיוצר';
const LOGO_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

/** A realistic generated body .docx — built with docx directly, so this suite does
 *  not depend on reportDoc.js. */
async function bodyDocx(text = BODY_TEXT) {
  const doc = new docx.Document({
    sections: [{ children: [new docx.Paragraph({ bidirectional: true, children: [new docx.TextRun({ text, rightToLeft: true })] })] }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

// Record the parts passed to `new Blob(...)`; jsdom cannot read a Blob back.
const RealBlob = globalThis.Blob;
class RecordingBlob extends RealBlob {
  constructor(parts, options) {
    super(parts, options);
    this.recordedParts = parts;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Blob', RecordingBlob);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The single saveAs call: { bytes, type, filename }. */
function savedCall() {
  expect(saveAs).toHaveBeenCalledTimes(1);
  const [blob, filename] = saveAs.mock.calls[0];
  return { bytes: new Uint8Array(blob.recordedParts[0]), type: blob.type, filename };
}

const bytesEqual = (a, b) => expect(Array.from(a)).toEqual(Array.from(b));
/** The document's trailing section properties — the ones Word actually applies. */
const lastSectPr = (xml) => xml.slice(xml.lastIndexOf('<w:sectPr'));

describe('downloadReport — the plain path, with no uploaded template', () => {
  it('saves exactly the generated body bytes', async () => {
    const body = await bodyDocx();
    await downloadReport({ bodyBytes: body, templateBase64: null, filename: 'report.docx' });
    bytesEqual(savedCall().bytes, body);
  });

  it('saves under the requested filename, with the WordprocessingML mime type', async () => {
    await downloadReport({ bodyBytes: await bodyDocx(), filename: 'דוח-יומי.docx' });
    const { filename, type } = savedCall();
    expect(filename).toBe('דוח-יומי.docx');
    expect(type).toBe(DOCX_MIME);
  });

  it('does not warn when no template was uploaded — that is the normal case', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    for (const templateBase64 of [null, undefined, '', '   ']) {
      vi.clearAllMocks();
      await downloadReport({ bodyBytes: await bodyDocx(), templateBase64, filename: 'r.docx' });
      expect(saveAs).toHaveBeenCalledTimes(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('downloadReport — splicing the uploaded template', () => {
  it('keeps the template header, footer and media, and swaps in the generated body', async () => {
    const withLogo = (() => {
      const files = unzipSync(SAMPLE);
      files['word/media/image1.png'] = LOGO_BYTES;
      return zipSync(files, { level: 6 });
    })();

    const body = await bodyDocx();
    await downloadReport({ bodyBytes: body, templateBase64: toBase64(withLogo), filename: 'r.docx' });

    const parts = unzipSync(savedCall().bytes);
    expect(strFromU8(parts['word/header1.xml'])).toContain(HEADER_TEXT);
    expect(strFromU8(parts['word/footer1.xml'])).toContain(FOOTER_TEXT);
    bytesEqual(parts['word/media/image1.png'], LOGO_BYTES);
    // the generated content replaced the template's body flow
    expect(strFromU8(parts['word/document.xml'])).toContain(BODY_TEXT);
  });

  it('produces bytes that differ from the body alone — proof the splice actually ran', async () => {
    const body = await bodyDocx();
    await downloadReport({ bodyBytes: body, templateBase64: SAMPLE_B64, filename: 'r.docx' });
    const { bytes } = savedCall();
    expect(Array.from(bytes)).not.toEqual(Array.from(body));
    // and the result still carries the template's header part, which the body has not
    expect(Object.keys(unzipSync(bytes))).toContain('word/header1.xml');
  });

  it('accepts a base64 payload that still carries its data: URL prefix', async () => {
    // assetsStore stores a bare payload, but a caller handing over a FileReader
    // data URL must not silently decode to garbage and lose the header/footer.
    const dataUrl = `data:${DOCX_MIME};base64,${SAMPLE_B64}`;
    await downloadReport({ bodyBytes: await bodyDocx(), templateBase64: dataUrl, filename: 'r.docx' });
    expect(Object.keys(unzipSync(savedCall().bytes))).toContain('word/header1.xml');
  });

  it('does not warn on a template that splices cleanly', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await downloadReport({ bodyBytes: await bodyDocx(), templateBase64: SAMPLE_B64, filename: 'r.docx' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('restores section-level RTL, which the splice would otherwise drop', async () => {
    // buildReportDocx injects <w:bidi/> into the sectPr it generates, but the splice
    // deliberately keeps the TEMPLATE's sectPr (that is what references the
    // header/footer parts) and discards the generated one. Without a re-injection
    // here, uploading a template silently costs the section-level RTL that the
    // no-template path gets — and viewers that ignore paragraph-level bidi (macOS
    // Quick Look, Pages) then render the report left-to-right.
    const templateSect = lastSectPr(strFromU8(unzipSync(SAMPLE)['word/document.xml']));
    expect(templateSect).not.toContain('<w:bidi/>'); // fixture precondition

    await downloadReport({ bodyBytes: await bodyDocx(), templateBase64: SAMPLE_B64, filename: 'r.docx' });

    const sect = lastSectPr(strFromU8(unzipSync(savedCall().bytes)['word/document.xml']));
    expect(sect).toContain('<w:bidi/>');
    // and the template's own section properties are intact — the header/footer
    // references are the whole reason that sectPr was kept
    expect(sect).toContain('<w:headerReference');
    expect(sect).toContain('<w:footerReference');
  });

  it('leaves exactly one w:bidi when the template already declares it', async () => {
    // CT_SectPr allows exactly one w:bidi; a second one makes the file invalid.
    const alreadyRtl = (() => {
      const files = unzipSync(SAMPLE);
      const xml = strFromU8(files['word/document.xml']);
      files['word/document.xml'] = strToU8(xml.replace('<w:docGrid', '<w:bidi/><w:docGrid'));
      return zipSync(files, { level: 6 });
    })();

    await downloadReport({ bodyBytes: await bodyDocx(), templateBase64: toBase64(alreadyRtl), filename: 'r.docx' });

    const sect = lastSectPr(strFromU8(unzipSync(savedCall().bytes)['word/document.xml']));
    expect((sect.match(/<w:bidi\/>/g) || []).length).toBe(1);
  });
});

describe('downloadReport — a bad template costs the header, never the report', () => {
  /** Every one of these must still download the body, and must warn. */
  const badTemplates = {
    'base64 of something that is not a zip': toBase64(new Uint8Array([1, 2, 3, 4, 5])),
    'a zip with no word/document.xml': toBase64(zipSync({ 'word/styles.xml': strToU8('<w:styles/>') })),
    'a string that is not decodable base64': '!!! not base64 !!!',
    'a truncated .docx': toBase64(SAMPLE.slice(0, 40)),
  };

  for (const [label, templateBase64] of Object.entries(badTemplates)) {
    it(`falls back to the generated body and warns for ${label}`, async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const body = await bodyDocx();

      await expect(downloadReport({ bodyBytes: body, templateBase64, filename: 'r.docx' })).resolves.toBeUndefined();

      // the user still gets their report, byte-identical to the generated body...
      const saved = savedCall();
      bytesEqual(saved.bytes, body);
      expect(saved.filename).toBe('r.docx');
      // ...and the failure is visible in the log rather than silent
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe('docx/download');
      // the underlying cause is attached, not discarded
      expect(warn.mock.calls[0][3] ?? warn.mock.calls[0][2]).toBeDefined();
    });
  }
});

describe('downloadReport — refusing to save nothing', () => {
  it('throws when bodyBytes is missing, instead of saving an empty file', async () => {
    await expect(downloadReport({ templateBase64: null, filename: 'r.docx' })).rejects.toThrow(/bodyBytes/);
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('throws when bodyBytes is empty', async () => {
    await expect(downloadReport({ bodyBytes: new Uint8Array(0), filename: 'r.docx' })).rejects.toThrow(/bodyBytes/);
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('throws when called with no argument at all', async () => {
    await expect(downloadReport()).rejects.toThrow(/bodyBytes/);
    expect(saveAs).not.toHaveBeenCalled();
  });
});

describe('downloadReport — the heavy libraries stay off the boot path', () => {
  it('imports docx, fflate and file-saver only dynamically', async () => {
    // vite.config.js keeps these in a lazy chunk on purpose; a STATIC import here
    // would silently pull the whole zip/docx stack into the boot bundle.
    const source = readFileSync(path.resolve(HERE, '../download.js'), 'utf8');
    const staticImports = [...source.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(staticImports).not.toContain('docx');
    expect(staticImports).not.toContain('fflate');
    expect(staticImports).not.toContain('file-saver');
    // and it does reach them at call time
    expect(source).toMatch(/await import\('file-saver'\)/);
  });
});

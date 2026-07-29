/*
 * templateMerge is OOXML byte surgery: it must keep the uploaded template's
 * header/footer/logo (which live in separate zip parts referenced by the body's
 * <w:sectPr>) and replace ONLY the body flow. The fixture is the REAL sample
 * template checked in with the discussions app — the same file an owner would
 * upload — so these tests exercise a Word-shaped package, not an invented one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as docx from 'docx';
import { Packer } from 'docx';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { spliceBodyIntoTemplate } from '../templateMerge.js';

// The sample template ships with the discussions app (docs/export-template-sample.docx):
// an owner-authored .docx carrying ONLY a header/footer design.
// jsdom replaces the global URL, and node's fs rejects a jsdom URL instance — so
// resolve the fixture as a plain path.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = new Uint8Array(
  readFileSync(path.resolve(HERE, '../../../../../discussions/docs/export-template-sample.docx'))
);
const HEADER_TEXT = 'ארגון לדוגמה בע״מ';
const FOOTER_TEXT = 'מסמך פנימי';
const TEMPLATE_BODY_MARKER = 'גוף-התבנית-הישן';
const LOGO_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);

// Re-zip a .docx after mutating its part map — how the fixtures below are derived
// from the real sample.
function rebuild(bytes, mutate) {
  const files = unzipSync(bytes);
  mutate(files);
  return zipSync(files, { level: 6 });
}

// The sample's own body is a single empty paragraph, so give it a marker: a body
// that survives the splice is the bug this test is looking for.
function templateWithBodyText() {
  return rebuild(SAMPLE, (files) => {
    const xml = strFromU8(files['word/document.xml']);
    files['word/document.xml'] = strToU8(
      xml.replace('<w:body>', `<w:body><w:p><w:r><w:t>${TEMPLATE_BODY_MARKER}</w:t></w:r></w:p>`)
    );
  });
}

// Build a generated body-only .docx: RTL text, a Heading2 and an external
// hyperlink (the one relationship kind the merge has to re-number).
async function generatedBody({ text = 'תוכן-מיוצר', withHyperlink = false, withHeading = false } = {}) {
  const children = [new docx.Paragraph({ bidirectional: true, children: [new docx.TextRun({ text, rightToLeft: true })] })];
  if (withHeading) {
    children.push(new docx.Paragraph({
      bidirectional: true,
      heading: docx.HeadingLevel.HEADING_2,
      children: [new docx.TextRun({ text: 'כותרת-משנה', rightToLeft: true })],
    }));
  }
  if (withHyperlink) {
    children.push(new docx.Paragraph({
      bidirectional: true,
      children: [new docx.ExternalHyperlink({
        link: 'https://example.test/report',
        children: [new docx.TextRun({ text: 'קישור', rightToLeft: true })],
      })],
    }));
  }
  const doc = new docx.Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

const textsOf = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);

describe('spliceBodyIntoTemplate — what must survive from the template', () => {
  it('keeps the header part, with its text, byte-for-byte', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, await generatedBody()));
    const original = unzipSync(SAMPLE);
    expect(strFromU8(merged['word/header1.xml'])).toContain(HEADER_TEXT);
    expect(Array.from(merged['word/header1.xml'])).toEqual(Array.from(original['word/header1.xml']));
  });

  it('keeps the footer part, with its text, byte-for-byte', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, await generatedBody()));
    const original = unzipSync(SAMPLE);
    expect(strFromU8(merged['word/footer1.xml'])).toContain(FOOTER_TEXT);
    expect(Array.from(merged['word/footer1.xml'])).toEqual(Array.from(original['word/footer1.xml']));
  });

  it('keeps word/media (the uploaded logo) byte-for-byte', async () => {
    // The checked-in sample has no media part, so the fixture adds one — a logo is
    // the whole point of uploading a template.
    const withLogo = rebuild(SAMPLE, (files) => { files['word/media/image1.png'] = LOGO_BYTES; });
    const merged = unzipSync(spliceBodyIntoTemplate(withLogo, await generatedBody()));
    expect(Array.from(merged['word/media/image1.png'])).toEqual(Array.from(LOGO_BYTES));
  });

  it('keeps the template sectPr, which is what points at the header/footer parts', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, await generatedBody()));
    const xml = strFromU8(merged['word/document.xml']);
    expect(xml).toContain('<w:headerReference w:type="default" r:id="rId7"/>');
    expect(xml).toContain('<w:footerReference w:type="default" r:id="rId8"/>');
    // exactly one sectPr — a generated one appended next to the template's would
    // give Word two conflicting sections
    expect((xml.match(/<w:sectPr/g) || []).length).toBe(1);
  });

  it('keeps every other template part (content types, numbering, settings)', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, await generatedBody()));
    for (const part of ['[Content_Types].xml', 'word/numbering.xml', 'word/settings.xml', 'word/fontTable.xml']) {
      expect(Object.keys(merged)).toContain(part);
    }
  });
});

describe('spliceBodyIntoTemplate — what must be replaced', () => {
  it('drops the template body flow and puts the generated content in its place', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(templateWithBodyText(), await generatedBody({ text: 'תוכן-מיוצר' })));
    const xml = strFromU8(merged['word/document.xml']);
    expect(xml).toContain('תוכן-מיוצר');
    expect(xml).not.toContain(TEMPLATE_BODY_MARKER);
  });

  it('keeps the generated paragraph order', async () => {
    const body = await generatedBody({ text: 'ראשון', withHeading: true });
    const merged = unzipSync(spliceBodyIntoTemplate(templateWithBodyText(), body));
    expect(textsOf(strFromU8(merged['word/document.xml']))).toEqual(['ראשון', 'כותרת-משנה']);
  });
});

describe('spliceBodyIntoTemplate — the two delicate merges', () => {
  it('re-numbers a generated hyperlink rId past the template rIds and rewrites the body reference', async () => {
    // The sample template's own relationships run rId1..rId9, so the generated
    // hyperlink must land on rId10 — reusing its original id would collide with a
    // template part (styles/header/footer) and corrupt the document.
    const body = await generatedBody({ withHyperlink: true });

    // docx 9.7.1 mints HYPERLINK relationship ids as `rId` + a random alphanumeric
    // nonce (e.g. rIdjakb24au1hskrbxyy9abu) while numbering every other part rId1..N.
    // Capture the actual generated id so the test pins the REWRITE rather than
    // assuming the library's id format.
    const genRels = strFromU8(unzipSync(body)['word/_rels/document.xml.rels']);
    const generatedId = genRels.match(/Id="([^"]+)"[^>]*\/hyperlink"/)[1];

    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, body));
    const rels = strFromU8(merged['word/_rels/document.xml.rels']);
    const xml = strFromU8(merged['word/document.xml']);

    const hyperlinkRels = [...rels.matchAll(/<Relationship\b[^>]*\/hyperlink"[^>]*\/>/g)].map((m) => m[0]);
    expect(hyperlinkRels).toHaveLength(1);
    expect(hyperlinkRels[0]).toContain('Id="rId10"');
    expect(hyperlinkRels[0]).toContain('https://example.test/report');

    // The body now points at the NEW id. Asserted attribute-order-independently:
    // docx emits `<w:hyperlink w:history="1" r:id="...">`, and the ORDER is the
    // library's business — what matters is that this tag carries rId10.
    const hyperlinkTags = xml.match(/<w:hyperlink\b[^>]*>/g) || [];
    expect(hyperlinkTags).toHaveLength(1);
    expect(hyperlinkTags[0]).toContain('r:id="rId10"');

    // ...and the original generated id is gone from BOTH parts. This is the
    // assertion that catches a skipped rewrite: leaving the nonce id in the body
    // while the rels only know rId10 is a dangling reference, which makes Word
    // declare the document unreadable.
    expect(generatedId).not.toBe('rId10');
    expect(xml).not.toContain(generatedId);
    expect(rels).not.toContain(generatedId);

    // ...and the template's own relationships are still there
    expect(rels).toContain('Target="header1.xml"');
    expect(rels).toContain('Target="styles.xml"');
  });

  it('appends a style definition the template lacks so a generated heading still renders', async () => {
    const withoutHeading2 = rebuild(SAMPLE, (files) => {
      const xml = strFromU8(files['word/styles.xml']);
      files['word/styles.xml'] = strToU8(xml.replace(/<w:style [^>]*w:styleId="Heading2"[\s\S]*?<\/w:style>/, ''));
    });
    expect(strFromU8(unzipSync(withoutHeading2)['word/styles.xml'])).not.toContain('w:styleId="Heading2"');

    const merged = unzipSync(spliceBodyIntoTemplate(withoutHeading2, await generatedBody({ withHeading: true })));
    const styles = strFromU8(merged['word/styles.xml']);
    expect(styles).toContain('w:styleId="Heading2"');
    // and the template's own definitions are neither dropped nor duplicated
    expect((styles.match(/w:styleId="Heading1"/g) || []).length).toBe(1);
  });

  it('does not duplicate a style the template already defines', async () => {
    const merged = unzipSync(spliceBodyIntoTemplate(SAMPLE, await generatedBody({ withHeading: true })));
    const styles = strFromU8(merged['word/styles.xml']);
    expect((styles.match(/w:styleId="Heading2"/g) || []).length).toBe(1);
  });
});

describe('spliceBodyIntoTemplate — failure modes the caller falls back on', () => {
  it('throws when the template is not a .docx at all', async () => {
    const body = await generatedBody();
    expect(() => spliceBodyIntoTemplate(new Uint8Array([1, 2, 3, 4]), body)).toThrow();
  });

  it('throws when the template zip carries no word/document.xml', async () => {
    const noDoc = zipSync({ 'word/styles.xml': strToU8('<w:styles/>') });
    const body = await generatedBody();
    expect(() => spliceBodyIntoTemplate(noDoc, body)).toThrow(/document\.xml/);
  });

  it('throws when the generated body zip carries no word/document.xml', () => {
    const noDoc = zipSync({ 'word/styles.xml': strToU8('<w:styles/>') });
    expect(() => spliceBodyIntoTemplate(SAMPLE, noDoc)).toThrow(/document\.xml/);
  });
});

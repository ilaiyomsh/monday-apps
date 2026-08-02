/*
 * UPLOAD-mode export — splice the app-generated body into an owner-uploaded .docx
 * "template" that carries ONLY a header/footer design (logo, text, page numbers).
 *
 * The `docx` library can only BUILD documents, not append to an existing one, so
 * we do targeted OOXML surgery with fflate (already a dependency):
 *
 *   1. Keep the template's document.xml but REPLACE its <w:body> flow content with
 *      the generated content, preserving the template's trailing <w:sectPr> — that
 *      sectPr is what references the header/footer parts, so keeping it keeps the
 *      uploaded chrome intact.
 *   2. Everything else in the template zip is kept verbatim: header*.xml,
 *      footer*.xml, word/media/* (the logo), _rels, [Content_Types].xml.
 *   3. Merge the two "delicate" bits from the generated part:
 *        a. hyperlink relationships (summary links) — re-numbered to avoid rId
 *           collisions with the template, then added to the template's rels.
 *        b. any style definition the generated body references that the template
 *           lacks (e.g. Heading2/Heading3) — appended so headings still render.
 *      The generated body uses LITERAL bullet glyphs (see docxExport), NOT Word
 *      numbering, so there is no numbering.xml to merge, and it embeds no images,
 *      so there is no media/content-type to merge either.
 *
 * Pure byte/string surgery; the caller wraps this so any failure falls back to the
 * normal (config) render path rather than breaking the export.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const DOC = 'word/document.xml';
const DOC_RELS = 'word/_rels/document.xml.rels';
const STYLES = 'word/styles.xml';
const SETTINGS = 'word/settings.xml';

// Inner flow content of a <w:body> EXCLUDING its trailing <w:sectPr> (the section
// properties, which we never take from the generated doc).
function bodyInner(xml) {
  const openIdx = xml.indexOf('<w:body');
  if (openIdx < 0) return '';
  const openEnd = xml.indexOf('>', openIdx) + 1;
  const sectIdx = xml.lastIndexOf('<w:sectPr');
  const closeIdx = xml.lastIndexOf('</w:body>');
  const end = sectIdx > openEnd ? sectIdx : closeIdx;
  return end > openEnd ? xml.slice(openEnd, end) : '';
}

// Replace a template document.xml's body flow with `gen`, keeping its sectPr.
function replaceBody(tplXml, gen) {
  const openIdx = tplXml.indexOf('<w:body');
  if (openIdx < 0) return tplXml;
  const openEnd = tplXml.indexOf('>', openIdx) + 1;
  const sectIdx = tplXml.lastIndexOf('<w:sectPr');
  const anchor = sectIdx > openEnd ? sectIdx : tplXml.lastIndexOf('</w:body>');
  if (anchor <= openEnd) return tplXml;
  return tplXml.slice(0, openEnd) + gen + tplXml.slice(anchor);
}

// Re-number the generated hyperlink relationships so they can't collide with the
// template's rIds, add them to the template rels, and rewrite the r:id references
// in the generated body XML. Returns { xml, rels } (rels null when nothing to add).
function mergeHyperlinkRels(genXml, genRelsU8, tplRelsU8) {
  if (!genRelsU8 || !tplRelsU8) return { xml: genXml, rels: null };
  const genRels = strFromU8(genRelsU8);
  let tplRels = strFromU8(tplRelsU8);
  let maxId = 0;
  for (const m of tplRels.matchAll(/Id="rId(\d+)"/g)) maxId = Math.max(maxId, Number(m[1]));

  const relRe = /<Relationship\b[^>]*\/>/g;
  const additions = [];
  let xml = genXml;
  for (const rel of genRels.match(relRe) || []) {
    if (!/Type="[^"]*\/hyperlink"/.test(rel)) continue;
    const idM = rel.match(/Id="(rId\d+)"/);
    if (!idM) continue;
    const oldId = idM[1];
    if (!xml.includes(`r:id="${oldId}"`)) continue; // unreferenced — skip
    maxId += 1;
    const newId = `rId${maxId}`;
    additions.push(rel.replace(`Id="${oldId}"`, `Id="${newId}"`));
    xml = xml.split(`r:id="${oldId}"`).join(`r:id="${newId}"`);
  }
  if (!additions.length) return { xml: genXml, rels: null };
  tplRels = tplRels.replace(/<\/Relationships>/, `${additions.join('')}</Relationships>`);
  return { xml, rels: tplRels };
}

// Append style definitions the template lacks (by styleId) from the generated
// styles.xml, so generated headings keep a definition when the template omits one.
function mergeMissingStyles(tplStylesXml, genStylesXml) {
  const have = new Set();
  for (const m of tplStylesXml.matchAll(/w:styleId="([^"]+)"/g)) have.add(m[1]);
  const toAdd = [];
  for (const block of genStylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || []) {
    const idM = block.match(/w:styleId="([^"]+)"/);
    if (idM && !have.has(idM[1])) toAdd.push(block);
  }
  if (!toAdd.length) return tplStylesXml;
  return tplStylesXml.replace(/<\/w:styles>/, `${toAdd.join('')}</w:styles>`);
}

/*
 * round308 — the TEXT WIDTH of the owner's template, in DXA (twips).
 *
 * This matters because the splice below deliberately keeps the TEMPLATE's
 * <w:sectPr>: page size and margins come from the uploaded file, never from the
 * app. So "let the tables span the page" cannot be a hardcoded number — a
 * template with wider margins would overflow the page, and one with narrower
 * margins would leave a gap. The tables ask for this and scale to it.
 *
 * Reads pgSz@w minus pgMar@left/@right off the LAST sectPr (the body-level one),
 * minus the binding GUTTER (round311 — see below).
 * Returns null when the file is unreadable, the attributes are missing, or the
 * result is implausible — the caller then keeps its own default rather than
 * emitting a table wider than the paper.
 */
export function templateTextWidthDxa(templateBytes) {
  let xml;
  let gutterAtTop = false;
  try {
    const tpl = unzipSync(templateBytes);
    if (!tpl[DOC]) return null;
    xml = strFromU8(tpl[DOC]);
    gutterAtTop = readsGutterAtTop(tpl);
  } catch {
    // Not a readable zip. The splice itself reports the real failure; here a null
    // just means "no better number than the default".
    return null;
  }
  const sectIdx = xml.lastIndexOf('<w:sectPr');
  if (sectIdx < 0) return null;
  const end = xml.indexOf('</w:sectPr>', sectIdx);
  const sect = xml.slice(sectIdx, end < 0 ? undefined : end);
  const num = (re) => {
    const m = sect.match(re);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const page = num(/<w:pgSz[^>]*\sw:w="(\d+)"/);
  const left = num(/<w:pgMar[^>]*\sw:left="(\d+)"/);
  const right = num(/<w:pgMar[^>]*\sw:right="(\d+)"/);
  if (page == null || left == null || right == null) return null;
  /*
   * round311 (PR review) — the GUTTER is binding space reserved IN ADDITION to
   * the left/right margins, so `page - left - right` overstates the usable text
   * column by exactly the gutter. Under `layout: fixed` an over-wide table does
   * not shrink to fit; it runs into the reserved edge. docx-js writes
   * w:gutter="0" and most templates leave it there, so this only bites a file set
   * up for binding — but the helper's contract is "the width the export actually
   * lands on", and that has to hold for those too.
   *
   * The exception is `w:gutterAtTop`, which moves the reservation to the TOP
   * margin: then it costs height, not width, and subtracting it would UNDER-size
   * every table. That flag is document-level (word/settings.xml), not part of
   * sectPr — hence the separate read above.
   */
  const gutter = num(/<w:pgMar[^>]*\sw:gutter="(\d+)"/) ?? 0;
  const width = page - left - right - (gutterAtTop ? 0 : gutter);
  // Sanity window: ~2.5cm to ~40cm of text. Outside it we are reading something
  // that is not a page, so do not trust it.
  return width >= 1440 && width <= 22680 ? width : null;
}

/*
 * Is `w:gutterAtTop` on? It lives in word/settings.xml as a CT_OnOff toggle, so
 * a bare <w:gutterAtTop/> means ON and an explicit w:val of 0/false/off means
 * OFF. Absent settings part, unreadable bytes or an absent element all mean OFF,
 * which is Word's default and the conservative answer: the gutter then reduces
 * the width, so a table can only come out narrower than the page, never wider.
 */
function readsGutterAtTop(unzipped) {
  const part = unzipped[SETTINGS];
  if (!part) return false;
  const m = strFromU8(part).match(/<w:gutterAtTop\b([^>]*)>/);
  if (!m) return false;
  const off = m[1].match(/w:val="([^"]*)"/);
  return !off || !['0', 'false', 'off'].includes(off[1]);
}

/**
 * Splice a generated body .docx into an uploaded template .docx (headers/footers
 * only). Both inputs are raw .docx bytes (Uint8Array); returns the merged .docx
 * bytes (Uint8Array).
 * @throws if either zip lacks word/document.xml (caller falls back to config render).
 */
export function spliceBodyIntoTemplate(templateBytes, bodyBytes) {
  const tpl = unzipSync(templateBytes);
  const body = unzipSync(bodyBytes);
  if (!tpl[DOC] || !body[DOC]) throw new Error('spliceBodyIntoTemplate: missing word/document.xml');

  const gen0 = bodyInner(strFromU8(body[DOC]));
  const { xml: gen, rels } = mergeHyperlinkRels(gen0, body[DOC_RELS], tpl[DOC_RELS]);

  tpl[DOC] = strToU8(replaceBody(strFromU8(tpl[DOC]), gen));
  if (rels) tpl[DOC_RELS] = strToU8(rels);
  if (tpl[STYLES] && body[STYLES]) {
    tpl[STYLES] = strToU8(mergeMissingStyles(strFromU8(tpl[STYLES]), strFromU8(body[STYLES])));
  }
  return zipSync(tpl, { level: 6 });
}

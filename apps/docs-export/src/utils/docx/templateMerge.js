/*
 * PORTED ESSENTIALLY VERBATIM from `apps/discussions/src/utils/docxTemplateMerge.js`
 * (proven in production there since the upload-mode export shipped). Only the module
 * header gained this provenance line — the surgery itself is deliberately unchanged.
 * If a bug is found here, fix it in BOTH apps.
 *
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
 *        a. hyperlink relationships — re-numbered to avoid rId collisions with the
 *           template, then added to the template's rels.
 *        b. any style definition the generated body references that the template
 *           lacks (e.g. Heading2/Heading3) — appended so headings still render.
 *      The generated body uses LITERAL bullet glyphs (see rtl.js), NOT Word
 *      numbering, so there is no numbering.xml to merge, and it embeds no images,
 *      so there is no media/content-type to merge either.
 *
 * Pure byte/string surgery; the caller wraps this so any failure falls back to the
 * generated body alone rather than costing the user the report (see download.js).
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const DOC = 'word/document.xml';
const DOC_RELS = 'word/_rels/document.xml.rels';
const STYLES = 'word/styles.xml';

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
    // Match ANY relationship id, not just `rId<digits>`. docx 9.7.1 mints HYPERLINK
    // ids as `rId` + a random alphanumeric nonce (observed: `rIdjakb24au1hskrbxyy9abu`)
    // while numbering every other part `rId1..rIdN`. The original discussions copy
    // tested `/Id="(rId\d+)"/` here, so every generated hyperlink was silently
    // skipped: the relationship never reached the template rels, yet the spliced body
    // kept pointing at it — leaving a dangling r:id that makes Word declare the
    // document unreadable. THIS IS A LIVE BUG IN apps/discussions/src/utils/
    // docxTemplateMerge.js (same docx version, same regex) — fix it there too.
    const idM = rel.match(/Id="([^"]+)"/);
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

/**
 * Splice a generated body .docx into an uploaded template .docx (headers/footers
 * only). Both inputs are raw .docx bytes (Uint8Array); returns the merged .docx
 * bytes (Uint8Array).
 * @throws if either zip lacks word/document.xml (caller falls back to the body alone).
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

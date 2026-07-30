import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Packer } from 'docx';
import {
  __testHooks, buildDiscussionModel,
  scaleColumnWidths, resolveTableWidthDxa, DEFAULT_TABLE_WIDTH_DXA,
} from '../docxExport.js';
import { templateTextWidthDxa } from '../docxTemplateMerge.js';

/*
 * round308 (owner spec, delivered as a .docx with "current" vs "desired" tables) —
 * the tasks and decisions tables SPAN THE PAGE instead of sitting at ~71% width,
 * their columns are re-proportioned, and four headers are renamed.
 *
 * The width is DERIVED, not hardcoded: docxTemplateMerge keeps the uploaded
 * template's <w:sectPr>, so margins — and therefore the text width — belong to the
 * owner's file. These tests pin both halves of that: the geometry reader, and the
 * fact that both tables land on the SAME total (the reference document had them
 * 279 DXA apart, which was a hand-dragging artifact rather than a spec).
 */

// --- a minimal .docx carrying nothing but page geometry ---------------------
const templateBytes = ({ page = 11907, left = 900, right = 927, extraSect = '' } = {}) => zipSync({
  'word/document.xml': strToU8(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${extraSect}<w:p/>`
    + `<w:sectPr><w:pgSz w:w="${page}" w:h="16839"/>`
    + `<w:pgMar w:top="2552" w:right="${right}" w:bottom="2694" w:left="${left}"/></w:sectPr>`
    + '</w:body></w:document>'
  ),
});
const toB64 = (u8) => {
  let s = '';
  u8.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
};

describe('scaleColumnWidths', () => {
  it('sums to EXACTLY the requested total — Word trusts the grid it is given', () => {
    const w = scaleColumnWidths([0.0589, 0.3817, 0.2061, 0.1619, 0.1914], 9629);
    expect(w.reduce((a, b) => a + b, 0)).toBe(9629);
  });

  it('keeps the proportions', () => {
    const w = scaleColumnWidths([1, 2, 1], 4000);
    expect(w).toEqual([1000, 2000, 1000]);
  });

  it('puts the rounding remainder on the WIDEST column, where twips are invisible', () => {
    // three thirds of 1000 round to 333 each = 999; the +1 must land on a column,
    // and the widest is the only place it cannot be seen.
    const w = scaleColumnWidths([1, 1, 5], 1000);
    expect(w.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(w.indexOf(Math.max(...w))).toBe(2);
  });

  it('works for any total, so a different template geometry still balances', () => {
    for (const total of [5000, 8000, 9350, 9629, 10080, 12000]) {
      expect(scaleColumnWidths([0.0756, 0.6831, 0.2413], total).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('degrades to zeros on empty / non-positive input instead of emitting NaN widths', () => {
    expect(scaleColumnWidths([], 9629)).toEqual([]);
    expect(scaleColumnWidths([1, 1], 0)).toEqual([0, 0]);
    expect(scaleColumnWidths([0, 0], 9629)).toEqual([0, 0]);
  });

  it('never emits a zero-width column for a tiny ratio', () => {
    expect(Math.min(...scaleColumnWidths([0.00001, 1], 1000))).toBeGreaterThan(0);
  });
});

describe('templateTextWidthDxa', () => {
  it('reads page minus margins off the template', () => {
    // the reference document: A4 11907 less 900 + 927 of margin
    expect(templateTextWidthDxa(templateBytes())).toBe(10080);
  });

  it('follows the template, so a narrow-margin file yields a wider text column', () => {
    expect(templateTextWidthDxa(templateBytes({ left: 1440, right: 1440 }))).toBe(9027);
  });

  it('uses the BODY-level (last) sectPr, not an earlier section break', () => {
    const extra = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="99999"/><w:pgMar w:left="0" w:right="0"/></w:sectPr></w:pPr></w:p>';
    expect(templateTextWidthDxa(templateBytes({ extraSect: extra }))).toBe(10080);
  });

  it('returns null — not a guess — when the bytes are not a readable docx', () => {
    expect(templateTextWidthDxa(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('returns null when the geometry is missing', () => {
    const noGeom = zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:sectPr/></w:body></w:document>') });
    expect(templateTextWidthDxa(noGeom)).toBeNull();
  });

  it('rejects an implausible width rather than emitting a table wider than the paper', () => {
    expect(templateTextWidthDxa(templateBytes({ page: 40000, left: 0, right: 0 }))).toBeNull();
    expect(templateTextWidthDxa(templateBytes({ page: 2000, left: 900, right: 900 }))).toBeNull();
  });
});

describe('resolveTableWidthDxa', () => {
  it('falls back to the default when there is no uploaded template', () => {
    expect(resolveTableWidthDxa(null)).toBe(DEFAULT_TABLE_WIDTH_DXA);
    expect(resolveTableWidthDxa({})).toBe(DEFAULT_TABLE_WIDTH_DXA);
    expect(DEFAULT_TABLE_WIDTH_DXA).toBe(9629);
  });

  it("uses the template's own text width when one is uploaded", () => {
    expect(resolveTableWidthDxa({ templateDocx: toB64(templateBytes()) })).toBe(10080);
  });

  it('falls back to the default on an unreadable template instead of throwing', () => {
    expect(resolveTableWidthDxa({ templateDocx: 'not-base64-docx!!' })).toBe(DEFAULT_TABLE_WIDTH_DXA);
  });
});

// --- the rendered document -------------------------------------------------
describe('the rendered tables (round308)', () => {
  const model = () => buildDiscussionModel({
    discussion: { name: 'דיון' },
    tasks: [{ id: '1', name: 'משימה', assignees: [{ id: '1', name: 'דנה' }], deadline: null, status: 'טרם נבחר', fromPrevious: false }],
    decisions: [{ name: 'החלטה', decider: [{ id: '1', name: 'דנה' }], date: null, status: 'אושר' }],
  });
  const template = {
    sections: [
      { key: 'tasks', enabled: true, label: 'משימות' },
      { key: 'decisions', enabled: true, label: 'החלטות' },
    ],
  };
  const xmlOf = async (assets) => {
    const { doc } = await __testHooks.buildExportDoc(model(), template, assets);
    return strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
  };
  // every <w:tblW w:w="N"> in document order
  const tableWidths = (xml) => [...xml.matchAll(/<w:tblW[^>]*\sw:w="(\d+)"/g)].map((m) => Number(m[1]));
  // the gridCol totals, one per table
  const gridSums = (xml) => [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)]
    .map((m) => [...m[1].matchAll(/w:w="(\d+)"/g)].reduce((a, g) => a + Number(g[1]), 0));

  it('renames the number column to "#" in both tables', async () => {
    const xml = await xmlOf(null);
    // docx-js always emits xml:space on <w:t>
    expect(xml).toContain('<w:t xml:space="preserve">#</w:t>');
    expect(xml).not.toContain('מס׳');
  });

  it('renames the decisions headers to נוסח ההחלטה + גורם מחליט', async () => {
    const xml = await xmlOf(null);
    expect(xml).toContain('נוסח ההחלטה');
    expect(xml).toContain('גורם מחליט');
  });

  it('keeps the tasks headers untouched', async () => {
    const xml = await xmlOf(null);
    ['משימה', 'אחראי', 'דד ליין', 'סטטוס'].forEach((h) => expect(xml).toContain(h));
  });

  it('gives BOTH tables the same width, so they line up down the page', async () => {
    const widths = tableWidths(await xmlOf(null));
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBe(widths[1]);
    expect(widths[0]).toBe(DEFAULT_TABLE_WIDTH_DXA);
  });

  it('spans the page — wider than the previous 7200 DXA layout', async () => {
    expect(tableWidths(await xmlOf(null))[0]).toBeGreaterThan(7200);
  });

  it('makes each grid sum to the declared table width (no stretched column)', async () => {
    const xml = await xmlOf(null);
    const declared = tableWidths(xml);
    expect(gridSums(xml)).toEqual(declared);
  });

  it("follows an uploaded template's page width", async () => {
    const assets = { templateDocx: toB64(templateBytes({ left: 1440, right: 1440 })) };
    const widths = tableWidths(await xmlOf(assets));
    expect(widths[0]).toBe(9027);
    expect(widths[1]).toBe(9027); // still identical to each other
  });

  it('keeps both tables centered', async () => {
    const xml = await xmlOf(null);
    // one <w:jc w:val="center"/> inside each tblPr
    const tblPrs = [...xml.matchAll(/<w:tblPr>(.*?)<\/w:tblPr>/gs)].map((m) => m[1]);
    expect(tblPrs).toHaveLength(2);
    tblPrs.forEach((pr) => expect(pr).toContain('w:val="center"'));
  });

  it('keeps the look: header fill, RTL, fixed layout, repeating header row', async () => {
    const xml = await xmlOf(null);
    expect(xml).toContain('4F6B8F');            // header shading
    expect(xml).toContain('<w:bidiVisual');     // RTL tables
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>'); // fixed layout
    expect(xml).toContain('<w:tblHeader');      // header repeats across pages
  });
});

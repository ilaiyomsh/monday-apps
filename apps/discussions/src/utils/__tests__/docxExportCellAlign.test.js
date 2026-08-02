import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Packer } from 'docx';
import {
  __testHooks, buildDiscussionModel,
  withSharedNumberRatio, NUM_COL_RATIO, GENERATED_PAGE_WIDTH_DXA,
} from '../docxExport.js';

/*
 * round309 (owner spec, two points):
 *   1. the "#" (numbering) column is the SAME WIDTH in the החלטות table as in the
 *      משימות table — the reference document had 707 vs 567, two unrelated grids.
 *   2. cell text sits in the true VERTICAL middle of the cell, header row included.
 *
 * Point 2 is the subtle one. `w:vAlign="center"` was already emitted before this
 * round and the text still read as top-heavy, because vAlign centers the paragraph
 * BLOCK and the paragraph inherited `spacing after` + a >single line rule from the
 * Normal style (Word's own default is after=160/line=259; in UPLOAD mode
 * docxTemplateMerge keeps the TEMPLATE's styles.xml, so the owner's file decided it).
 * So these tests pin the spacing reset, not just the vAlign — asserting only vAlign
 * would have passed against the buggy version.
 */

const model = () => buildDiscussionModel({
  discussion: { name: 'דיון' },
  tasks: [
    { id: '1', name: 'משימה', assignees: [{ id: '1', name: 'דנה' }], deadline: null, status: 'טרם נבחר', fromPrevious: false },
    { id: '2', name: 'עוד משימה', assignees: [], deadline: null, status: 'בוצע', fromPrevious: false },
  ],
  decisions: [
    { name: 'החלטה', decider: [{ id: '1', name: 'דנה' }], date: null, status: 'אושר' },
    { name: 'החלטה שנייה', decider: [], date: null, status: 'אושר' },
  ],
});
const template = {
  sections: [
    { key: 'tasks', enabled: true, label: 'משימות' },
    { key: 'decisions', enabled: true, label: 'החלטות' },
  ],
};
const xmlOf = async (assets = null, over = {}) => {
  const { doc } = await __testHooks.buildExportDoc(model(), { ...template, ...over }, assets);
  return strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
};

// one entry per table, in document order
const tables = (xml) => [...xml.matchAll(/<w:tbl>(.*?)<\/w:tbl>/gs)].map((m) => m[1]);
const gridCols = (tbl) => [...tbl.matchAll(/<w:gridCol\b[^>]*\sw:w="(\d+)"/g)].map((m) => Number(m[1]));
const cells = (tbl) => [...tbl.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map((m) => m[1]);

// a minimal .docx carrying nothing but page geometry (mirrors the round308 helper)
const templateBytes = ({ page = 11907, left = 900, right = 927 } = {}) => zipSync({
  'word/document.xml': strToU8(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body><w:p/>'
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

describe('withSharedNumberRatio', () => {
  it('forces the first entry to the shared number ratio', () => {
    expect(withSharedNumberRatio([0.075615, 0.683102, 0.241283])[0]).toBe(NUM_COL_RATIO);
  });

  it('still sums to one, so the total width is unaffected', () => {
    const out = withSharedNumberRatio([0.075615, 0.683102, 0.241283]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('keeps the remaining columns proportional TO EACH OTHER', () => {
    const before = [0.075615, 0.683102, 0.241283];
    const after = withSharedNumberRatio(before);
    expect(after[1] / after[2]).toBeCloseTo(before[1] / before[2], 10);
  });

  it('GROWS the remaining columns when the number column shrinks', () => {
    // decisions' own "#" was 0.0756, wider than the shared 0.0589 — so the text and
    // decider columns must absorb the freed width, not leave a gap.
    const after = withSharedNumberRatio([0.075615, 0.683102, 0.241283]);
    expect(after[1]).toBeGreaterThan(0.683102);
    expect(after[2]).toBeGreaterThan(0.241283);
  });

  it('is a no-op on ratios that already carry the shared number ratio', () => {
    const tasks = [NUM_COL_RATIO, 0.381660, 0.206116, 0.161906, 0.191434];
    withSharedNumberRatio(tasks).forEach((r, i) => expect(r).toBeCloseTo(tasks[i], 12));
  });

  it('honours an explicit ratio instead of the default', () => {
    expect(withSharedNumberRatio([0.5, 0.5], 0.25)).toEqual([0.25, 0.75]);
  });

  it('degrades to a copy rather than emitting NaN or a negative width', () => {
    expect(withSharedNumberRatio([])).toEqual([]);
    expect(withSharedNumberRatio([1])).toEqual([1]);          // nothing to rescale
    expect(withSharedNumberRatio([0.1, 0])).toEqual([0.1, 0]); // zero tail
    expect(withSharedNumberRatio([0.1, 0.9], 1)).toEqual([0.1, 0.9]);   // no room left
    expect(withSharedNumberRatio([0.1, 0.9], 0)).toEqual([0.1, 0.9]);
    expect(withSharedNumberRatio(null)).toEqual([]);
  });

  it('is pure — the input array is not mutated', () => {
    const before = [0.075615, 0.683102, 0.241283];
    withSharedNumberRatio(before);
    expect(before).toEqual([0.075615, 0.683102, 0.241283]);
  });
});

describe('the "#" column matches across both tables (round309)', () => {
  it('is byte-identical in the tasks and decisions grids', async () => {
    const [tasks, decisions] = tables(await xmlOf());
    expect(gridCols(tasks)[0]).toBe(gridCols(decisions)[0]);
  });

  it('is the narrowest column in both, not merely equal', async () => {
    // guards a degenerate "both got the same wrong number" pass
    const [tasks, decisions] = tables(await xmlOf());
    [tasks, decisions].forEach((tbl) => {
      const g = gridCols(tbl);
      expect(g.indexOf(Math.min(...g))).toBe(0);
    });
    expect(gridCols(tasks)[0]).toBe(Math.round(NUM_COL_RATIO * GENERATED_PAGE_WIDTH_DXA));
  });

  it('stays matched on an uploaded template with a different page width', async () => {
    const assets = { templateDocx: toB64(templateBytes()) }; // 10080 of text
    const [tasks, decisions] = tables(await xmlOf(assets, { headerMode: 'upload' }));
    expect(gridCols(tasks)[0]).toBe(gridCols(decisions)[0]);
    expect(gridCols(tasks).reduce((a, b) => a + b, 0)).toBe(10080);
    expect(gridCols(decisions).reduce((a, b) => a + b, 0)).toBe(10080);
  });

  it('leaves נוסח ההחלטה the dominant column after the re-fit', async () => {
    const [, decisions] = tables(await xmlOf());
    const g = gridCols(decisions);
    expect(g[1] / g.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
  });
});

describe('cell text is vertically centered (round309)', () => {
  const SPACING = '<w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/>';

  it('resets paragraph spacing in EVERY cell of both tables', async () => {
    // The regression: vAlign centers the paragraph block, and inherited
    // `spacing after` rides inside that block and lifts the glyphs.
    const all = tables(await xmlOf()).flatMap(cells);
    expect(all).toHaveLength(3 * 5 + 3 * 3); // header + 2 rows, per table
    all.forEach((tc) => expect(tc).toContain(SPACING));
  });

  it('applies to the HEADER row too, not only the body', async () => {
    const [tasks] = tables(await xmlOf());
    const header = cells(tasks).slice(0, 5);
    header.forEach((tc) => {
      expect(tc).toContain('4F6B8F');   // it really is the shaded header row
      expect(tc).toContain(SPACING);
    });
  });

  it('keeps w:vAlign=center on every cell — the reset alone would not center', async () => {
    tables(await xmlOf()).flatMap(cells)
      .forEach((tc) => expect(tc).toContain('<w:vAlign w:val="center"/>'));
  });

  it('keeps the top and bottom cell margins symmetric', async () => {
    // asymmetric padding would re-introduce the off-center look that vAlign fixes
    tables(await xmlOf()).flatMap(cells).forEach((tc) => {
      const top = Number(tc.match(/<w:top w:type="dxa" w:w="(\d+)"\/>/)[1]);
      const bottom = Number(tc.match(/<w:bottom w:type="dxa" w:w="(\d+)"\/>/)[1]);
      expect(top).toBe(bottom);
    });
  });

  it('does not leak the reset onto body paragraphs outside the tables', async () => {
    const xml = await xmlOf();
    const outside = xml.replace(/<w:tbl>.*?<\/w:tbl>/gs, '');
    expect(outside).not.toContain(SPACING);
  });
});

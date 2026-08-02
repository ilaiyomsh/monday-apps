import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { templateTextWidthDxa } from '../docxTemplateMerge.js';

/*
 * round311 (PR review on the 2.3.8 release) — the template's binding GUTTER is
 * space reserved IN ADDITION to the left/right margins, so `page - left - right`
 * overstated the usable text column by exactly the gutter. Under `layout: fixed`
 * an over-wide table does not shrink; it runs into the reserved edge.
 *
 * The exception is `w:gutterAtTop`, which moves the reservation to the TOP margin
 * — then it costs height, not width, and subtracting it would UNDER-size every
 * table. That toggle is document-level (word/settings.xml), NOT part of sectPr,
 * which is why the helper has to read a second part of the zip.
 */

const A4 = 11907;
const docXml = ({ page = A4, left = 900, right = 927, gutter = null } = {}) =>
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:body><w:p/>'
  + `<w:sectPr><w:pgSz w:w="${page}" w:h="16839"/>`
  + `<w:pgMar w:top="2552" w:right="${right}" w:bottom="2694" w:left="${left}"`
  + (gutter == null ? '' : ` w:gutter="${gutter}"`)
  + '/></w:sectPr>'
  + '</w:body></w:document>';

// `settings` null ⇒ no settings part at all (a hand-built minimal .docx).
const tpl = ({ settings = null, ...geom } = {}) => zipSync({
  'word/document.xml': strToU8(docXml(geom)),
  ...(settings == null ? {} : {
    'word/settings.xml': strToU8(
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + settings + '</w:settings>'
    ),
  }),
});

describe('templateTextWidthDxa — the binding gutter', () => {
  it('subtracts the gutter from the usable text width', () => {
    // 11907 − 900 − 927 = 10080 of margin-box, less 720 reserved for binding
    expect(templateTextWidthDxa(tpl({ gutter: 720 }))).toBe(10080 - 720);
  });

  it('is unchanged when the gutter is zero — what docx-js and most templates write', () => {
    expect(templateTextWidthDxa(tpl({ gutter: 0 }))).toBe(10080);
  });

  it('treats an absent w:gutter attribute as no gutter', () => {
    expect(templateTextWidthDxa(tpl())).toBe(10080);
  });

  it('scales with the gutter rather than applying a fixed correction', () => {
    // pins the arithmetic, not one magic number: a mutant that subtracts a
    // constant, or subtracts twice, fails here
    for (const g of [0, 180, 567, 720, 1440]) {
      expect(templateTextWidthDxa(tpl({ gutter: g }))).toBe(10080 - g);
    }
  });

  it('never returns MORE than the margin box, whatever the gutter', () => {
    for (const g of [0, 360, 1080]) {
      expect(templateTextWidthDxa(tpl({ gutter: g }))).toBeLessThanOrEqual(10080);
    }
  });
});

describe('templateTextWidthDxa — w:gutterAtTop moves the reservation off the width', () => {
  it('keeps the full width when the gutter sits at the top', () => {
    // subtracting here would UNDER-size every table on the page
    expect(templateTextWidthDxa(tpl({ gutter: 720, settings: '<w:gutterAtTop/>' }))).toBe(10080);
  });

  it('honours an explicit w:val="true"/"1"/"on"', () => {
    for (const val of ['true', '1', 'on']) {
      expect(templateTextWidthDxa(tpl({ gutter: 720, settings: `<w:gutterAtTop w:val="${val}"/>` }))).toBe(10080);
    }
  });

  it('treats an explicitly OFF toggle as off — the gutter still costs width', () => {
    // CT_OnOff: w:val 0/false/off means the element is present but disabled
    for (const val of ['0', 'false', 'off']) {
      expect(templateTextWidthDxa(tpl({ gutter: 720, settings: `<w:gutterAtTop w:val="${val}"/>` }))).toBe(10080 - 720);
    }
  });

  it('defaults to OFF when settings.xml exists but says nothing about it', () => {
    expect(templateTextWidthDxa(tpl({ gutter: 720, settings: '<w:zoom w:percent="100"/>' }))).toBe(10080 - 720);
  });

  it('defaults to OFF when there is no settings part at all', () => {
    // Word's own default, and the conservative direction: the table can only come
    // out narrower than the page, never wider.
    expect(templateTextWidthDxa(tpl({ gutter: 720 }))).toBe(10080 - 720);
  });

  it('does not confuse w:gutterAtTop with a different element that shares its prefix', () => {
    expect(templateTextWidthDxa(tpl({ gutter: 720, settings: '<w:gutterAtTopSomethingElse/>' }))).toBe(10080 - 720);
  });
});

describe('templateTextWidthDxa — the gutter does not break the existing contract', () => {
  it('still reads plain page-minus-margins geometry', () => {
    expect(templateTextWidthDxa(tpl({ left: 1440, right: 1440 }))).toBe(A4 - 2880);
  });

  it('still returns null on unreadable bytes', () => {
    expect(templateTextWidthDxa(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('rejects a gutter that eats the page below the sanity floor', () => {
    // 10080 − 9000 = 1080, under the 1440 floor: not a page we should trust
    expect(templateTextWidthDxa(tpl({ gutter: 9000 }))).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  extractTemplateAnchors,
  extractTemplateTabParagraphs,
  forceRtlRenderedBody,
  patchPageNumbers,
} from '../previewPagination.js';

// round202 — pins the jsdom-testable pieces of the preview geometry toolbox:
// the template-XML extraction that drives the floating-anchor re-anchoring and
// the RTL tab-stop layout (both layout-applied in a real browser — validated
// with the Chromium harness), plus the page-number stamping.

const HEADER_XML = `<?xml version="1.0"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:p>
    <w:pPr><w:bidi/></w:pPr>
    <w:r>
      <w:drawing>
        <wp:anchor behindDoc="1">
          <wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>
          <wp:positionV relativeFrom="page"><wp:posOffset>320040</wp:posOffset></wp:positionV>
          <wp:extent cx="1143000" cy="857250"/>
          <wp:wrapNone/>
        </wp:anchor>
      </w:drawing>
    </w:r>
    <w:r><w:t>ועדת הבחירות</w:t></w:r>
  </w:p>
</w:hdr>`;

const FOOTER_XML = `<?xml version="1.0"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:tabs><w:tab w:val="center" w:pos="4513"/></w:tabs>
      <w:bidi/>
    </w:pPr>
    <w:r><w:tab/><w:t>טלפון: 02-5669855</w:t></w:r>
  </w:p>
  <w:p><w:r><w:t>עמוד</w:t></w:r></w:p>
</w:ftr>`;

function makeTemplateZip() {
  return zipSync({
    'word/document.xml': strToU8('<w:document/>'),
    'word/header1.xml': strToU8(HEADER_XML),
    'word/footer1.xml': strToU8(FOOTER_XML),
  });
}

describe('forceRtlRenderedBody', () => {
  it('right-aligns the Hebrew background, references, and summary preview text', () => {
    const stage = document.createElement('div');
    stage.innerHTML = `
      <section class="docx">
        <article>
          <p data-box="background">רקע לדיון</p>
          <p data-box="references">התייחסויות המשתתפים</p>
          <p data-box="summary">סיכום הדיון</p>
        </article>
      </section>
    `;

    forceRtlRenderedBody(stage);

    for (const box of ['background', 'references', 'summary']) {
      const paragraph = stage.querySelector(`[data-box="${box}"]`);
      expect(paragraph.style.direction).toBe('rtl');
      expect(paragraph.style.textAlign).toBe('right');
    }
  });

  it('preserves explicit alignment from the rendered document', () => {
    const stage = document.createElement('div');
    stage.innerHTML = `
      <section class="docx">
        <article><h1 style="text-align: center">כותרת הדיון</h1></article>
      </section>
    `;

    forceRtlRenderedBody(stage);

    const title = stage.querySelector('h1');
    expect(title.style.direction).toBe('rtl');
    expect(title.style.textAlign).toBe('center');
  });
});

describe('extractTemplateAnchors', () => {
  it('reads a floating anchor: EMU extent → px, page-relative center/offset, behindDoc', () => {
    const anchors = extractTemplateAnchors(makeTemplateZip());
    expect(anchors.header).toHaveLength(1);
    const a = anchors.header[0];
    expect(a.behind).toBe(true);
    expect(a.cx).toBeCloseTo(120, 5);   // 1143000 EMU ÷ 9525
    expect(a.cy).toBeCloseTo(90, 5);    // 857250 EMU ÷ 9525
    expect(a.h).toEqual({ rel: 'page', align: 'center', offset: null });
    expect(a.v.rel).toBe('page');
    expect(a.v.offset).toBeCloseTo(33.6, 5); // 320040 EMU ÷ 9525
    expect(anchors.footer).toHaveLength(0);
  });

  it('returns null when the template has no header/footer parts', () => {
    const zip = zipSync({ 'word/document.xml': strToU8('<w:document/>') });
    expect(extractTemplateAnchors(zip)).toBeNull();
  });
});

describe('extractTemplateTabParagraphs', () => {
  it('reads per-paragraph tab count, stops (twips → px) and bidi, in order', () => {
    const tabs = extractTemplateTabParagraphs(makeTemplateZip());
    expect(tabs.footer).toHaveLength(2);
    const p0 = tabs.footer[0];
    expect(p0.tabCount).toBe(1); // the run tab — NOT the <w:tabs> stop def
    expect(p0.bidi).toBe(true);
    expect(p0.stops).toEqual([{ type: 'center', posPx: 4513 / 15 }]);
    // Second paragraph has no tabs.
    expect(tabs.footer[1].tabCount).toBe(0);
    // The header paragraph has no run tabs either.
    expect(tabs.header[0].tabCount).toBe(0);
  });
});

describe('patchPageNumbers', () => {
  it('stamps עמוד k מתוך N on every rendered page', () => {
    const stage = document.createElement('div');
    for (let i = 0; i < 2; i += 1) {
      const sec = document.createElement('section');
      sec.className = 'docx';
      const p = document.createElement('p');
      const s1 = document.createElement('span'); s1.textContent = 'עמוד ';
      const s2 = document.createElement('span'); s2.textContent = ' מתוך ';
      p.append(s1, s2);
      sec.appendChild(p);
      stage.appendChild(sec);
    }
    patchPageNumbers(stage);
    const texts = [...stage.querySelectorAll('p')].map((p) => p.textContent);
    expect(texts).toEqual(['עמוד 1 מתוך 2', 'עמוד 2 מתוך 2']);
  });

  it('leaves a page-number line that already has digits untouched', () => {
    const stage = document.createElement('div');
    const sec = document.createElement('section');
    sec.className = 'docx';
    const p = document.createElement('p');
    const s = document.createElement('span'); s.textContent = 'עמוד 3 מתוך 7';
    p.appendChild(s);
    sec.appendChild(p);
    stage.appendChild(sec);
    patchPageNumbers(stage);
    expect(stage.querySelector('p').textContent).toBe('עמוד 3 מתוך 7');
  });

  it('round219 — elevates the page-number paragraph above behind-text footer art', () => {
    const stage = document.createElement('div');
    const sec = document.createElement('section');
    sec.className = 'docx';
    const pageP = document.createElement('p');
    const s1 = document.createElement('span'); s1.textContent = 'עמוד ';
    const s2 = document.createElement('span'); s2.textContent = ' מתוך ';
    pageP.append(s1, s2);
    // a plain footer paragraph WITHOUT a page number must stay untouched
    const otherP = document.createElement('p');
    otherP.textContent = 'כותרת תחתונה';
    sec.append(pageP, otherP);
    stage.appendChild(sec);

    patchPageNumbers(stage);

    // The page-number paragraph joins the positioned layer with a positive z-index
    // so a behind-doc footer banner (z-index 0) can't paint over it.
    expect(pageP.style.position).toBe('relative');
    expect(Number(pageP.style.zIndex)).toBeGreaterThan(0);
    // A non-page-number paragraph is left alone (no elevation forced on all text).
    expect(otherP.style.position).toBe('');
    expect(otherP.style.zIndex).toBe('');
  });
});

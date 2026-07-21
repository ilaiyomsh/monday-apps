/*
 * round202 — the live export-preview's page-geometry toolbox, extracted from
 * ExportPreview.jsx into a pure-DOM module (no React) so the pieces are
 * individually testable and reusable by the browser harness that validates
 * them against real Chromium geometry.
 *
 * What lives here and WHY (root causes, verified against docx-preview 0.4.0
 * source):
 *
 * 1. paginateRenderedDocx — docx-preview breaks pages only at explicit
 *    page-break marks; a generated doc has none, so this splits the rendered
 *    section into true fixed-height pages by measuring block offsets
 *    (round197). round202 adds a hard clamp: each page's article is clipped
 *    to its content budget so body flow can NEVER paint into the footer band,
 *    even if some block mis-measures.
 *
 * 2. waitForImages — docx-preview resolves renderAsync after setting each
 *    <img>.src, NOT after the images LOAD; measuring page geometry before the
 *    header/footer images decode under-counts their flow height, which made
 *    the pagination budget too generous and let body content overlap the
 *    footer (owner-reported). Await decode() on every image first.
 *
 * 3. extractTemplateAnchors + reanchorFloatingDrawings — Word templates place
 *    header/footer art (logos, banners) as FLOATING anchored drawings
 *    (wp:anchor + wrapNone). docx-preview renders those as a 0×0
 *    position:relative box whose left/top were measured from the PAGE edge in
 *    the file but are applied from the anchor PARAGRAPH's flow position — so
 *    the art lands shifted (the owner's "not centered" header/footer) and its
 *    real size is invisible to flow measurement (part of the overlap). Fix:
 *    read each anchor's true geometry (extent + positionH/V) straight from the
 *    template's headerN.xml / footerN.xml and re-position the rendered box
 *    ABSOLUTELY against the page section, restoring its real size.
 */
import { unzipSync, strFromU8 } from 'fflate';

// 914400 EMU per inch ÷ 96 CSS px per inch.
const EMU_PER_PX = 9525;

/**
 * Height-based pagination (round197). Splits the single rendered section into
 * fixed-height pages: whole blocks (paragraphs / tables) move to the next page
 * when they cross the content budget — a heading glued above a moved block
 * moves with it (mirrors the doc's keepNext) — and each page clones the
 * section shell + header + footer. Must run while the stage is ATTACHED
 * (hidden) so offsets/heights are real.
 */
export function paginateRenderedDocx(stage) {
  const wrapper = stage.querySelector('.docx-wrapper') || stage;
  const src = wrapper.querySelector('section.docx');
  const article = src?.querySelector(':scope > article');
  if (!src || !article) return;
  const cs = getComputedStyle(src);
  const pageH = parseFloat(cs.minHeight);
  if (!Number.isFinite(pageH) || pageH <= 0) return;

  // Content budget = page height minus everything that isn't body flow: the
  // article's real offset from the page top (top margin + header flow,
  // measured, so negative header margins are accounted for), the footer's
  // flow height (offsetHeight + its calc margins), and the bottom page margin.
  const srcTop = src.getBoundingClientRect().top;
  const articleTopRel = article.getBoundingClientRect().top - srcTop;
  const header = src.querySelector(':scope > header');
  const footer = src.querySelector(':scope > footer');
  let footerFlow = 0;
  if (footer) {
    const fcs = getComputedStyle(footer);
    footerFlow = footer.offsetHeight + (parseFloat(fcs.marginTop) || 0) + (parseFloat(fcs.marginBottom) || 0);
  }
  const padB = parseFloat(cs.paddingBottom) || 0;
  const budget = pageH - articleTopRel - footerFlow - padB;
  if (!Number.isFinite(budget) || budget <= 40) return;

  // round202 — hard clamp: body flow may never paint into the footer band.
  // The block distribution below keeps every page within budget by
  // construction; the clamp is the physical guarantee (+1px rounding slack).
  const clampArticle = (art) => {
    art.style.maxHeight = `${Math.ceil(budget) + 1}px`;
    art.style.overflow = 'hidden';
  };

  const children = Array.from(article.children);
  if (!children.length) {
    src.style.height = cs.minHeight; // pin the exact page height anyway
    clampArticle(article);
    return;
  }
  const articleRectTop = article.getBoundingClientRect().top;
  const tops = children.map((el) => el.getBoundingClientRect().top - articleRectTop);
  const bottoms = children.map((el, i) => tops[i] + el.offsetHeight);
  // docx-preview classes paragraph styles as docx_heading1..3 — the keepNext glue.
  const isHeading = (el) => /heading/i.test(String(el.className || ''));

  const breaks = [];
  let pageStart = 0;
  for (let i = 0; i < children.length; i += 1) {
    if (i === pageStart) continue; // a page's first block always stays on it
    if (bottoms[i] - tops[pageStart] > budget) {
      let b = i;
      while (b > pageStart + 1 && isHeading(children[b - 1])) b -= 1;
      breaks.push(b);
      pageStart = b;
    }
  }
  // Pin EXACT page height (not min) so the footer sits at the physical bottom
  // and overflow can never overlap it — also on a single-page doc.
  if (!breaks.length) {
    src.style.height = cs.minHeight;
    clampArticle(article);
    return;
  }

  const ranges = [0, ...breaks, children.length];
  const pages = [];
  for (let p = 0; p < ranges.length - 1; p += 1) {
    const shell = src.cloneNode(false);
    shell.style.height = cs.minHeight;
    if (header) shell.appendChild(header.cloneNode(true));
    const art = article.cloneNode(false);
    clampArticle(art);
    shell.appendChild(art);
    if (footer) shell.appendChild(footer.cloneNode(true));
    for (let i = ranges[p]; i < ranges[p + 1]; i += 1) art.appendChild(children[i]);
    pages.push(shell);
  }
  src.remove();
  pages.forEach((pg) => wrapper.appendChild(pg));
}

/**
 * docx-preview parses but never EVALUATES page-number fields (PAGE/NUMPAGES),
 * leaving "עמוד  מתוך " blanks. After pagination the real page count is known —
 * stamp k/N per page (preview-only; the exported file keeps real Word fields).
 */
export function patchPageNumbers(stage) {
  const sections = stage.querySelectorAll('section.docx');
  const total = sections.length;
  sections.forEach((sec, idx) => {
    sec.querySelectorAll('p').forEach((p) => {
      const t = p.textContent || '';
      if (t.includes('עמוד') && t.includes('מתוך') && !/\d/.test(t)) {
        p.querySelectorAll('span').forEach((s) => {
          if (s.textContent === 'עמוד ') s.textContent = `עמוד ${idx + 1}`;
          else if (s.textContent === ' מתוך ') s.textContent = ` מתוך ${total}`;
        });
      }
    });
  });
}

/**
 * Wait for every <img> under `root` to actually decode. docx-preview sets img
 * src asynchronously and resolves before the browser loads the bytes, so any
 * geometry measured earlier is missing the images' heights.
 */
export async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    if (typeof img.decode === 'function') return img.decode().catch(() => {});
    return Promise.resolve();
  }));
}

// One <wp:anchor> read from a header/footer part: real size + Word positioning.
function parseAnchorsFromPart(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const anchors = [];
  for (const el of doc.getElementsByTagName('*')) {
    if (el.localName !== 'anchor') continue;
    const child = (parent, name) => {
      for (const c of parent.children) if (c.localName === name) return c;
      return null;
    };
    const extent = child(el, 'extent');
    const posH = child(el, 'positionH');
    const posV = child(el, 'positionV');
    const readPos = (pos) => ({
      rel: pos?.getAttribute('relativeFrom') || 'page',
      align: child(pos || el, 'align')?.textContent || null,
      offset: child(pos || el, 'posOffset')
        ? Number(child(pos, 'posOffset').textContent) / EMU_PER_PX
        : null,
    });
    anchors.push({
      behind: ['1', 'true'].includes(el.getAttribute('behindDoc') || ''),
      cx: extent ? Number(extent.getAttribute('cx')) / EMU_PER_PX : null,
      cy: extent ? Number(extent.getAttribute('cy')) / EMU_PER_PX : null,
      h: posH ? readPos(posH) : { rel: 'page', align: null, offset: null },
      v: posV ? readPos(posV) : { rel: 'page', align: null, offset: null },
    });
  }
  return anchors;
}

/**
 * Read every floating anchor's true geometry from an uploaded template's
 * headerN.xml / footerN.xml parts. Returns { header: [...], footer: [...] } (anchors
 * in document order per band) or null when the template has none.
 */
export function extractTemplateAnchors(templateBytes) {
  const files = unzipSync(templateBytes);
  const out = { header: [], footer: [] };
  // Sort paths so header1.xml < header2.xml — stable band order.
  for (const path of Object.keys(files).sort()) {
    const m = path.match(/^word\/(header|footer)\d*\.xml$/);
    if (!m) continue;
    out[m[1]].push(...parseAnchorsFromPart(strFromU8(files[path])));
  }
  return out.header.length || out.footer.length ? out : null;
}

// One header/footer paragraph's tab layout, read from the part XML: the run-
// level tab count, the paragraph's tab stops, and its direction.
function parseTabParagraphsFromPart(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [];
  for (const p of doc.getElementsByTagName('*')) {
    if (p.localName !== 'p') continue;
    let tabCount = 0;
    const stops = [];
    let bidi = false;
    for (const el of p.getElementsByTagName('*')) {
      // Content tabs live in a run (<w:r><w:tab/>) in Word files, or bare
      // under <w:p> in some generators; <w:tab> under <w:tabs> is a STOP
      // definition, never content.
      if (el.localName === 'tab' && ['r', 'p'].includes(el.parentNode?.localName)) tabCount += 1;
      if (el.localName === 'tab' && el.parentNode?.localName === 'tabs') {
        stops.push({
          type: el.getAttribute('w:val') || el.getAttributeNS?.(el.namespaceURI, 'val') || el.getAttribute('val') || 'left',
          // twips → CSS px (1440 twips/in ÷ 96 px/in = 15).
          posPx: Number(el.getAttribute('w:pos') ?? el.getAttribute('pos') ?? 0) / 15,
        });
      }
      if (el.localName === 'bidi') bidi = true;
    }
    paras.push({ tabCount, stops, bidi });
  }
  return paras;
}

/**
 * Read the tab layout of every header/footer paragraph from an uploaded
 * template. Returns { header: [...], footer: [...] } — one entry per w:p in
 * document order (so index-matching the rendered <p> elements) — or null.
 */
export function extractTemplateTabParagraphs(templateBytes) {
  const files = unzipSync(templateBytes);
  const out = { header: [], footer: [] };
  for (const path of Object.keys(files).sort()) {
    const m = path.match(/^word\/(header|footer)\d*\.xml$/);
    if (!m) continue;
    out[m[1]].push(...parseTabParagraphsFromPart(strFromU8(files[path])));
  }
  return out.header.length || out.footer.length ? out : null;
}

// A rendered (non-experimental) docx-preview tab: a span whose text is em-
// space(s) only — the bare tab span or a run span wrapping only tab spans
// em-space (see renderTab in docx-preview).
function isRenderedTab(node) {
  return node.nodeType === 1
    && node.tagName === 'SPAN'
    && /^ +$/.test(node.textContent || '');
}

/**
 * Lay out header/footer paragraphs that use TAB STOPS — the way Word templates
 * center/right-place header text. docx-preview only evaluates tab stops in its
 * `experimental` pass, whose math is LTR-only (measured offsets from the LEFT
 * paragraph edge), so RTL template headers still came out off-center. This
 * replaces the tabs with absolutely-positioned segments at the stop positions
 * read from the template XML, honoring paragraph direction: a center stop at
 * position P centers its segment at P from the paragraph's LEADING edge
 * (right, for RTL). Deterministic — no reliance on the deferred experimental
 * pass or its timing.
 */
export function applyTemplateTabStops(sectionEl, tabParas) {
  if (!tabParas) return;
  ['header', 'footer'].forEach((band) => {
    const bandEl = sectionEl.querySelector(`:scope > ${band}`);
    if (!bandEl) return;
    const rendered = Array.from(bandEl.querySelectorAll('p'));
    rendered.forEach((p, i) => {
      const meta = tabParas[band][i];
      if (!meta || !meta.tabCount || !meta.stops.length) return;
      // Word puts tabs INSIDE runs — docx-preview mirrors that, nesting the
      // em-space tab span inside the run span. Normalize first: split any run
      // around its inner tab spans so every tab becomes a DIRECT child of the
      // paragraph, then group the children into segments at the tabs.
      Array.from(p.children).forEach((run) => {
        const innerTabs = Array.from(run.childNodes).filter(isRenderedTab);
        innerTabs.forEach((tabSpan) => {
          const rest = run.cloneNode(false);
          let n = tabSpan.nextSibling;
          while (n) { const next = n.nextSibling; rest.appendChild(n); n = next; }
          p.insertBefore(tabSpan, run.nextSibling);
          if (rest.childNodes.length) p.insertBefore(rest, tabSpan.nextSibling);
        });
      });
      const segs = [[]];
      const tabs = [];
      Array.from(p.childNodes).forEach((n) => {
        if (isRenderedTab(n)) { tabs.push(n); segs.push([]); }
        else segs[segs.length - 1].push(n);
      });
      if (!tabs.length) return;
      const paraW = p.getBoundingClientRect().width;
      const rtlPara = meta.bidi || getComputedStyle(p).direction === 'rtl';
      p.style.position = 'relative';
      tabs.forEach((t) => { t.style.display = 'none'; });
      for (let s = 1; s < segs.length; s += 1) {
        if (!segs[s].length) continue;
        const stop = meta.stops[Math.min(s - 1, meta.stops.length - 1)];
        const wrap = document.createElement('span');
        wrap.style.position = 'absolute';
        wrap.style.top = '0';
        wrap.style.whiteSpace = 'nowrap';
        // Stop position measured from the LEADING edge: right in RTL, left in LTR.
        const x = rtlPara ? paraW - stop.posPx : stop.posPx;
        wrap.style.left = `${x}px`;
        if (stop.type === 'center') wrap.style.transform = 'translateX(-50%)';
        else if ((stop.type === 'right' || stop.type === 'end') && !rtlPara) wrap.style.transform = 'translateX(-100%)';
        else if ((stop.type === 'left' || stop.type === 'start') && rtlPara) wrap.style.transform = 'translateX(-100%)';
        p.insertBefore(wrap, segs[s][0]);
        segs[s].forEach((n) => wrap.appendChild(n));
      }
    });
  });
}

// docx-preview's wrapNone-anchor signature: a 0×0 relative box (see
// parseDrawingWrapper + renderDrawing in docx-preview) holding the real art.
function isCollapsedAnchorBox(el) {
  return el.style
    && el.style.position === 'relative'
    && el.style.width === '0px'
    && el.style.height === '0px';
}

/**
 * Re-anchor a rendered page's floating header/footer drawings to the PAGE box.
 * docx-preview collapses a wrapNone anchor to 0×0 and applies its page-relative
 * offsets from the anchor paragraph's flow position — shifting the art and
 * hiding its size from flow measurement. Word's actual reference frames are in
 * the template XML (`anchors` from extractTemplateAnchors); apply them as
 * absolute positioning against the section (position:relative per docx-preview
 * CSS), restoring the real extent. Anchors are matched per band in document
 * order. Runs in the UNZOOMED hidden stage, before pagination clones pages.
 */
export function reanchorFloatingDrawings(sectionEl, anchors) {
  if (!anchors) return;
  const cs = getComputedStyle(sectionEl);
  const pageW = sectionEl.getBoundingClientRect().width;
  const pageH = parseFloat(cs.minHeight) || sectionEl.getBoundingClientRect().height;
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;

  const secRect = sectionEl.getBoundingClientRect();
  ['header', 'footer'].forEach((band) => {
    const bandEl = sectionEl.querySelector(`:scope > ${band}`);
    if (!bandEl) return;
    // The band is the positioning frame — guarantees every anchor's containing
    // block lives INSIDE the band, whose page position is computable for the
    // FINAL (cloned, fixed-height) page. Anchoring against the section instead
    // breaks: pre-pagination the section overflows its page height, so the
    // footer's flow offset there differs from its position on a cloned page.
    bandEl.style.position = 'relative';

    // PASS 1 — take every anchor box out of flow first: even a collapsed 0×0
    // inline-block still generates a line box, so the band's flow height (and
    // therefore its final page position, below) is only correct AFTER the
    // anchors are absolute.
    const boxes = Array.from(bandEl.querySelectorAll('div')).filter(isCollapsedAnchorBox);
    boxes.forEach((el, i) => {
      const a = anchors[band][i];
      if (!a) return;
      el.style.position = 'absolute';
      el.style.display = 'block';
      if (a.cx) el.style.width = `${a.cx}px`;
      if (a.cy) el.style.height = `${a.cy}px`;
      // Behind-text art sits under the flow (article/footer carry z-index 1).
      el.style.zIndex = a.behind ? '0' : '2';
    });

    const bcs = getComputedStyle(bandEl);
    // Where the band's top edge lands on the FINAL page: the header hangs from
    // the top padding via margin-top calc(header − top); the footer's bottom
    // margin calc(footer − bottom) offsets it from the content-box bottom.
    // Both resolve identically on the source section and on every clone.
    const bandTopFinal = band === 'header'
      ? padT + (parseFloat(bcs.marginTop) || 0)
      : pageH - padB - (parseFloat(bcs.marginBottom) || 0) - bandEl.offsetHeight;
    const bandRect = bandEl.getBoundingClientRect();

    // PASS 2 — compute each anchor's PAGE-frame position and rebase it onto
    // its actual containing block (now-final flow geometry).
    boxes.forEach((el, i) => {
      const a = anchors[band][i];
      if (!a) return;

      // Horizontal (PAGE coords): 'page' measures from the page edge,
      // everything else ('margin'/'column'/…) approximates the content box.
      const relLeft = a.h.rel === 'page' ? 0 : padL;
      const relWidth = a.h.rel === 'page' ? pageW : pageW - padL - padR;
      let left;
      if (a.h.offset != null) left = relLeft + a.h.offset;
      else if (a.h.align === 'center') left = relLeft + (relWidth - (a.cx || 0)) / 2;
      else if (a.h.align === 'right' || a.h.align === 'outside') left = relLeft + relWidth - (a.cx || 0);
      else left = relLeft;

      // Vertical (PAGE coords): 'page'/'margin' are page-frame refs;
      // 'paragraph'/'line' fall back to the band's own top.
      let top;
      if (a.v.rel === 'paragraph' || a.v.rel === 'line') {
        top = bandTopFinal + (a.v.offset || 0);
      } else {
        const relTop = a.v.rel === 'page' ? 0 : padT;
        const relHeight = a.v.rel === 'page' ? pageH : pageH - padT - padB;
        if (a.v.offset != null) top = relTop + a.v.offset;
        else if (a.v.align === 'center') top = relTop + (relHeight - (a.cy || 0)) / 2;
        else if (a.v.align === 'bottom') top = relTop + relHeight - (a.cy || 0);
        else top = relTop;
      }

      // Rebase PAGE coords onto the actual containing block: the nearest
      // positioned ancestor — the band itself, or a paragraph that
      // applyTemplateTabStops made position:relative. Its offset within the
      // band is stable across cloning; the band's final page top is computed
      // above, so the anchor lands exactly on every cloned page.
      const cb = el.offsetParent || bandEl;
      const cbRect = cb.getBoundingClientRect();
      el.style.left = `${left - (cbRect.left - secRect.left)}px`;
      el.style.top = `${top - (bandTopFinal + (cbRect.top - bandRect.top))}px`;
    });
  });
}

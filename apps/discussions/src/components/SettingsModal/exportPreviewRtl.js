const DOCX_BODY_BLOCKS = [
  'section.docx > article p',
  'section.docx > article li',
  'section.docx > article h1',
  'section.docx > article h2',
  'section.docx > article h3',
  'section.docx > article h4',
  'section.docx > article h5',
  'section.docx > article h6',
].join(', ');

const RTL_TEXT = /[\u0590-\u08ff]/u;
const PRESERVED_ALIGNMENTS = new Set(['center', 'justify']);

/**
 * Normalize Hebrew/Arabic blocks in docx-preview's rendered document body.
 *
 * Word honours w:bidi in the generated file, while docx-preview can leave a
 * physical `left`/logical `start` alignment on the corresponding DOM node.
 * Force the browser-only preview to the same physical right edge, with
 * `important` inline declarations so neither the LTR scroll frame nor
 * docx-preview's stylesheet can win later. Header/footer bands are deliberately
 * outside the selector, and intentional center/justify alignment is preserved.
 */
export function normalizeRenderedDocxRtl(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  root.querySelectorAll(DOCX_BODY_BLOCKS).forEach((element) => {
    if (!RTL_TEXT.test(element.textContent || '')) return;

    const alignment = String(element.style.textAlign || '').trim().toLowerCase();
    // CSSStyleDeclaration may keep the old priority when the value is already
    // identical. Clear first so the mounted preview always receives !important.
    element.style.removeProperty('direction');
    element.style.setProperty('direction', 'rtl', 'important');
    if (!PRESERVED_ALIGNMENTS.has(alignment)) {
      element.style.removeProperty('text-align');
      element.style.setProperty('text-align', 'right', 'important');
    }
  });
}

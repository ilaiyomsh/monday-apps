import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * round376 — the create-discussion card is anchored to the TOP so it opens higher
 * and grows only downward (owner spec, mockup approved).
 *
 * These assertions are on the STYLESHEET, not on a render: jsdom applies no
 * layout, so a mounted card reports zero height and cannot tell centered from
 * top-anchored. The rules below are the ones whose removal reintroduces a
 * reported bug, so they are worth pinning even without layout.
 */

const CSS = readFileSync(
  join(process.cwd(), 'src/components/CreateDiscussionModal/CreateDiscussionModal.module.css'),
  'utf-8'
);

// The desktop `.overlay` block (everything before the first media query).
const DESKTOP = CSS.slice(0, CSS.indexOf('@media'));
const overlayBlock = DESKTOP.slice(DESKTOP.indexOf('.overlay {'), DESKTOP.indexOf('}', DESKTOP.indexOf('.overlay {')) + 1);

describe('the card opens top-anchored, not centered', () => {
  it('anchors the top edge instead of centering vertically', () => {
    // `align-items: center` is the single line that caused BOTH symptoms: the card
    // landing too low, and growing up as well as down when a type was picked.
    expect(overlayBlock).toContain('align-items: flex-start');
    expect(overlayBlock).not.toContain('align-items: center');
  });

  it('offsets the card from the very top so it is not flush against the edge', () => {
    expect(overlayBlock).toMatch(/padding-top:\s*clamp\(/);
  });
});

describe('a tall card scrolls the OVERLAY, never the card body', () => {
  /*
   * The in-card pickers (`.dropdownMenu` and the people/date popovers) are
   * `position: absolute` descendants of the card. A scroll container on the card
   * body or the modal clips them — the discussion-type menu would be cut off the
   * moment the card grew tall, which is precisely the state this round creates.
   */
  it('puts the scroll on .overlay', () => {
    expect(overlayBlock).toContain('overflow-y: auto');
  });

  it('leaves .content overflow VISIBLE so the type picker is never clipped', () => {
    const content = DESKTOP.slice(DESKTOP.indexOf('.content {'));
    const block = content.slice(0, content.indexOf('}') + 1);
    expect(block).toContain('overflow: visible');
    expect(block).not.toContain('overflow-y: auto');
    expect(block).not.toContain('overflow: hidden');
  });

  it('keeps the type menu self-limiting, so it never needs the card to scroll', () => {
    const menu = CSS.slice(CSS.indexOf('.dropdownMenu {'));
    const block = menu.slice(0, menu.indexOf('}') + 1);
    expect(block).toContain('position: absolute');
    expect(block).toMatch(/max-height:\s*\d+px/);
    expect(block).toContain('overflow-y: auto');
  });
});

describe('mobile keeps its bottom-sheet treatment', () => {
  /*
   * On a phone the card is deliberately a sheet rising from the bottom edge. The
   * top-anchor change is desktop-only; the media query must keep overriding it,
   * and its `padding` shorthand is what resets the desktop offsets.
   */
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 768px)'));
  const mobileBlock = MOBILE.slice(0, MOBILE.indexOf('\n}\n\n') + 3);

  it('still pins the sheet to the bottom', () => {
    expect(mobileBlock).toContain('align-items: flex-end');
  });

  it('resets the desktop top offset via the padding shorthand', () => {
    expect(mobileBlock).toMatch(/padding:\s*8px/);
  });

  it('caps the sheet height so it cannot exceed the viewport', () => {
    expect(mobileBlock).toMatch(/max-height:\s*calc\(100vh/);
  });
});

// Characterization + RTL-behavior tests for computeFloatingPosition.
//
// The 'start'/'end' inline edges are direction-aware: in RTL the inline-start
// edge is the anchor's RIGHT edge, so a popup wider than its anchor grows toward
// the visual start (left) instead of overflowing past the physical right. These
// tests pin that resolution against both an explicit `rtl` flag and the document
// direction fallback. Pure function — no fixtures / SDK involved.

import { describe, it, expect, afterEach } from 'vitest';
import { computeFloatingPosition } from './overlayPlacement.js';

// jsdom viewport defaults: 1024 x 768. An anchor on the RIGHT half so the LTR vs
// RTL inline-start math lands on different, UN-clamped left coordinates.
const rightAnchor = { left: 700, right: 750, width: 50, top: 100, bottom: 120, height: 20 };

afterEach(() => {
  document.documentElement.removeAttribute('dir');
});

describe('computeFloatingPosition — guards', () => {
  it('returns null when no anchorRect is given', () => {
    expect(computeFloatingPosition({ anchorRect: null })).toBeNull();
  });
});

describe('computeFloatingPosition — LTR horizontal edges', () => {
  it('anchors bottom-start to the anchor left edge in LTR', () => {
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-start',
      popupWidth: 300,
      popupHeight: 100,
      rtl: false,
    });
    // rawLeft = anchorRect.left = 700; not clamped (max 1024-8-300=716).
    expect(pos.left).toBe(700);
    expect(pos.placement).toBe('bottom-start');
  });

  it('anchors bottom-end to the anchor right edge minus width in LTR', () => {
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-end',
      popupWidth: 300,
      popupHeight: 100,
      rtl: false,
    });
    // rawLeft = anchorRect.right - width = 750 - 300 = 450.
    expect(pos.left).toBe(450);
  });
});

describe('computeFloatingPosition — RTL horizontal edges', () => {
  it('anchors bottom-start to the anchor RIGHT edge minus width in RTL (grows toward visual start)', () => {
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-start',
      popupWidth: 300,
      popupHeight: 100,
      rtl: true,
    });
    // RTL inline-start = anchor.right; rawLeft = 750 - 300 = 450 (differs from LTR's 700).
    expect(pos.left).toBe(450);
  });

  it('anchors bottom-end to the anchor LEFT edge in RTL', () => {
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-end',
      popupWidth: 300,
      popupHeight: 100,
      rtl: true,
    });
    // RTL inline-end = anchor.left = 700 (differs from LTR end's 450).
    expect(pos.left).toBe(700);
  });

  it('falls back to the document direction (dir="rtl") when no rtl flag is passed', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-start',
      popupWidth: 300,
      popupHeight: 100,
    });
    // Document is RTL -> start resolves to the right edge: 750 - 300 = 450.
    expect(pos.left).toBe(450);
  });

  it('treats a missing/ltr document direction as LTR when no rtl flag is passed', () => {
    // No dir attribute -> not RTL -> start = anchor.left = 700.
    const pos = computeFloatingPosition({
      anchorRect: rightAnchor,
      preferred: 'bottom-start',
      popupWidth: 300,
      popupHeight: 100,
    });
    expect(pos.left).toBe(700);
  });
});

describe('computeFloatingPosition — center + vertical flip (direction-independent)', () => {
  it('centers horizontally regardless of direction', () => {
    const ltr = computeFloatingPosition({
      anchorRect: rightAnchor, preferred: 'bottom-center', popupWidth: 300, popupHeight: 100, rtl: false,
    });
    const rtl = computeFloatingPosition({
      anchorRect: rightAnchor, preferred: 'bottom-center', popupWidth: 300, popupHeight: 100, rtl: true,
    });
    // rawLeft = left + (width - popupWidth)/2 = 700 + (50-300)/2 = 575, clamped to 8..716 -> 575.
    expect(ltr.left).toBe(575);
    expect(rtl.left).toBe(575);
  });

  it('flips a bottom preference to top when there is not enough room below', () => {
    // Anchor near the viewport bottom (768): little room below, lots above.
    const lowAnchor = { left: 100, right: 150, width: 50, top: 700, bottom: 720, height: 20 };
    const pos = computeFloatingPosition({
      anchorRect: lowAnchor,
      preferred: 'bottom-start',
      popupWidth: 200,
      popupHeight: 300,
      rtl: false,
    });
    expect(pos.vertical).toBe('top');
    // top edge = anchor.top - height - offset = 700 - 300 - 6 = 394.
    expect(pos.top).toBe(394);
  });
});

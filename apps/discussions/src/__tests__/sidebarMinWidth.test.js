/*
 * round324 — the list sidebar's minimum width must actually FIT its toolbar.
 *
 * The icon row's non-shrinkable content is fixed by CSS and adds up:
 *   .actions   4 controls × 36px + 3 gaps × 6px = 162px
 *   .personalBtn  avatar 30 + gap 4 + chevron 18 + padding 8 = 60px
 *   .bar       2 gaps × 10px = 20px
 *                                          ----------------------- 242px
 * plus .headerInner's insets: 14px on the left and, since round322, 42px on the
 * right — 52px in a browser that reserves the scrollbar gutter. So the narrowest
 * width at which nothing overflows is 242 + 52 + 14 = 308px.
 *
 * At the old 240px minimum the row overflowed by 30px BEFORE round322 already;
 * round322 widened that to 68px. These tests pin the minimum to a value derived
 * from the geometry rather than from taste, so shrinking it again fails here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SIDEBAR_MIN_W, TOOLBAR_MIN_CONTENT_W, readSavedWidth } from '../App.jsx';

const KEY = 'discussions_sidebar_width';

describe('round324 — the list minimum width fits the toolbar', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('is at least the toolbar content plus both header insets', () => {
    // 52px is the widest right inset (the reserved scrollbar gutter), 14px the left.
    expect(SIDEBAR_MIN_W).toBeGreaterThanOrEqual(TOOLBAR_MIN_CONTENT_W + 52 + 14);
  });

  it('states the toolbar content width the CSS actually produces', () => {
    // 4×36 + 3×6 (.actions) + 60 (.personalBtn) + 2×10 (.bar gaps)
    expect(TOOLBAR_MIN_CONTENT_W).toBe(4 * 36 + 3 * 6 + 60 + 2 * 10);
  });

  it('raises a saved width from below the minimum up to it', () => {
    // A width stored under the OLD 240px floor must not come back as 240.
    window.localStorage.setItem(KEY, '240');
    expect(readSavedWidth(KEY, 720)).toBe(SIDEBAR_MIN_W);
  });

  it('keeps a saved width that already clears the minimum', () => {
    window.localStorage.setItem(KEY, '500');
    expect(readSavedWidth(KEY, 720)).toBe(500);
  });

  it('still clamps a saved width down to the maximum', () => {
    window.localStorage.setItem(KEY, '9999');
    expect(readSavedWidth(KEY, 720)).toBe(720);
  });

  it('honours an explicit minW argument over the list default (calendar mode)', () => {
    window.localStorage.setItem(KEY, '300');
    expect(readSavedWidth(KEY, 720, 480)).toBe(480);
  });

  it('returns null when nothing is stored, so the caller picks its own default', () => {
    expect(readSavedWidth(KEY, 720)).toBeNull();
  });

  it('returns null for a stored value that is not a number', () => {
    window.localStorage.setItem(KEY, 'not-a-width');
    expect(readSavedWidth(KEY, 720)).toBeNull();
  });
});

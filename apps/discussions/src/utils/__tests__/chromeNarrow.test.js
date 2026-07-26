import { describe, it, expect } from 'vitest';
import { isChromeNarrow, installChromeNarrowWatcher } from '../chromeNarrow.js';

function fakeBody() {
  let attr = null;
  return {
    setAttribute: (_k, v) => { attr = v; },
    removeAttribute: () => { attr = null; },
    get narrow() { return attr === '1'; },
  };
}

describe('isChromeNarrow — round103 panel-open width heuristic', () => {
  it('is TRUE when the current width dropped below the ratio of the widest seen', () => {
    // panel roughly halves the width: 500 < 1200 * 0.8 (960)
    expect(isChromeNarrow(500, 1200)).toBe(true);
    // pins the DEFAULT ratio at 0.8: 700 < 1000*0.8 (800) → true, but would be
    // FALSE at a 0.5 default (700 !< 500).
    expect(isChromeNarrow(700, 1000)).toBe(true);
  });

  it('is FALSE when the current width is at/above the ratio (mild or no shrink)', () => {
    expect(isChromeNarrow(1000, 1200)).toBe(false); // 1000 >= 960
    expect(isChromeNarrow(1200, 1200)).toBe(false); // full width
  });

  it('is FALSE with no valid max or non-positive current width (pre-measure guard)', () => {
    expect(isChromeNarrow(500, 0)).toBe(false);
    expect(isChromeNarrow(0, 1200)).toBe(false);
  });

  it('honors a custom ratio', () => {
    // 700 vs 1000: not narrow at 0.8 (>=800) but narrow at 0.5 threshold? 700 !< 500 → false;
    // narrow at 0.75 (750): 700 < 750 → true.
    expect(isChromeNarrow(700, 1000, 0.5)).toBe(false);
    expect(isChromeNarrow(700, 1000, 0.75)).toBe(true);
  });
});

describe('installChromeNarrowWatcher — round227 recovery from an inflated baseline', () => {
  it('KEEPS a DEEP narrow (a real panel) hidden across repeated checks', () => {
    let width = 1200;
    const body = fakeBody();
    const cleanup = installChromeNarrowWatcher({ body, getWidth: () => width, poll: false });
    expect(body.narrow).toBe(false); // boot at full width
    // Panel opens → width roughly halves (deep narrow).
    width = 600;
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(true);
    // Still open, another check at the same deep width → STAYS hidden (a deep
    // narrow is a genuine panel and must never re-baseline).
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(true);
    cleanup();
  });

  it('RECOVERS from a stale-inflated baseline: a stable SHALLOW narrow re-baselines and reappears', () => {
    let width = 1000;
    const body = fakeBody();
    const cleanup = installChromeNarrowWatcher({ body, getWidth: () => width, poll: false });
    expect(body.narrow).toBe(false);
    // A transient WIDE spike inflates the monotonic baseline to 1400.
    width = 1400;
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(false);
    // Back to the TRUE full width (1000). Against the inflated 1400 baseline this
    // is "narrow" (1000 < 1400*0.8=1120) but only SHALLOWLY (1000 >= 1400*0.6=840).
    width = 1000;
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(true); // first sighting hides
    // The shallow narrow holds steady → adopt 1000 as the new baseline and clear.
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(false);
    // And it STAYS cleared (baseline is now 1000, so 1000 is full again).
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(false);
    cleanup();
  });

  it('cleanup removes the attribute and stops reacting to resizes', () => {
    let width = 1200;
    const body = fakeBody();
    const cleanup = installChromeNarrowWatcher({ body, getWidth: () => width, poll: false });
    width = 500;
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(true);
    cleanup();
    expect(body.narrow).toBe(false);
    width = 400;
    window.dispatchEvent(new Event('resize'));
    expect(body.narrow).toBe(false); // listener removed → no change
  });
});

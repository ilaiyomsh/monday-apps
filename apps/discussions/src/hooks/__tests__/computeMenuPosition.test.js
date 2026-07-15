import { describe, it, expect } from 'vitest';
import { computeMenuPosition } from '../useGroupColors.jsx';

// Round-80: the color palette opens just BELOW the cursor (not on it) so it no
// longer covers the group-header text, clamped inside the viewport.
describe('computeMenuPosition', () => {
  it('opens below the click point by the cursor gap', () => {
    const { x, y } = computeMenuPosition(100, 200, 1200, 800);
    expect(x).toBe(100);
    expect(y).toBe(214); // 200 + 14px gap → clears the header text
  });

  it('clamps to the right edge so the palette never leaves the viewport', () => {
    const { x } = computeMenuPosition(1190, 200, 1200, 800); // 208px wide palette
    expect(x).toBe(1200 - 208 - 8); // 984
  });

  it('clamps to the bottom edge (gap included)', () => {
    const { y } = computeMenuPosition(100, 790, 1200, 800); // 132px tall palette
    expect(y).toBe(800 - 132 - 8); // 660
  });

  it('never goes above/left of the 8px margin', () => {
    expect(computeMenuPosition(0, 0, 1200, 800)).toEqual({ x: 8, y: 14 });
  });

  it('falls back to a sane spot when coords are missing', () => {
    const { x, y } = computeMenuPosition(undefined, undefined, 1200, 800);
    expect(x).toBe(40);
    expect(y).toBe(54); // 40 + 14
  });
});

import { describe, it, expect } from 'vitest';
import { isInRightFraction, RIGHT_REVEAL_FRACTION } from '../scrollReveal';

describe('isInRightFraction', () => {
  it('is true inside the rightmost third of the viewport', () => {
    // viewport 900 → threshold at 600; 800 is well inside the right third.
    expect(isInRightFraction(800, 900)).toBe(true);
  });

  it('is false in the left two-thirds', () => {
    // 450 (the middle) is left of the 600 threshold → not revealed.
    // Kills a (1 - fraction) → fraction mutation (that would threshold at 300).
    expect(isInRightFraction(450, 900)).toBe(false);
  });

  it('includes the exact threshold (>=, not >)', () => {
    // Use fraction 1/2 so the threshold (1000 * 0.5 = 500) is FP-exact.
    expect(isInRightFraction(500, 1000, 1 / 2)).toBe(true);
    expect(isInRightFraction(499, 1000, 1 / 2)).toBe(false);
  });

  it('returns false for a non-positive viewport width', () => {
    // Kills a mutation that drops the width guard (clientX >= 0 would be true).
    expect(isInRightFraction(0, 0)).toBe(false);
    expect(isInRightFraction(50, 0)).toBe(false);
  });

  it('honours a custom fraction', () => {
    // fraction 1/2 → threshold at 500; 550 is inside, 400 is not.
    expect(isInRightFraction(550, 1000, 1 / 2)).toBe(true);
    expect(isInRightFraction(400, 1000, 1 / 2)).toBe(false);
  });

  it('defaults to the right third', () => {
    expect(RIGHT_REVEAL_FRACTION).toBeCloseTo(1 / 3);
  });
});

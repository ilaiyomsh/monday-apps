import { describe, expect, it } from 'vitest';
import { settingsModalSize } from './settingsModalSize.js';

describe('settingsModalSize', () => {
  it('uses at least 80% of the viewport on large screens (no 744px cap)', () => {
    expect(settingsModalSize({ innerWidth: 2000, innerHeight: 1600 })).toEqual({
      width: '1600px',
      height: '1280px',
    });
    expect(settingsModalSize({ innerWidth: 1440, innerHeight: 900 })).toEqual({
      width: '1152px',
      height: '720px',
    });
  });

  it('enforces a minimum size when 80% would be smaller but the viewport still fits it', () => {
    // 80% of 800×650 = 640×520 → floor lifts to 720×560
    expect(settingsModalSize({ innerWidth: 800, innerHeight: 650 })).toEqual({
      width: '720px',
      height: '560px',
    });
  });

  it('never exceeds ~94% of a tiny viewport even when the minimum wants more', () => {
    expect(settingsModalSize({ innerWidth: 500, innerHeight: 400 })).toEqual({
      width: '470px',
      height: '376px',
    });
  });

  it('falls back to large desktop defaults when viewport metrics are missing', () => {
    expect(settingsModalSize(null)).toEqual({
      width: '1152px',
      height: '720px',
    });
    expect(settingsModalSize({ innerWidth: 0, innerHeight: -1 })).toEqual({
      width: '1152px',
      height: '720px',
    });
  });
});

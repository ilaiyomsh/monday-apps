import { describe, expect, it } from 'vitest';
import { pickerModalSize, settingsModalSize } from './settingsModalSize.js';

describe('settingsModalSize', () => {
  it('mirrors discussions square: min(744px, 94vw/vh) with a 320px floor', () => {
    expect(settingsModalSize({ innerWidth: 2000, innerHeight: 1600 })).toEqual({
      width: '744px',
      height: '744px',
    });
    expect(settingsModalSize({ innerWidth: 500, innerHeight: 400 })).toEqual({
      width: '470px',
      height: '376px',
    });
  });

  it('falls back to desktop defaults when viewport metrics are missing', () => {
    expect(settingsModalSize(null)).toEqual({
      width: '744px',
      height: '744px',
    });
    expect(settingsModalSize({ innerWidth: 0, innerHeight: -1 })).toEqual({
      width: '744px',
      height: '744px',
    });
  });
});

describe('pickerModalSize', () => {
  it('keeps a compact status-menu footprint that still scales with the viewport', () => {
    expect(pickerModalSize({ innerWidth: 2000, innerHeight: 1200 })).toEqual({
      width: '280px',
      height: '420px',
    });
    expect(pickerModalSize({ innerWidth: 600, innerHeight: 400 })).toEqual({
      width: '200px',
      height: '240px',
    });
  });

  it('falls back to desktop defaults when viewport metrics are missing', () => {
    expect(pickerModalSize(null)).toEqual({
      width: '280px',
      height: '420px',
    });
  });
});

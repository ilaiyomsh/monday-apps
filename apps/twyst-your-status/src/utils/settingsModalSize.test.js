import { describe, expect, it } from 'vitest';
import { settingsModalSize } from './settingsModalSize.js';

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

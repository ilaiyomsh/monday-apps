import { describe, expect, it } from 'vitest';
import { settingsModalSize } from './settingsModalSize.js';

describe('settingsModalSize', () => {
  it('sizes to ≥80% of a real (large) viewport, floored at 1100×820', () => {
    expect(settingsModalSize({ innerWidth: 1920, innerHeight: 1080 })).toEqual({
      width: '1536px',
      height: '864px',
    });
    expect(settingsModalSize({ innerWidth: 1440, innerHeight: 900 })).toEqual({
      width: '1152px',
      height: '820px',
    });
  });

  it('ignores the tiny column-settings iframe viewport and falls back to 1100×820', () => {
    // SettingsLauncher used to pass `window` from the slim shell (~400px),
    // which made "80% of viewport" still look like a postcard.
    expect(settingsModalSize({ innerWidth: 420, innerHeight: 360 })).toEqual({
      width: '1100px',
      height: '820px',
    });
    expect(settingsModalSize({ innerWidth: 744, innerHeight: 744 })).toEqual({
      width: '1100px',
      height: '820px',
    });
  });

  it('returns the known-good fixed size when no useful metrics exist', () => {
    expect(settingsModalSize(null)).toEqual({
      width: '1100px',
      height: '820px',
    });
    expect(settingsModalSize({ innerWidth: 0, innerHeight: -1 })).toEqual({
      width: '1100px',
      height: '820px',
    });
  });
});

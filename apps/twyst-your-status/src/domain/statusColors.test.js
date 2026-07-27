import { describe, expect, it } from 'vitest';
import {
  MONDAY_STATUS_COLORS,
  normalizeStatusColorEnum,
  resolveStatusColorHex,
} from './statusColors.js';

describe('normalizeStatusColorEnum', () => {
  it('maps numeric monday color indexes to StatusColumnColors enum names', () => {
    expect(normalizeStatusColorEnum(0)).toBe('working_orange');
    expect(normalizeStatusColorEnum(1)).toBe('done_green');
    expect(normalizeStatusColorEnum(2)).toBe('stuck_red');
    expect(normalizeStatusColorEnum('160')).toBe('teal');
  });

  it('accepts enum names and matching hex strings', () => {
    expect(normalizeStatusColorEnum('done_green')).toBe('done_green');
    expect(normalizeStatusColorEnum('#00c875')).toBe('done_green');
  });

  it('rejects unsupported color values', () => {
    expect(() => normalizeStatusColorEnum(999)).toThrow(/Unsupported status color numeric ID/);
    expect(() => normalizeStatusColorEnum('not-a-color')).toThrow(/Unsupported status color enum/);
    expect(() => normalizeStatusColorEnum(null)).toThrow(/Missing status color value/);
  });
});

describe('resolveStatusColorHex', () => {
  it('resolves hex from numeric index and enum name', () => {
    expect(resolveStatusColorHex(0)).toBe('#fdab3d');
    expect(resolveStatusColorHex('stuck_red')).toBe('#e2445c');
  });

  it('returns undefined for unknown values', () => {
    expect(resolveStatusColorHex(999)).toBeUndefined();
    expect(resolveStatusColorHex('nope')).toBeUndefined();
  });
});

describe('MONDAY_STATUS_COLORS', () => {
  it('includes the canonical done_green entry used by the settings picker', () => {
    expect(MONDAY_STATUS_COLORS.find((c) => c.enum === 'done_green')).toEqual({
      id: 1,
      enum: 'done_green',
      hex: '#00c875',
    });
  });
});

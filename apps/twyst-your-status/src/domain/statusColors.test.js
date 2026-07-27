import { describe, expect, it } from 'vitest';
import {
  MONDAY_STATUS_COLORS,
  ensureUniqueStatusColors,
  normalizeStatusColorEnum,
  pickUnusedStatusColor,
  resolveStatusColorHex,
  tryNormalizeStatusColorEnum,
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

describe('tryNormalizeStatusColorEnum', () => {
  it('returns null for unknown values instead of throwing', () => {
    expect(tryNormalizeStatusColorEnum(999)).toBeNull();
    expect(tryNormalizeStatusColorEnum('not-a-color')).toBeNull();
    expect(tryNormalizeStatusColorEnum(null)).toBeNull();
  });
});

describe('pickUnusedStatusColor', () => {
  it('returns the first monday enum not present in the used set', () => {
    expect(pickUnusedStatusColor(['working_orange', 'done_green'])).toBe('stuck_red');
    expect(pickUnusedStatusColor([])).toBe('working_orange');
  });

  it('throws when every monday status color is already used', () => {
    const all = MONDAY_STATUS_COLORS.map((entry) => entry.enum);
    expect(() => pickUnusedStatusColor(all)).toThrow(/No unused monday status colors remain/);
  });
});

describe('ensureUniqueStatusColors', () => {
  it('keeps the first active color and reassigns collisions, preferring active over deactivated', () => {
    expect(ensureUniqueStatusColors([
      { id: 0, color: 'done_green', isDeactivated: false },
      { id: 1, color: 'done_green', isDeactivated: false },
      { id: 2, color: 'done_green', isDeactivated: true },
    ])).toEqual([
      { id: 0, color: 'done_green', isDeactivated: false },
      { id: 1, color: 'working_orange', isDeactivated: false },
      { id: 2, color: 'stuck_red', isDeactivated: true },
    ]);
  });

  it('assigns a free enum when a label color cannot be normalized', () => {
    expect(ensureUniqueStatusColors([
      { id: 0, color: 'stuck_red', isDeactivated: false },
      { id: 1, color: 'not-a-color', isDeactivated: false },
    ])).toEqual([
      { id: 0, color: 'stuck_red', isDeactivated: false },
      { id: 1, color: 'working_orange', isDeactivated: false },
    ]);
  });
});

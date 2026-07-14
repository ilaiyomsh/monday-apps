import { describe, it, expect } from 'vitest';
import { ensureGroupColors } from '../grouping.js';

// Round-77: ensureGroupColors accepts a { [groupKey]: hex } overrides map (the
// user's right-click header colors, shared across users). An override WINS over
// everything — even a group's own semantic color — while groups without an
// override keep their semantic/auto color.
describe('ensureGroupColors — round77 per-header color overrides', () => {
  it('applies the override color to the matching group key', () => {
    const groups = [
      { key: 'g1', label: 'קבוצה א', color: null, items: [] },
      { key: 'g2', label: 'קבוצה ב', color: null, items: [] },
    ];
    const out = ensureGroupColors(groups, { g1: '#123456' });
    expect(out.find((g) => g.key === 'g1').color).toBe('#123456');
    // g2 has no override → gets an auto palette color (not the override).
    expect(out.find((g) => g.key === 'g2').color).toBeTruthy();
    expect(out.find((g) => g.key === 'g2').color).not.toBe('#123456');
  });

  it('an override WINS over a group that already carries a semantic color', () => {
    const groups = [{ key: 's1', label: 'בתוקף', color: '#00c875', items: [] }];
    const out = ensureGroupColors(groups, { s1: '#ff0000' });
    expect(out[0].color).toBe('#ff0000');
  });

  it('no overrides (or empty map) leaves the auto/semantic behavior unchanged', () => {
    const groups = [{ key: 's1', label: 'בתוקף', color: '#00c875', items: [] }];
    expect(ensureGroupColors(groups, {})[0].color).toBe('#00c875');
    expect(ensureGroupColors(groups)[0].color).toBe('#00c875');
  });

  it('override keys are matched as strings (numeric group key still resolves)', () => {
    const groups = [{ key: 42, label: 'דיון', color: null, items: [] }];
    const out = ensureGroupColors(groups, { 42: '#abcdef' });
    expect(out[0].color).toBe('#abcdef');
  });
});

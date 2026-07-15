import { describe, it, expect } from 'vitest';
import { collapseMapForView } from '../collapsePref.js';

const groups = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

describe('collapseMapForView — round105 saved collapse-all default', () => {
  it('returns a map collapsing EVERY group when the view saved collapseAll:true', () => {
    expect(collapseMapForView({ collapseAll: true }, groups)).toEqual({ a: true, b: true, c: true });
  });

  it('returns null when the saved view does NOT opt into collapseAll', () => {
    expect(collapseMapForView({ collapseAll: false }, groups)).toBeNull();
    expect(collapseMapForView({}, groups)).toBeNull();
    expect(collapseMapForView(null, groups)).toBeNull();
  });

  it('treats only a strict true as opt-in (a truthy non-true value does not collapse)', () => {
    expect(collapseMapForView({ collapseAll: 1 }, groups)).toBeNull();
    expect(collapseMapForView({ collapseAll: 'yes' }, groups)).toBeNull();
  });

  it('returns null when there are no groups to collapse', () => {
    expect(collapseMapForView({ collapseAll: true }, [])).toBeNull();
    expect(collapseMapForView({ collapseAll: true }, null)).toBeNull();
  });
});

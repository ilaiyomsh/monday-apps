import { describe, it, expect } from 'vitest';
import { collectedEquals } from '../collectedEquals.js';

/*
 * round370 §2 — the second layer under the relation-column freeze. The per-column
 * collectors' setter must treat a REBUILT-but-identical view object as "no change",
 * so an unmemoized hook can no longer drive an infinite render loop through the
 * table's state. Shallow by design: the payload arrays belong to the hook's state,
 * so their identity IS the signal that the data changed.
 */
describe('round370 — collectedEquals', () => {
  it('treats a rebuilt-but-identical view as equal (this is what stops the loop)', () => {
    const items = [{ id: '1', name: 'א' }];
    const a = { items, allowMultiple: true, boardId: '9', loading: false };
    const b = { items, allowMultiple: true, boardId: '9', loading: false };
    expect(a).not.toBe(b); // different objects…
    expect(collectedEquals(a, b)).toBe(true); // …but the same view
  });

  it('is still equal for the identical reference', () => {
    const a = { items: [], loading: true };
    expect(collectedEquals(a, a)).toBe(true);
  });

  it('reports a CHANGED payload as different (a new items array must propagate)', () => {
    const a = { items: [{ id: '1' }], allowMultiple: true, boardId: '9', loading: false };
    const b = { items: [{ id: '1' }], allowMultiple: true, boardId: '9', loading: false };
    // a fresh array means the hook loaded new data — it must reach the cells
    expect(collectedEquals(a, b)).toBe(false);
  });

  it('reports a changed scalar field as different', () => {
    const items = [];
    expect(collectedEquals(
      { items, allowMultiple: true, boardId: '9', loading: true },
      { items, allowMultiple: true, boardId: '9', loading: false }
    )).toBe(false);
    expect(collectedEquals(
      { items, allowMultiple: true, boardId: '9', loading: false },
      { items, allowMultiple: false, boardId: '9', loading: false }
    )).toBe(false);
  });

  it('differing key sets are not equal (a missing field is a real difference)', () => {
    expect(collectedEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(collectedEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    // same COUNT, different names — the every() must check membership, not order
    expect(collectedEquals({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it('non-objects and nullish degrade to a plain identity check', () => {
    expect(collectedEquals(null, null)).toBe(true);
    expect(collectedEquals(null, {})).toBe(false);
    expect(collectedEquals(undefined, {})).toBe(false);
    expect(collectedEquals(5, 5)).toBe(true);
    expect(collectedEquals('a', 'b')).toBe(false);
  });

  it('an object and an array are never equal', () => {
    expect(collectedEquals({ 0: 'x' }, ['x'])).toBe(false);
  });
});

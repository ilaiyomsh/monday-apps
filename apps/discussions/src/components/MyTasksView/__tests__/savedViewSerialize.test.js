import { describe, it, expect } from 'vitest';
import { serializeFilter, deserializeFilter, emptyFilter, filterCount } from '../controls/controls.js';

describe('serializeFilter / deserializeFilter', () => {
  it('round-trips a populated filter (Sets -> arrays -> Sets, Date -> ISO -> Date)', () => {
    const filter = {
      status: { op: 'isnot', values: new Set(['1', '5']) },
      priority: { op: 'is', values: new Set(['2']) },
      person: { op: 'is', values: new Set() },
      deadline: { op: 'before', range: null, date: new Date(2026, 0, 15) },
    };
    const json = JSON.parse(JSON.stringify(serializeFilter(filter))); // survives storage
    const back = deserializeFilter(json);
    expect(back.status.op).toBe('isnot');
    expect(back.status.values).toBeInstanceOf(Set);
    expect([...back.status.values].sort()).toEqual(['1', '5']);
    expect([...back.priority.values]).toEqual(['2']);
    expect(back.person.values.size).toBe(0);
    expect(back.deadline.op).toBe('before');
    expect(back.deadline.date).toBeInstanceOf(Date);
    expect(back.deadline.date.getTime()).toBe(new Date(2026, 0, 15).getTime());
    // the round-tripped filter is live: filterCount sees the same active values
    expect(filterCount(back)).toBe(filterCount(filter));
  });

  it('round-trips an empty filter and a "within range" deadline', () => {
    const empty = deserializeFilter(JSON.parse(JSON.stringify(serializeFilter(emptyFilter()))));
    expect(filterCount(empty)).toBe(0);
    expect(empty.deadline).toEqual({ op: 'within', range: null, date: null });

    const withRange = { ...emptyFilter(), deadline: { op: 'within', range: 'thisWeek', date: null } };
    const back = deserializeFilter(serializeFilter(withRange));
    expect(back.deadline).toEqual({ op: 'within', range: 'thisWeek', date: null });
  });

  it('deserializeFilter tolerates null/garbage by falling back to an empty filter shape', () => {
    for (const bad of [null, undefined, {}, { status: null, deadline: { op: 'within' } }]) {
      const f = deserializeFilter(bad);
      expect(f.status.values).toBeInstanceOf(Set);
      expect(f.priority.values).toBeInstanceOf(Set);
      expect(f.person.values).toBeInstanceOf(Set);
      expect(filterCount(f)).toBe(0);
    }
  });
});

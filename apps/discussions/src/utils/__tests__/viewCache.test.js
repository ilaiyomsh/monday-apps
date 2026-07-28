import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeViewCacheKey,
  readViewCache,
  writeViewCache,
  reconcileSeeded,
  VIEW_CACHE_VERSION,
  VIEW_CACHE_TTL_MS,
} from '../viewCache.js';

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

describe('makeViewCacheKey', () => {
  it('builds a stable key from view + user + board', () => {
    expect(makeViewCacheKey('myTasks', { userId: '42', boardId: 'B1' })).toBe('disc.viewcache.myTasks.42.B1');
  });
  it('includes the sub-tab segment when given (the two sub-tabs hold different lists)', () => {
    expect(makeViewCacheKey('myDecisions', { userId: '42', boardId: 'B1', subTab: 'decider' }))
      .toBe('disc.viewcache.myDecisions.decider.42.B1');
  });
  it('returns null when identity is incomplete (no key → no cache)', () => {
    expect(makeViewCacheKey('myTasks', { userId: null, boardId: 'B1' })).toBeNull();
    expect(makeViewCacheKey('myTasks', { userId: '42', boardId: '' })).toBeNull();
    expect(makeViewCacheKey('', { userId: '42', boardId: 'B1' })).toBeNull();
  });
});

describe('writeViewCache / readViewCache round-trip', () => {
  const key = 'disc.viewcache.myTasks.42.B1';
  it('reads back exactly what was written (items + cursor), fresh', () => {
    const items = [{ id: '1', name: 'a' }, { id: '2', name: 'b' }];
    expect(writeViewCache(key, items, 'CUR')).toBe(true);
    const hit = readViewCache(key);
    expect(hit).not.toBeNull();
    expect(hit.items).toEqual(items);
    expect(hit.cursor).toBe('CUR');
    expect(hit.stale).toBe(false);
  });
  it('returns null on a miss / null key, and refuses to write a null key or non-array', () => {
    expect(readViewCache('disc.viewcache.nope.1.1')).toBeNull();
    expect(readViewCache(null)).toBeNull();
    expect(writeViewCache(null, [])).toBe(false);
    expect(writeViewCache(key, 'not-an-array')).toBe(false);
  });
});

describe('version + TTL + hard-expiry', () => {
  const key = 'disc.viewcache.myTasks.42.B1';
  it('treats a schema-version mismatch as a miss', () => {
    window.localStorage.setItem(key, JSON.stringify({ version: VIEW_CACHE_VERSION + 99, ts: Date.now(), items: [{ id: '1' }], cursor: null }));
    expect(readViewCache(key)).toBeNull();
  });
  it('treats a non-array payload as a miss', () => {
    window.localStorage.setItem(key, JSON.stringify({ version: VIEW_CACHE_VERSION, ts: Date.now(), items: 'oops' }));
    expect(readViewCache(key)).toBeNull();
  });
  it('flags stale (past TTL) but STILL returns the seed for revalidation', () => {
    const now = 1_000_000_000_000;
    writeViewCache(key, [{ id: '1' }], null, { now: now - VIEW_CACHE_TTL_MS - 1 });
    const hit = readViewCache(key, { now });
    expect(hit).not.toBeNull();
    expect(hit.stale).toBe(true);
    expect(hit.items).toEqual([{ id: '1' }]);
  });
  it('drops (returns null + removes) an entry past the hard max age', () => {
    const now = 1_000_000_000_000;
    writeViewCache(key, [{ id: '1' }], null, { now: now - 2 * 24 * 60 * 60 * 1000 }); // 2 days old
    expect(readViewCache(key, { now })).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
  it('a corrupt entry is a miss, never a throw', () => {
    window.localStorage.setItem(key, '{not json');
    expect(readViewCache(key)).toBeNull();
  });
});

describe('reconcileSeeded — SWR reconcile of a cache seed against a fresh page', () => {
  const row = (id, over = {}) => ({ id: String(id), name: `n${id}`, statusID: 1, ...over });
  it('takes the fresh page as authoritative when nothing is dirty (remote add/edit/delete)', () => {
    const current = [row(1), row(2)];                    // seed
    const fresh = [row(1, { statusID: 9 }), row(3)];     // 2 deleted remotely, 3 added, 1 edited remotely
    const out = reconcileSeeded(current, fresh, new Set());
    expect(out.map((r) => r.id)).toEqual(['1', '3']);
    expect(out.find((r) => r.id === '1').statusID).toBe(9); // remote edit wins for an untouched row
  });
  it('protects a locally-edited row (dirty) from a stale fresh value', () => {
    const current = [row(1, { statusID: 5 })];           // local optimistic edit in flight
    const fresh = [row(1, { statusID: 1 })];             // server still has the old value
    const out = reconcileSeeded(current, fresh, new Set(['1']));
    expect(out.find((r) => r.id === '1').statusID).toBe(5); // local optimistic value preserved
  });
  it('keeps a locally-deleted (deferred) row deleted even if the fresh page still has it', () => {
    const current = [row(2)];                            // 1 was optimistically removed
    const fresh = [row(1), row(2)];                      // server delete still pending (deferred)
    const out = reconcileSeeded(current, fresh, new Set(['1']));
    expect(out.map((r) => r.id)).toEqual(['2']);         // 1 is NOT re-added
  });
  it('preserves an optimistic create (temp id) not yet on the server', () => {
    const current = [{ id: 'temp-9', name: 'new' }, row(1)];
    const fresh = [row(1)];
    const out = reconcileSeeded(current, fresh, new Set(['temp-9']));
    expect(out.map((r) => r.id).sort()).toEqual(['1', 'temp-9']);
  });
  it('is null/undefined-safe', () => {
    expect(reconcileSeeded(undefined, undefined)).toEqual([]);
    expect(reconcileSeeded(null, [row(1)])).toEqual([row(1)]);
  });
});

// REGRESSION (round 39): round 37 introduced this cache but its unit tests
// seeded PLAIN fake objects with no real Date instances, so the JSON Date-loss
// was never exercised. A fresh row from mapItem/parseValue holds the date
// columns (deadlineID / decisionDateID) as REAL Date objects (with a `hasTime`
// flag); a naive JSON round-trip turned them into strings, so a seeded row then
// threw "E.toLocaleDateString is not a function" the moment MyTasksRow /
// MyDecisionsRow (or DatePickerPopover / sort / group) touched them. These tests
// use REAL Dates and assert a seeded row is interchangeable with a fresh one.
describe('writeViewCache / readViewCache — Date fields survive the JSON round-trip (regression)', () => {
  const key = 'disc.viewcache.myTasks.42.B1';

  it('reconstructs a task deadlineID as a REAL Date (not a string) so date methods work', () => {
    const deadline = new Date(2026, 6, 10); // local midnight, date-only (as parseValue builds it)
    const items = [{ id: '1', name: 'a', deadlineID: deadline, created_at: '2026-07-01T09:00:00Z', statusID: 3 }];
    expect(writeViewCache(key, items, null)).toBe(true);
    const hit = readViewCache(key);
    const seeded = hit.items[0].deadlineID;
    expect(seeded).toBeInstanceOf(Date);
    expect(typeof seeded.toLocaleDateString).toBe('function');
    expect(() => seeded.toLocaleDateString('en-GB')).not.toThrow(); // the exact crashing call
    expect(seeded.getTime()).toBe(deadline.getTime());
    // created_at is a STRING in a fresh row — it must STAY a string, never a Date.
    expect(typeof hit.items[0].created_at).toBe('string');
    expect(hit.items[0].created_at).toBe('2026-07-01T09:00:00Z');
    expect(hit.items[0].statusID).toBe(3); // non-date scalars unchanged
  });

  it('reconstructs a decision decisionDateID as a REAL Date (covers MyDecisions too)', () => {
    const d = new Date(2026, 0, 5);
    writeViewCache(key, [{ id: '9', decisionDateID: d, decisionStatusID: 2 }], null);
    const seeded = readViewCache(key).items[0].decisionDateID;
    expect(seeded).toBeInstanceOf(Date);
    expect(seeded.getTime()).toBe(d.getTime());
  });

  it('preserves the hasTime flag exactly as parseValue set it (timed vs date-only)', () => {
    const timed = new Date('2026-07-10T13:30:00Z'); timed.hasTime = true;
    const dateOnly = new Date(2026, 6, 10); dateOnly.hasTime = false;
    writeViewCache(key, [{ id: '1', deadlineID: timed }, { id: '2', deadlineID: dateOnly }], null);
    const hit = readViewCache(key);
    expect(hit.items[0].deadlineID).toBeInstanceOf(Date);
    expect(hit.items[0].deadlineID.hasTime).toBe(true);
    expect(hit.items[0].deadlineID.getTime()).toBe(timed.getTime());
    expect(hit.items[1].deadlineID).toBeInstanceOf(Date);
    expect(hit.items[1].deadlineID.hasTime).toBe(false);
  });

  it('leaves a null date field null (no bogus Date minted)', () => {
    writeViewCache(key, [{ id: '1', deadlineID: null, name: 'x' }], null);
    const hit = readViewCache(key);
    expect(hit.items[0].deadlineID).toBeNull();
  });

  it('a seeded row SORTS / GROUPS / FORMATS identically to a fresh row (interchangeable)', () => {
    const d = new Date(2026, 2, 15, 9, 0);
    writeViewCache(key, [{ id: '1', deadlineID: d }], 'C');
    const seeded = readViewCache(key).items[0].deadlineID;
    // grouping.groupByDate + controls.sortTasks both gate on `instanceof Date` and call getTime()
    expect(seeded instanceof Date).toBe(true);
    expect(seeded.getTime()).toBe(d.getTime());
    // the row cells render this via toLocaleDateString — must equal the fresh output
    expect(seeded.toLocaleDateString('en-GB')).toBe(d.toLocaleDateString('en-GB'));
  });

  it('still round-trips PLAIN (Date-free) rows unchanged (back-compat)', () => {
    const items = [{ id: '1', name: 'a', statusID: 1 }, { id: '2', name: 'b', statusID: 2 }];
    writeViewCache(key, items, 'CUR');
    const hit = readViewCache(key);
    expect(hit.items).toEqual(items);
    expect(hit.cursor).toBe('CUR');
  });
});

/*
 * round305 (PR review) — the cached row SHAPE changed (My Tasks rows gained
 * partnersID + the two access columns), so entries written by the previous
 * deploy must be rejected: seeding a v1 row would render an EMPTY שותפים cell,
 * and an edit made from that state would replace the real partner list.
 */
describe('VIEW_CACHE_VERSION — old-shape entries are rejected', () => {
  it('is past 1, so pre-round305 entries can never seed', () => {
    expect(VIEW_CACHE_VERSION).toBeGreaterThan(1);
  });

  it('treats an entry written at version 1 as a MISS', () => {
    const key = makeViewCacheKey('myTasks', { userId: '7', boardId: 'b1' });
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      ts: Date.now(),
      items: [{ id: '1', name: 'משימה', responsibilityID: [] }], // no partnersID
      cursor: null,
    }));
    expect(readViewCache(key)).toBeNull();
  });
});

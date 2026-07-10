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

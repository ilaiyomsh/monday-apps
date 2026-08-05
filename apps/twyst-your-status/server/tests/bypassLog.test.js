/**
 * bypassLog — the append-only per-column audit behind the monitor (round323).
 * Contract: append is a serialized read-modify-write (concurrent appends to the
 * same column never lose each other), the log is capped newest-wins, and
 * queryRange returns the in-window events newest-first.
 */

import { describe, expect, it, vi } from 'vitest';

import { createBypassLog } from '../src/services/stores.js';

// An in-memory SecureStorage double whose get/set can be delayed on demand, to
// prove append serialization under concurrency.
function makeStore(initial = {}) {
  const data = { ...initial };
  let gate = null;
  return {
    data,
    openGate() { let release; gate = new Promise((r) => { release = r; }); return release; },
    get: vi.fn(async (k) => {
      if (gate) await gate;
      return data[k];
    }),
    set: vi.fn(async (k, v) => { data[k] = v; }),
  };
}

const rec = (ts, extra = {}) => ({ ts, itemId: 'i' + ts, ...extra });

describe('createBypassLog.append', () => {
  it('writes the record under the exact per-column key, newest last', async () => {
    const ss = makeStore();
    const log = createBypassLog({ secureStorage: ss });
    await log.append('999', '5098', 'status_col', rec(100));
    await log.append('999', '5098', 'status_col', rec(200));
    expect(ss.data['999:bypass:5098:status_col']).toEqual([rec(100), rec(200)]);
  });

  it('caps the log at maxEvents, dropping the oldest', async () => {
    const ss = makeStore();
    const log = createBypassLog({ secureStorage: ss, maxEvents: 3 });
    for (const t of [1, 2, 3, 4, 5]) await log.append('999', '5098', 'c', rec(t));
    expect(ss.data['999:bypass:5098:c'].map((e) => e.ts)).toEqual([3, 4, 5]);
  });

  it('serializes concurrent appends to the SAME column — neither write is lost', async () => {
    const ss = makeStore();
    const log = createBypassLog({ secureStorage: ss });
    const release = ss.openGate(); // stall the first get() until we let it go
    const p1 = log.append('999', '5098', 'c', rec(1));
    const p2 = log.append('999', '5098', 'c', rec(2));
    release();
    await Promise.all([p1, p2]);
    expect(ss.data['999:bypass:5098:c'].map((e) => e.ts).sort()).toEqual([1, 2]);
  });

  it('logs, and does not reject, when the underlying write fails', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const ss = makeStore();
    ss.set.mockRejectedValueOnce(new Error('storage down'));
    const log = createBypassLog({ secureStorage: ss, logger });
    await log.append('999', '5098', 'c', rec(1)); // must resolve
    // the lane's tail swallowed+logged it
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('createBypassLog.queryRange', () => {
  it('returns only in-window events, newest first, INCLUSIVE of both bounds', async () => {
    const ss = makeStore({
      // 100 sits exactly on the lower bound, 300 exactly on the upper bound —
      // both must be included; 50 and 400 fall outside.
      '999:bypass:5098:c': [rec(100), rec(250), rec(300), rec(400), rec(50)],
    });
    const log = createBypassLog({ secureStorage: ss });
    const out = await log.queryRange('999', '5098', 'c', 100, 300);
    expect(out.map((e) => e.ts)).toEqual([300, 250, 100]);
  });

  it('returns [] for an empty or missing log', async () => {
    const log = createBypassLog({ secureStorage: makeStore() });
    expect(await log.queryRange('999', '5098', 'c', 0, 9e15)).toEqual([]);
  });

  it('treats a corrupted stored value as empty and logs it', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const ss = makeStore({ '999:bypass:5098:c': '{not json' });
    const log = createBypassLog({ secureStorage: ss, logger });
    expect(await log.queryRange('999', '5098', 'c', 0, 9e15)).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('unwraps a backend-wrapped { value: [...] } array', async () => {
    const ss = makeStore({ '999:bypass:5098:c': { value: [rec(100), rec(200)] } });
    const log = createBypassLog({ secureStorage: ss });
    const out = await log.queryRange('999', '5098', 'c', 0, 9e15);
    expect(out.map((e) => e.ts)).toEqual([200, 100]);
  });
});

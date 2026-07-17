/**
 * axiomTransport.test.ts — 44 cases per TRACKER-AXIOM-EXECUTION-PLAN.md §5.1:
 * T1–T43 as specced, plus T44 (hidden-during-inflight, added by the change-#121
 * adversarial review together with the strengthened T5).
 * Node env, fake timers ['setTimeout','clearTimeout','Date'], injected fetchFn/win/doc seams.
 * No jsdom, no real network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAxiomBrowserTransport } from '../src/axiomTransport';
import type { AxiomTransportOptions } from '../src/axiomTransport';

const BASE_TIME = '2026-07-02T10:00:00.000Z';

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean };
}

function fakeTarget() {
  const listeners = new Map<string, Array<(ev?: unknown) => void>>();
  const target = {
    visibilityState: 'visible' as string,
    addEventListener: vi.fn((type: string, cb: (ev?: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    }),
    removeEventListener: vi.fn((type: string, cb: (ev?: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }),
    emit(type: string) {
      for (const cb of [...(listeners.get(type) ?? [])]) cb({ type });
    },
  };
  return target;
}

function harness(over: Partial<AxiomTransportOptions> = {}) {
  const calls: FetchCall[] = [];
  // script: queued results; when empty, default {ok:true,status:200}. Error entries reject.
  const script: Array<{ ok: boolean; status: number } | Error> = [];
  const fetchFn = vi.fn((url: string, init: FetchCall['init']) => {
    calls.push({ url, init });
    const r = script.length > 0 ? script.shift()! : { ok: true, status: 200 };
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  });
  const win = fakeTarget();
  const doc = fakeTarget();
  const t = createAxiomBrowserTransport({
    dataset: 'ds1',
    token: 'tok1',
    app: 'tracker',
    appVersion: 'v1',
    environment: 'test',
    fetchFn: fetchFn as unknown as AxiomTransportOptions['fetchFn'],
    win: win as unknown as AxiomTransportOptions['win'],
    doc: doc as unknown as AxiomTransportOptions['doc'],
    ...over,
  });
  return { t, fetchFn, calls, script, win, doc };
}

const ev = (over: Record<string, unknown> = {}) =>
  ({ level: 'info', tag: 'app', message: 'hello', ...over }) as {
    level: string;
    tag: string;
    message: string;
    [k: string]: unknown;
  };

const bodies = (calls: FetchCall[]) =>
  calls.map((c) => JSON.parse(c.init.body) as Array<Record<string, unknown>>);
const allEvents = (calls: FetchCall[]) => bodies(calls).flat();

async function tick(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(BASE_TIME));
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Open the breaker: 3 consecutive single-event failed flushes. Returns after state==='open'. */
async function openBreaker(h: ReturnType<typeof harness>) {
  h.script.push(new Error('down'), new Error('down'), new Error('down'));
  for (let i = 0; i < 3; i++) {
    h.t.enqueue(ev({ message: `fail-${i}` }));
    h.t.flush('manual');
    await tick();
  }
  expect(h.t.stats().breakerState).toBe('open');
}

describe('gate / inertness (T1-T3)', () => {
  it('T1: missing token -> inert: enabled:false, zero fetch, zero listeners, all no-ops', () => {
    const h = harness({ token: '' });
    expect(h.t.stats().enabled).toBe(false);
    expect(h.win.addEventListener).not.toHaveBeenCalled();
    expect(h.doc.addEventListener).not.toHaveBeenCalled();
    h.t.enqueue(ev());
    h.t.setContext({ acc: '1' });
    h.t.flush('manual');
    vi.advanceTimersByTime(10_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
    expect(h.t.stats().queued).toBe(0);
  });

  it('T2: missing dataset -> inert same as T1', () => {
    const h = harness({ dataset: '' });
    expect(h.t.stats().enabled).toBe(false);
    expect(h.win.addEventListener).not.toHaveBeenCalled();
    expect(h.doc.addEventListener).not.toHaveBeenCalled();
    h.t.enqueue(ev());
    h.t.flush('manual');
    vi.advanceTimersByTime(10_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
    expect(h.t.stats().queued).toBe(0);
  });

  it('T3: enqueue after dispose() is a no-op', () => {
    const h = harness();
    h.t.dispose();
    h.t.enqueue(ev());
    expect(h.t.stats().queued).toBe(0);
    h.t.flush('manual');
    vi.advanceTimersByTime(10_000);
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
});

describe('batching (T4-T9)', () => {
  it('T4: timer flush at 5s -> one POST to the right URL with Bearer auth', async () => {
    const h = harness();
    h.t.enqueue(ev());
    vi.advanceTimersByTime(4_999);
    expect(h.fetchFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const c = h.calls[0];
    expect(c.url).toBe('https://api.axiom.co/v1/datasets/ds1/ingest');
    expect(c.init.method).toBe('POST');
    expect(c.init.headers['Content-Type']).toBe('application/json');
    expect(c.init.headers['Authorization']).toBe('Bearer tok1');
    expect(JSON.parse(c.init.body)).toHaveLength(1);
  });

  it('T5: 20th event flushes immediately, timer cancelled (next event rides a FRESH 5s timer)', async () => {
    const h = harness();
    for (let i = 0; i < 20; i++) h.t.enqueue(ev({ message: `e${i}` }));
    // immediate size flush, before any timer advance
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.calls[0].init.body)).toHaveLength(20);
    await tick();
    // Pin the cancellation half (review finding, change #121): an event enqueued 1s
    // after the burst must flush on a FRESH 5s timer (t=6s). A stale, un-cancelled
    // timer from the burst's first enqueue would flush it at t=5s instead.
    vi.advanceTimersByTime(1_000);
    h.t.enqueue(ev({ message: 'after-burst' }));
    vi.advanceTimersByTime(4_000); // t=5s since burst — a stale timer would fire here
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000); // t=6s — the fresh timer fires
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    expect(bodies(h.calls)[1].map((e) => e.message)).toEqual(['after-burst']);
  });

  it('T6: timer arms on first enqueue only (second enqueue does not re-arm)', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'A' }));
    vi.advanceTimersByTime(3_000);
    h.t.enqueue(ev({ message: 'B' }));
    vi.advanceTimersByTime(1_999); // t=4999
    expect(h.fetchFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // t=5000 from FIRST enqueue
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const msgs = allEvents(h.calls).map((e) => e.message);
    expect(msgs).toEqual(['A', 'B']);
  });

  it('T7: routine flush has NO keepalive', async () => {
    const h = harness();
    h.t.enqueue(ev());
    vi.advanceTimersByTime(5_000);
    await tick();
    expect(h.calls[0].init.keepalive).toBeFalsy();
  });

  it('T8: _time is enqueue-time ISO, not flush time', async () => {
    const h = harness();
    h.t.enqueue(ev());
    vi.advanceTimersByTime(5_000);
    await tick();
    const e = allEvents(h.calls)[0];
    expect(e._time).toBe(BASE_TIME);
  });

  it('T9: static enrich app/env/ver/sess on every event; sess stable per instance', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'one' }));
    h.t.enqueue(ev({ message: 'two' }));
    vi.advanceTimersByTime(5_000);
    await tick();
    const events = allEvents(h.calls);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.app).toBe('tracker');
      expect(e.env).toBe('test');
      expect(e.ver).toBe('v1');
      expect(typeof e.sess).toBe('string');
      expect((e.sess as string).length).toBeGreaterThan(0);
    }
    expect(events[0].sess).toBe(events[1].sess);
  });
});

describe('size (T10-T11)', () => {
  it('T10: >60KB batch chains multiple POSTs each <=60KB, order preserved', async () => {
    const h = harness({ caps: { batchMaxEvents: 1_000, queueMax: 1_000 } });
    const N = 250;
    for (let i = 0; i < N; i++) {
      h.t.enqueue(ev({ message: `m${String(i).padStart(3, '0')}-${'x'.repeat(290)}`, seq: i }));
    }
    h.t.flush('manual');
    await tick(80);
    expect(h.calls.length).toBeGreaterThanOrEqual(2);
    for (const c of h.calls) {
      expect(c.init.body.length).toBeLessThanOrEqual(60_000);
      expect(c.init.keepalive).toBeFalsy();
    }
    const seqs = allEvents(h.calls).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it('T11: truncation caps — message 300, stack1 400, field 128', async () => {
    const h = harness();
    h.t.enqueue(
      ev({
        message: 'a'.repeat(500),
        tag: 'd'.repeat(200),
        stack1: 'b'.repeat(600),
        corr: 'c'.repeat(200),
      })
    );
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect((e.message as string).length).toBe(300);
    expect((e.tag as string).length).toBe(128);
    expect((e.stack1 as string).length).toBe(400);
    expect((e.corr as string).length).toBe(128);
  });
});

describe('queue cap (T12)', () => {
  it('T12: breaker open + 150 enqueues -> queued 100, droppedQueue 50, survivors are the NEWEST', async () => {
    const h = harness();
    await openBreaker(h);
    for (let i = 0; i < 150; i++) h.t.enqueue(ev({ message: `q${i}` }));
    let s = h.t.stats();
    expect(s.queued).toBe(100);
    expect(s.droppedQueue).toBe(50);
    expect(h.fetchFn).toHaveBeenCalledTimes(3); // open: zero fetch during enqueues
    // recover and verify survivors are q50..q149
    vi.advanceTimersByTime(60_000);
    h.t.flush('manual');
    await tick(120);
    const probeBody = bodies(h.calls)[3];
    expect(probeBody[0].message).toBe('q50'); // oldest survivor first
    const msgs = allEvents(h.calls.slice(3)).map((e) => e.message as string);
    for (let i = 0; i < 50; i++) expect(msgs).not.toContain(`q${i}`);
    for (let i = 50; i < 150; i++) expect(msgs).toContain(`q${i}`);
    s = h.t.stats();
    expect(s.droppedQueue).toBe(50);
    expect(s.breakerState).toBe('closed');
  });
});

describe('dedup (T13-T17)', () => {
  it('T13: 6 identical -> 5 queued, 1 droppedDedup', () => {
    const h = harness();
    for (let i = 0; i < 6; i++) h.t.enqueue(ev());
    const s = h.t.stats();
    expect(s.queued).toBe(5);
    expect(s.droppedDedup).toBe(1);
  });

  it('T14: different tag not suppressed', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.t.enqueue(ev({ tag: 'a' }));
    h.t.enqueue(ev({ tag: 'b' }));
    const s = h.t.stats();
    expect(s.queued).toBe(6);
    expect(s.droppedDedup).toBe(0);
  });

  it('T15: fixed window resets after 61s — same key passes again', async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) h.t.enqueue(ev()); // 5 pass, 1 dropped
    expect(h.t.stats().droppedDedup).toBe(1);
    vi.advanceTimersByTime(5_000); // timer flush ships the 5
    await tick();
    vi.advanceTimersByTime(56_000); // now t0+61s
    h.t.enqueue(ev());
    const s = h.t.stats();
    expect(s.queued).toBe(1); // passed in a fresh window
    expect(s.droppedDedup).toBe(1); // unchanged
  });

  it("T16: tag:'transport' bypasses dedup", () => {
    const h = harness();
    for (let i = 0; i < 8; i++) h.t.enqueue(ev({ tag: 'transport', message: 'same' }));
    const s = h.t.stats();
    expect(s.queued).toBe(8);
    expect(s.droppedDedup).toBe(0);
  });

  it('T17: dedup map overflow (>500 keys) clears without throwing; dedup still works after', () => {
    const h = harness({ caps: { batchMaxEvents: 10_000, queueMax: 10_000 } });
    expect(() => {
      for (let i = 0; i < 501; i++) h.t.enqueue(ev({ message: `distinct-${i}` }));
    }).not.toThrow();
    for (let i = 0; i < 6; i++) h.t.enqueue(ev({ message: 'after-overflow' }));
    const s = h.t.stats();
    expect(s.droppedDedup).toBe(1); // dedup functional after clear()
    expect(s.queued).toBe(501 + 5);
  });
});

describe('session cap (T18-T19)', () => {
  it('T18: exactly ONE events_dropped meta (warn/transport/numeric dropped), then silence', async () => {
    const h = harness({ caps: { sessionShipMax: 3 } });
    h.t.enqueue(ev({ message: 'a' }));
    h.t.enqueue(ev({ message: 'b' }));
    h.t.enqueue(ev({ message: 'c' }));
    h.t.flush('manual');
    await tick();
    expect(h.t.stats().shipped).toBe(3);
    h.t.enqueue(ev({ message: 'd' })); // dropped -> meta enqueued
    h.t.enqueue(ev({ message: 'e' })); // dropped silently
    h.t.flush('manual');
    await tick();
    h.t.enqueue(ev({ message: 'f' })); // dropped silently
    h.t.flush('manual');
    await tick();
    const metas = allEvents(h.calls).filter((e) => e.message === 'events_dropped');
    expect(metas).toHaveLength(1);
    expect(metas[0].level).toBe('warn');
    expect(metas[0].tag).toBe('transport');
    expect(typeof metas[0].dropped).toBe('number');
    expect(h.t.stats().droppedSessionCap).toBe(3);
  });

  it('T19: the meta itself bypasses the session cap (ships even though cap is hit, no recursion)', async () => {
    const h = harness({ caps: { sessionShipMax: 2 } });
    h.t.enqueue(ev({ message: 'a' }));
    h.t.enqueue(ev({ message: 'b' }));
    h.t.flush('manual');
    await tick();
    h.t.enqueue(ev({ message: 'c' })); // cap hit -> meta enqueued despite shipped >= cap
    expect(h.t.stats().queued).toBe(1); // the meta got queued (not capped away)
    h.t.flush('manual');
    await tick();
    const metas = allEvents(h.calls).filter((e) => e.message === 'events_dropped');
    expect(metas).toHaveLength(1); // shipped, and did not spawn another meta
    expect(h.t.stats().droppedSessionCap).toBe(1); // meta not counted as a capped drop
  });
});

describe('circuit breaker (T20-T27)', () => {
  it('T20: 3 consecutive {ok:false} -> open; 4th trigger makes zero fetch', async () => {
    const h = harness();
    h.script.push({ ok: false, status: 500 }, { ok: false, status: 500 }, { ok: false, status: 500 });
    for (let i = 0; i < 3; i++) {
      h.t.enqueue(ev({ message: `f${i}` }));
      h.t.flush('manual');
      await tick();
    }
    let s = h.t.stats();
    expect(s.breakerState).toBe('open');
    expect(s.consecutiveFailures).toBe(3);
    h.t.enqueue(ev({ message: 'while-open' }));
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    s = h.t.stats();
    expect(s.breakerState).toBe('open');
  });

  it('T21: 2 failures then a success resets the counter, stays closed', async () => {
    const h = harness();
    h.script.push({ ok: false, status: 500 }, { ok: false, status: 500 }, { ok: true, status: 200 });
    for (let i = 0; i < 3; i++) {
      h.t.enqueue(ev({ message: `r${i}` }));
      h.t.flush('manual');
      await tick();
    }
    const s = h.t.stats();
    expect(s.breakerState).toBe('closed');
    expect(s.consecutiveFailures).toBe(0);
  });

  it('T22: fetch rejection counts as a failure', async () => {
    const h = harness();
    h.script.push(new Error('network down'));
    h.t.enqueue(ev());
    h.t.flush('manual');
    await tick();
    const s = h.t.stats();
    expect(s.consecutiveFailures).toBe(1);
    expect(s.breakerState).toBe('closed');
  });

  it('T23: open breaker still enqueues into the bounded queue', async () => {
    const h = harness();
    await openBreaker(h);
    h.t.enqueue(ev({ message: 'k1' }));
    h.t.enqueue(ev({ message: 'k2' }));
    h.t.enqueue(ev({ message: 'k3' }));
    expect(h.t.stats().queued).toBe(3);
    expect(h.fetchFn).toHaveBeenCalledTimes(3); // no new fetch
  });

  it('T24: after 60s exactly ONE half-open probe; concurrent triggers do not double-send', async () => {
    const h = harness();
    await openBreaker(h);
    h.t.enqueue(ev({ message: 'probe-cargo' }));
    vi.advanceTimersByTime(60_000);
    h.t.flush('manual');
    h.t.flush('manual'); // concurrent trigger
    expect(h.fetchFn).toHaveBeenCalledTimes(4); // 3 failures + exactly 1 probe
    await tick();
    expect(h.t.stats().breakerState).toBe('closed');
  });

  it('T25: probe success -> closed + transport_recovered meta with numeric open_ms, exactly once', async () => {
    const h = harness();
    await openBreaker(h);
    h.t.enqueue(ev({ message: 'cargo' }));
    vi.advanceTimersByTime(60_000);
    h.t.flush('manual'); // probe (default script -> ok)
    await tick();
    expect(h.t.stats().breakerState).toBe('closed');
    vi.advanceTimersByTime(5_000); // meta rides the next timer flush
    await tick();
    const recov = allEvents(h.calls).filter((e) => e.message === 'transport_recovered');
    expect(recov).toHaveLength(1);
    expect(recov[0].level).toBe('warn');
    expect(recov[0].tag).toBe('transport');
    expect(typeof recov[0].open_ms).toBe('number');
    expect(recov[0].open_ms).toBe(60_000);
  });

  it('T26: probe failure -> open with a FRESH 60s window', async () => {
    const h = harness();
    await openBreaker(h);
    h.t.enqueue(ev({ message: 'cargo1' }));
    vi.advanceTimersByTime(60_000);
    h.script.push(new Error('still down'));
    h.t.flush('manual'); // probe fails
    await tick();
    expect(h.t.stats().breakerState).toBe('open');
    const callsAfterProbe = h.fetchFn.mock.calls.length; // 4
    h.t.enqueue(ev({ message: 'cargo2' }));
    vi.advanceTimersByTime(59_000);
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(callsAfterProbe); // still inside fresh window
    vi.advanceTimersByTime(1_000);
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(callsAfterProbe + 1); // new probe after fresh 60s
  });

  it('T27: a failed batch is discarded and never re-appears in later POSTs', async () => {
    const h = harness();
    h.script.push({ ok: false, status: 500 });
    h.t.enqueue(ev({ message: 'X1' }));
    h.t.flush('manual');
    await tick();
    h.t.enqueue(ev({ message: 'X2' }));
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    const secondBatch = bodies(h.calls)[1].map((e) => e.message);
    expect(secondBatch).toEqual(['X2']);
    for (const c of h.calls.slice(1)) {
      expect(c.init.body).not.toContain('X1');
    }
  });
});

describe('breadcrumbs (T28)', () => {
  it("T28: every failure emits one console.error starting '[axiom-transport] '; nothing throws", async () => {
    const h = harness();
    h.script.push(new Error('boom'), { ok: false, status: 500 });
    expect(() => {
      h.t.enqueue(ev({ message: 'c1' }));
      h.t.flush('manual');
    }).not.toThrow();
    await tick();
    expect(() => {
      h.t.enqueue(ev({ message: 'c2' }));
      h.t.flush('manual');
    }).not.toThrow();
    await tick();
    expect(errSpy).toHaveBeenCalledTimes(2);
    for (const call of errSpy.mock.calls) {
      expect(String(call[0]).startsWith('[axiom-transport] ')).toBe(true);
    }
  });
});

describe('sanitizer (T29-T35)', () => {
  it('T29: nested object / array / Error / function / boolean / null / undefined extras are dropped', async () => {
    const h = harness();
    h.t.enqueue(
      ev({
        o: { a: 1 },
        arr: [1, 2],
        er: new Error('boom'),
        fn: () => 1,
        flag: true,
        nl: null,
        ud: undefined,
      })
    );
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    for (const k of ['o', 'arr', 'er', 'fn', 'flag', 'nl', 'ud']) {
      expect(k in e).toBe(false);
    }
    expect(e.message).toBe('hello');
  });

  it('T30: circular reference never serialized — no throw, key absent', async () => {
    const h = harness();
    const c: Record<string, unknown> = { x: 1 };
    c.self = c;
    expect(() => h.t.enqueue(ev({ cyc: c }))).not.toThrow();
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const e = allEvents(h.calls)[0];
    expect('cyc' in e).toBe(false);
  });

  it('T31: deny-substring keys dropped (incl. numeric emailCount)', async () => {
    const h = harness();
    h.t.enqueue(
      ev({
        userName: 'a',
        title: 'b',
        summary: 'c',
        boardText: 'd',
        label: 'e',
        email: 'f',
        apiToken: 'g',
        clientSecret: 'h',
        password: 'i',
        emailCount: 5,
      })
    );
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    for (const k of [
      'userName',
      'title',
      'summary',
      'boardText',
      'label',
      'email',
      'apiToken',
      'clientSecret',
      'password',
      'emailCount',
    ]) {
      expect(k in e).toBe(false);
    }
  });

  it('T32: precedence — allowlisted err_name survives the deny pattern', async () => {
    const h = harness();
    h.t.enqueue(ev({ err_name: 'TypeError', err_code: 404 }));
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect(e.err_name).toBe('TypeError');
    expect(e.err_code).toBe('404'); // allowlist String-coerces
  });

  it('T32b: err_msg is allowlisted and capped at 200 (v2 scrubbed error.message)', async () => {
    const h = harness();
    h.t.enqueue(ev({ err_msg: 'z'.repeat(500), kind: 'usage' }));
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect((e.err_msg as string).length).toBe(200);
    expect(e.kind).toBe('usage');
  });

  it('T33: finite numerics pass; NaN/Infinity drop; deny-named numeric drops; 13th numeric extra drops', async () => {
    const h = harness();
    h.t.enqueue(
      ev({
        message: 'nums',
        ms: 12.5,
        total_ms: 100,
        step: 3,
        bad1: NaN,
        bad2: Infinity,
        bad3: -Infinity,
        nameCount: 7,
      })
    );
    const thirteen: Record<string, unknown> = { message: 'thirteen' };
    for (let i = 1; i <= 13; i++) thirteen[`n${String(i).padStart(2, '0')}`] = i;
    h.t.enqueue(ev(thirteen));
    h.t.flush('manual');
    await tick();
    const [e1, e2] = allEvents(h.calls);
    expect(e1.ms).toBe(12.5);
    expect(e1.total_ms).toBe(100);
    expect(e1.step).toBe(3);
    for (const k of ['bad1', 'bad2', 'bad3', 'nameCount']) expect(k in e1).toBe(false);
    for (let i = 1; i <= 12; i++) expect(e2[`n${String(i).padStart(2, '0')}`]).toBe(i);
    expect('n13' in e2).toBe(false);
  });

  it('T34: numeric acc via setContext ships as a string', async () => {
    const h = harness();
    h.t.setContext({ acc: 987, usr: 'u1' });
    h.t.enqueue(ev());
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect(e.acc).toBe('987');
    expect(e.usr).toBe('u1');
  });

  it('T35: __proto__/constructor payloads inert (null-prototype output, no pollution, no throw)', async () => {
    const h = harness();
    const hostile = JSON.parse(
      '{"level":"info","tag":"app","message":"hostile","__proto__":{"polluted":true},"constructor":{"bad":true}}'
    );
    expect(() => h.t.enqueue(hostile)).not.toThrow();
    h.t.flush('manual');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const body = h.calls[0].init.body;
    expect(body).not.toContain('polluted');
    expect(body).not.toContain('"bad"');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('lifecycle / context (T36-T42)', () => {
  it('T36: visibilitychange to hidden -> flush with keepalive:true', async () => {
    const h = harness();
    h.t.enqueue(ev());
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(h.calls[0].init.keepalive).toBe(true);
  });

  it('T37: hidden then pagehide -> one POST total (second flush finds empty queue)', async () => {
    const h = harness();
    h.t.enqueue(ev());
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    h.win.emit('pagehide');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('T38: pagehide alone flushes (keepalive path)', async () => {
    const h = harness();
    h.t.enqueue(ev());
    h.win.emit('pagehide');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    expect(h.calls[0].init.keepalive).toBe(true);
  });

  it('T44: hidden flush proceeds while a routine flush is in flight (terminal keepalive not starved)', async () => {
    const h = harness();
    // Hold the routine POST open: a fetch promise we resolve manually.
    let release!: (v: { ok: boolean; status: number }) => void;
    const pending = new Promise<{ ok: boolean; status: number }>((res) => {
      release = res;
    });
    h.fetchFn.mockImplementationOnce((url: string, init: FetchCall['init']) => {
      h.calls.push({ url, init });
      return pending;
    });
    h.t.enqueue(ev({ message: 'in-flight' }));
    h.t.flush('manual'); // routine drain now awaiting `pending`
    await tick();
    expect(h.calls).toHaveLength(1);
    // Events arriving while the routine POST is still in the air…
    h.t.enqueue(ev({ message: 'tail-1' }));
    h.t.enqueue(ev({ message: 'tail-2' }));
    // …must still go out on the terminal hidden flush (review finding, change #121).
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].init.keepalive).toBe(true);
    expect(bodies(h.calls)[1].map((e) => e.message)).toEqual(['tail-1', 'tail-2']);
    // Releasing the routine POST must not produce a duplicate/extra POST:
    // the drain loop re-checks the (now empty) queue and exits cleanly.
    release({ ok: true, status: 200 });
    await tick();
    expect(h.calls).toHaveLength(2);
  });

  it('T39: hidden with >60KB queued -> ONE keepalive POST of the NEWEST events, remainder dropped+counted', async () => {
    const h = harness({
      caps: { batchMaxEvents: 100_000, queueMax: 100_000, sessionShipMax: 100_000 },
    });
    const N = 250;
    for (let i = 0; i < N; i++) {
      h.t.enqueue(ev({ message: `h${String(i).padStart(3, '0')}-${'x'.repeat(290)}`, seq: i }));
    }
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1); // no chaining on hidden
    const c = h.calls[0];
    expect(c.init.keepalive).toBe(true);
    expect(c.init.body.length).toBeLessThanOrEqual(60_000);
    const events = JSON.parse(c.init.body) as Array<Record<string, unknown>>;
    const seqs = events.map((e) => e.seq as number);
    expect(seqs[seqs.length - 1]).toBe(N - 1); // newest made it
    expect(Math.min(...seqs)).toBeGreaterThan(0); // oldest did not
    const s = h.t.stats();
    expect(s.droppedQueue).toBe(N - events.length);
    expect(s.queued).toBe(0);
  });

  it('T40: hidden -> visible -> enqueue resumes the normal timer path', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'A' }));
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    h.doc.visibilityState = 'visible';
    h.doc.emit('visibilitychange'); // must NOT flush
    h.t.enqueue(ev({ message: 'B' }));
    vi.advanceTimersByTime(5_000);
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    expect(h.calls[1].init.keepalive).toBeFalsy();
    const msgs = bodies(h.calls)[1].map((e) => e.message);
    expect(msgs).toContain('B');
  });

  it('T41: enqueue -> setContext -> flush: events carry acc/usr/obj; partial merge does not clobber', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'pre-context' }));
    h.t.setContext({ acc: 'a1', usr: 'u1' });
    h.t.setContext({ obj: 'o1' }); // partial — must not clobber acc/usr
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect(e.acc).toBe('a1');
    expect(e.usr).toBe('u1');
    expect(e.obj).toBe('o1');
  });

  it('T42: events flushed BEFORE setContext lack acc; on collision the event field beats context', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'early' }));
    h.t.flush('manual');
    await tick();
    const early = allEvents(h.calls)[0];
    expect('acc' in early).toBe(false); // pinned: no retroactive enrichment
    h.t.setContext({ acc: 'ctx' });
    h.t.enqueue(ev({ message: 'collide', acc: 'evt' }));
    h.t.enqueue(ev({ message: 'plain' }));
    h.t.flush('manual');
    await tick();
    const later = bodies(h.calls)[1];
    const collide = later.find((e) => e.message === 'collide')!;
    const plain = later.find((e) => e.message === 'plain')!;
    expect(collide.acc).toBe('evt'); // spread order: event wins
    expect(plain.acc).toBe('ctx');
  });
});

describe('HMR dispose-and-replace (T43)', () => {
  it('T43: second create with same app disposes the first — listeners removed, timer dead, new instance wins', async () => {
    const h1 = harness();
    h1.t.enqueue(ev({ message: 'old' })); // arms h1 timer
    const h2 = harness(); // same app 'tracker' -> disposes h1
    expect(h1.win.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(h1.doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    vi.advanceTimersByTime(5_000);
    await tick();
    expect(h1.fetchFn).not.toHaveBeenCalled(); // pending timer dead
    h1.t.enqueue(ev({ message: 'zombie' }));
    expect(h1.t.stats().queued).toBe(0); // disposed -> no-op
    h2.t.enqueue(ev({ message: 'new' }));
    vi.advanceTimersByTime(5_000);
    await tick();
    expect(h2.fetchFn).toHaveBeenCalledTimes(1);
    expect(allEvents(h2.calls)[0].message).toBe('new');
  });
});

/**
 * fix-transport.test.ts — TDD gate for the transport-level fixes (1, 2, 5) and the
 * transport half of fix 3 (allowlist). Each block was RED against the app-core baseline
 * (see RED-GATE-LOG.md) before the implementation landed.
 * Node env, fake timers, injected fetchFn/win/doc seams — mirrors axiomTransport.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAxiomBrowserTransport } from '../src/browser/axiomTransport';
import type { AxiomTransportOptions } from '../src/browser/axiomTransport';

const BASE_TIME = '2026-07-19T10:00:00.000Z';

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean };
}

function fakeTarget() {
  const listeners = new Map<string, Array<(ev?: unknown) => void>>();
  return {
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
}

function harness(over: Partial<AxiomTransportOptions> = {}) {
  const calls: FetchCall[] = [];
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
    app: 'fixapp',
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

const bodies = (calls: FetchCall[]) => calls.map((c) => JSON.parse(c.init.body) as Array<Record<string, unknown>>);
const allEvents = (calls: FetchCall[]) => bodies(calls).flat();

async function tick(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(BASE_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openBreaker(h: ReturnType<typeof harness>) {
  h.script.push(new Error('down'), new Error('down'), new Error('down'));
  for (let i = 0; i < 3; i++) {
    h.t.enqueue(ev({ message: `fail-${i}` }));
    h.t.flush('manual');
    await tick();
  }
  expect(h.t.stats().breakerState).toBe('open');
}

// ============================================================================
// FIX 1 — droppedShipFailure counter
// ============================================================================
describe('fix1: droppedShipFailure counter', () => {
  it('F1a: a failed single-event flush increments droppedShipFailure by that event count', async () => {
    const h = harness();
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(0);
    h.script.push({ ok: false, status: 500 });
    h.t.enqueue(ev({ message: 'lost-1' }));
    h.t.flush('manual');
    await tick();
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(1);
  });

  it('F1b: a failed multi-event batch counts every lost event', async () => {
    const h = harness();
    h.script.push({ ok: false, status: 500 });
    for (let i = 0; i < 3; i++) h.t.enqueue(ev({ message: `m${i}` }));
    h.t.flush('manual');
    await tick();
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(3);
  });

  it('F1c: a successful flush does NOT increment droppedShipFailure', async () => {
    const h = harness();
    h.t.enqueue(ev({ message: 'ok' }));
    h.t.flush('manual');
    await tick();
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(0);
  });

  it('F1d: the inert (gated-off) transport reports droppedShipFailure: 0', () => {
    const h = harness({ token: '' });
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(0);
  });
});

// ============================================================================
// FIX 2 — terminal (hidden) flush attempts a keepalive send even with the breaker OPEN
// ============================================================================
describe('fix2: terminal flush with an open breaker', () => {
  it('F2a: hidden flush while OPEN still fires exactly one keepalive POST of the queued events', async () => {
    const h = harness();
    await openBreaker(h); // 3 fetch calls, breaker now open, still inside the 60s window
    h.t.enqueue(ev({ message: 'tail-1' }));
    h.t.enqueue(ev({ message: 'tail-2' }));
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(4); // baseline made ZERO here (open → no-op)
    expect(h.calls[3].init.keepalive).toBe(true);
    expect(bodies(h.calls)[3].map((e) => e.message)).toEqual(['tail-1', 'tail-2']);
  });

  it('F2b: a failing terminal keepalive send counts the loss in droppedShipFailure', async () => {
    const h = harness();
    await openBreaker(h);
    const before = (h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure; // 3
    h.t.enqueue(ev({ message: 'x1' }));
    h.t.enqueue(ev({ message: 'x2' }));
    h.script.push(new Error('still down'));
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange');
    await tick();
    expect(h.fetchFn).toHaveBeenCalledTimes(4);
    expect((h.t.stats() as unknown as { droppedShipFailure: number }).droppedShipFailure).toBe(before + 2);
  });

  it('F2c: a succeeding terminal keepalive send ships the queued events (shipped increments)', async () => {
    const h = harness();
    await openBreaker(h);
    const shippedBefore = h.t.stats().shipped;
    h.t.enqueue(ev({ message: 's1' }));
    h.t.enqueue(ev({ message: 's2' }));
    h.doc.visibilityState = 'hidden';
    h.doc.emit('visibilitychange'); // default script → ok
    await tick();
    expect(h.t.stats().shipped).toBe(shippedBefore + 2);
    expect(h.t.stats().queued).toBe(0);
  });
});

// ============================================================================
// FIX 5 — dedup key incorporates err_name + first 40 chars of the (scrubbed) message
// ============================================================================
describe('fix5: dedup key distinguishes errors behind one generic logger message', () => {
  it('F5a: distinct err_name under the SAME logger message does not dedup-collide', () => {
    const h = harness();
    // 5 identical TypeErrors (fill the per-key window) …
    for (let i = 0; i < 5; i++) {
      h.t.enqueue(ev({ message: 'request failed', err_name: 'TypeError', err_msg: 'cannot read x' }));
    }
    // … then ONE RangeError behind the exact same generic message.
    h.t.enqueue(ev({ message: 'request failed', err_name: 'RangeError', err_msg: 'index out of range' }));
    const s = h.t.stats();
    expect(s.queued).toBe(6); // baseline: 5 (the 6th collided on level|tag|message and was dropped)
    expect(s.droppedDedup).toBe(0); // baseline: 1
  });

  it('F5b: genuinely identical errors STILL dedup (5-per-window policy preserved)', () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      h.t.enqueue(ev({ message: 'm', err_name: 'Error', err_msg: 'same detail' }));
    }
    const s = h.t.stats();
    expect(s.queued).toBe(5);
    expect(s.droppedDedup).toBe(1);
  });

  it('F5c: err_msg differing within the first 40 chars does not collide', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      h.t.enqueue(ev({ message: 'op', err_name: 'Error', err_msg: 'alpha failure at node 1' }));
    }
    h.t.enqueue(ev({ message: 'op', err_name: 'Error', err_msg: 'bravo failure at node 2' }));
    const s = h.t.stats();
    expect(s.queued).toBe(6);
    expect(s.droppedDedup).toBe(0);
  });
});

// ============================================================================
// FIX 3 (transport half) — `stack` + `component_stack` are allowlisted & capped
// ============================================================================
describe('fix3 (transport): stack + component_stack allowlist keys', () => {
  it('F3t: stack ships capped at 1500 and component_stack capped at 1000', async () => {
    const h = harness();
    h.t.enqueue(ev({ stack: 's'.repeat(2000), component_stack: 'c'.repeat(1500) }));
    h.t.flush('manual');
    await tick();
    const e = allEvents(h.calls)[0];
    expect((e.stack as string).length).toBe(1500); // baseline: key dropped (not allowlisted) → undefined
    expect((e.component_stack as string).length).toBe(1000); // baseline: undefined
  });
});

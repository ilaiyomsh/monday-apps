/**
 * drift.test.ts — the guarantee that the VENDORED copies never rot.
 *
 * Server apps (monday-code) and their embedded admin SPAs push the app ROOT only, so a
 * workspace dependency on @mapps/error-kit does NOT resolve at their runtime. Those surfaces
 * therefore keep a LOCAL (vendored) copy of the shipping stack. This suite imports each
 * vendored module by relative path — tests run in the workspace, where cross-package imports
 * resolve even though the deployed runtime cannot — and asserts the shared BEHAVIORAL contract
 * against every copy. It tests BEHAVIOR, not bytes: legitimate divergences (domainKind→kind
 * adapters, the VITE_AXIOM_* activation gate living in each consumer's sink, per-app CTX_ALLOW
 * supersets) are accommodated; the load-bearing hardening guarantees are enforced.
 *
 * Coverage (per the error-kit architecture, 5 hardening fixes):
 *   BROWSER copies (sync-calender SPA, deadline-confirm SPA, telemetry-dashboard client):
 *     - gate inertness (empty token → inert handle, zero listeners, zero fetch)
 *     - fix1: droppedShipFailure counted on a failed POST
 *     - fix2: terminal (hidden) flush ships even with the breaker OPEN
 *     - fix3: `stack` (cap 1500) + `component_stack` (cap 1000) are allowlisted + capped
 *     - fix5: dedup key includes err_name + err_msg (distinct errors behind one generic
 *             logger message do not collide)
 *     - globalErrorHandler: a CAPTURE-PHASE 'error' listener for resource failures
 *   SERVER copies (sync-calender, deadline-confirm, telemetry-dashboard):
 *     - opts-injected (zero process.env reads — asserted against the file source)
 *     - scrubMessage redaction (emails / tokens&hex>=16 / digit-runs>=7)
 *     - WARN/ERROR ship policy (+ duplicate drop, alwaysShip bypass)
 *     - CTX_ALLOW: short ids/counters ship, free-form (title/email/nested) stays local
 *     - kind defaults to 'error', domainKind → kind
 *
 * Red-gate: the last describe block runs the browser contract against a deliberately-broken
 * in-memory transport (old level|tag|message dedup, no droppedShipFailure) and asserts that
 * ≥2 contract checks reject it — proof the checks can fail. See test/RED-GATE-LOG.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---- vendored BROWSER transports (createAxiomBrowserTransport) --------------------------
import { createAxiomBrowserTransport as syncCalTransport } from '../../../apps/axis/sync-calender/src/client/admin/utils/axiomBrowserTransport';
import { createAxiomBrowserTransport as deadlineTransport } from '../../../apps/deadline-confirm/src/client/admin/utils/axiomBrowserTransport';
import { createAxiomBrowserTransport as telemetryTransport } from '../../../apps/telemetry-dashboard/src/client/utils/axiomBrowserTransport';

// ---- vendored globalErrorHandlers ------------------------------------------------------
import { setupGlobalErrorHandlers as syncCalGEH } from '../../../apps/axis/sync-calender/src/client/admin/utils/globalErrorHandler';
import { setupGlobalErrorHandlers as deadlineGEH } from '../../../apps/deadline-confirm/src/client/admin/utils/globalErrorHandler';
import { setupGlobalErrorHandlers as telemetryGEH } from '../../../apps/telemetry-dashboard/src/client/utils/globalErrorHandler';

// ---- vendored SERVER sinks (JS, opts-injected) -----------------------------------------
import * as syncCalServer from '../../../apps/axis/sync-calender/src/services/axiomServerSink.js';
import * as deadlineServer from '../../../apps/deadline-confirm/src/helpers/axiomServerSink.js';
import * as telemetryServer from '../../../apps/telemetry-dashboard/src/helpers/axiomServerSink.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

type CreateTransport = typeof syncCalTransport;

// ============================================================================
// Shared browser harness (mirrors axiomTransport.test.ts: fake timers + seams)
// ============================================================================
interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean };
}

function fakeTarget() {
  const listeners = new Map<string, Array<{ cb: (ev?: unknown) => void; capture: boolean }>>();
  return {
    visibilityState: 'visible' as string,
    calls: [] as Array<{ type: string; capture: boolean }>,
    addEventListener: vi.fn(function (this: unknown, type: string, cb: (ev?: unknown) => void, opts?: boolean | { capture?: boolean }) {
      const capture = opts === true || (typeof opts === 'object' && opts?.capture === true);
      const arr = listeners.get(type) ?? [];
      arr.push({ cb, capture });
      listeners.set(type, arr);
    }),
    removeEventListener: vi.fn(),
    emit(type: string) {
      for (const { cb } of [...(listeners.get(type) ?? [])]) cb({ type });
    },
    listenersFor(type: string) {
      return listeners.get(type) ?? [];
    },
  };
}

function harness(create: CreateTransport, over: Record<string, unknown> = {}) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = create({
    dataset: 'ds1',
    token: 'tok1',
    app: 'drift-suite',
    appVersion: 'v1',
    environment: 'test',
    fetchFn: fetchFn as any,
    win: win as any,
    doc: doc as any,
    ...over,
  } as any);
  return { t, fetchFn, calls, script, win, doc };
}

const ev = (over: Record<string, unknown> = {}) =>
  ({ level: 'error', tag: 'app', message: 'hello', ...over }) as {
    level: string; tag: string; message: string; [k: string]: unknown;
  };

const bodies = (calls: FetchCall[]) => calls.map((c) => JSON.parse(c.init.body) as Array<Record<string, unknown>>);
const allEvents = (calls: FetchCall[]) => bodies(calls).flat();

async function tick(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function openBreaker(h: ReturnType<typeof harness>) {
  h.script.push(new Error('down'), new Error('down'), new Error('down'));
  for (let i = 0; i < 3; i++) {
    h.t.enqueue(ev({ message: `fail-${i}` }));
    h.t.flush('manual');
    await tick();
  }
}

// ============================================================================
// The browser contract — a list of independent checks (each throws on failure,
// so the red-gate can count how many reject a broken variant).
// ============================================================================
interface BrowserCheck {
  name: string;
  run(create: CreateTransport): Promise<void>;
}

const BROWSER_CHECKS: BrowserCheck[] = [
  {
    name: 'gate inertness: empty token → inert handle, zero listeners, zero fetch',
    async run(create) {
      const h = harness(create, { token: '' });
      expect(h.t.stats().enabled).toBe(false);
      expect(h.win.addEventListener).not.toHaveBeenCalled();
      expect(h.doc.addEventListener).not.toHaveBeenCalled();
      h.t.enqueue(ev());
      h.t.flush('manual');
      vi.advanceTimersByTime(10_000);
      await tick();
      expect(h.fetchFn).not.toHaveBeenCalled();
    },
  },
  {
    name: 'fix1: a failed POST increments droppedShipFailure by the batch size',
    async run(create) {
      const h = harness(create);
      expect(h.t.stats().droppedShipFailure).toBe(0);
      h.script.push({ ok: false, status: 500 });
      h.t.enqueue(ev({ message: 'a' }));
      h.t.enqueue(ev({ message: 'b' }));
      h.t.flush('manual');
      await tick();
      expect(h.t.stats().droppedShipFailure).toBe(2);
    },
  },
  {
    name: 'fix2: terminal (hidden) flush ships one keepalive POST even with the breaker OPEN',
    async run(create) {
      const h = harness(create);
      await openBreaker(h); // 3 fetches, breaker open, still inside the 60s window
      expect(h.t.stats().breakerState).toBe('open');
      h.t.enqueue(ev({ message: 'tail-1' }));
      h.t.enqueue(ev({ message: 'tail-2' }));
      h.doc.visibilityState = 'hidden';
      h.doc.emit('visibilitychange');
      await tick();
      expect(h.fetchFn).toHaveBeenCalledTimes(4); // a drifted (pre-fix2) copy makes ZERO here
      expect(h.calls[3].init.keepalive).toBe(true);
      expect(bodies(h.calls)[3].map((e) => e.message)).toEqual(['tail-1', 'tail-2']);
    },
  },
  {
    name: 'fix3: stack (cap 1500) + component_stack (cap 1000) are allowlisted + capped',
    async run(create) {
      const h = harness(create);
      h.t.enqueue(ev({ stack: 's'.repeat(2000), component_stack: 'c'.repeat(1500) }));
      h.t.flush('manual');
      await tick();
      const e = allEvents(h.calls)[0];
      expect((e.stack as string).length).toBe(1500); // drifted copy: key dropped → undefined
      expect((e.component_stack as string).length).toBe(1000);
    },
  },
  {
    name: 'fix5: dedup key includes err_name+err_msg (distinct errors behind one message survive)',
    async run(create) {
      const h = harness(create);
      // 5 identical TypeErrors (fill the per-key window) under one generic logger message …
      for (let i = 0; i < 5; i++) {
        h.t.enqueue(ev({ message: 'request failed', err_name: 'TypeError', err_msg: 'cannot read x' }));
      }
      // … then ONE RangeError behind the exact same generic message.
      h.t.enqueue(ev({ message: 'request failed', err_name: 'RangeError', err_msg: 'index out of range' }));
      const s = h.t.stats();
      expect(s.queued).toBe(6); // drifted (level|tag|message) copy: 5, with 1 droppedDedup
      expect(s.droppedDedup).toBe(0);
      // and genuinely identical errors STILL dedup (policy preserved)
      const h2 = harness(create);
      for (let i = 0; i < 6; i++) h2.t.enqueue(ev({ message: 'm', err_name: 'Error', err_msg: 'same' }));
      expect(h2.t.stats().queued).toBe(5);
      expect(h2.t.stats().droppedDedup).toBe(1);
    },
  },
];

// ============================================================================
// Browser surfaces
// ============================================================================
const BROWSER_SURFACES: Array<{ name: string; create: CreateTransport; geh: typeof syncCalGEH }> = [
  { name: 'sync-calender admin SPA', create: syncCalTransport, geh: syncCalGEH },
  { name: 'deadline-confirm admin SPA', create: deadlineTransport, geh: deadlineGEH },
  { name: 'telemetry-dashboard client', create: telemetryTransport, geh: telemetryGEH },
];

describe('drift — vendored BROWSER copies conform to the transport contract', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const surface of BROWSER_SURFACES) {
    describe(surface.name, () => {
      for (const check of BROWSER_CHECKS) {
        it(check.name, async () => {
          await check.run(surface.create);
        });
      }

      it('globalErrorHandler registers a CAPTURE-PHASE resource error listener', () => {
        const win = fakeTarget();
        const logger = { warn: vi.fn(), error: vi.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        surface.geh(logger as any, { win: win as any });
        const errorListeners = win.listenersFor('error');
        expect(errorListeners.length).toBeGreaterThanOrEqual(1);
        // the resource-failure listener is the capture-phase one (resource errors do not bubble)
        expect(errorListeners.some((l) => l.capture === true)).toBe(true);
        // and the unhandledrejection net is present
        expect(win.listenersFor('unhandledrejection').length).toBeGreaterThanOrEqual(1);
      });
    });
  }
});

// ============================================================================
// Server surfaces
// ============================================================================
interface ServerSink {
  scrubMessage(raw: unknown): string;
  shouldShip(record: unknown, shipLevel?: number): boolean;
  mapRecordToEvent(record: unknown, cfg?: unknown): Record<string, unknown>;
}

const SERVER_SURFACES: Array<{ name: string; mod: ServerSink; srcPath: string }> = [
  { name: 'sync-calender', mod: syncCalServer as unknown as ServerSink, srcPath: 'apps/axis/sync-calender/src/services/axiomServerSink.js' },
  { name: 'deadline-confirm', mod: deadlineServer as unknown as ServerSink, srcPath: 'apps/deadline-confirm/src/helpers/axiomServerSink.js' },
  { name: 'telemetry-dashboard', mod: telemetryServer as unknown as ServerSink, srcPath: 'apps/telemetry-dashboard/src/helpers/axiomServerSink.js' },
];

describe('drift — vendored SERVER sinks conform to the sink contract', () => {
  for (const surface of SERVER_SURFACES) {
    describe(surface.name, () => {
      it('is opts-injected — the sink CODE reads ZERO process.env (comments may mention it)', () => {
        const raw = readFileSync(resolve(REPO, surface.srcPath), 'utf8');
        // Strip block + line comments so the many "NOT process.env" doc comments (which are
        // exactly the point of the opts-injected model) don't false-positive — we assert the
        // executable code never touches process.env.
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code.includes('process.env')).toBe(false);
      });

      it('scrubMessage redacts emails, long token/hex runs (>=16), and digit-runs (>=7), capped 200', () => {
        const { scrubMessage } = surface.mod;
        expect(scrubMessage('contact admin@corp.com now')).toBe('contact [email] now');
        expect(scrubMessage('key abcdef0123456789XYZ done')).toBe('key [redacted] done');
        expect(scrubMessage('id 1234567 ok')).toBe('id [num] ok');
        expect(scrubMessage('word '.repeat(100)).length).toBe(200);
        expect(scrubMessage(undefined)).toBe('');
      });

      it('shouldShip: WARN/ERROR only by default; duplicate drops; alwaysShip bypasses', () => {
        const { shouldShip } = surface.mod;
        expect(shouldShip({ level: 'ERROR' })).toBe(true);
        expect(shouldShip({ level: 'WARN' })).toBe(true);
        expect(shouldShip({ level: 'INFO' })).toBe(false);
        expect(shouldShip({ level: 'DEBUG' })).toBe(false);
        expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
        expect(shouldShip(null)).toBe(false);
        expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
      });

      it('mapRecordToEvent: kind defaults to error; domainKind wins; err.message ships ONLY scrubbed', () => {
        const { mapRecordToEvent } = surface.mod;
        const plain = mapRecordToEvent({ level: 'ERROR', message: 'boom' });
        expect(plain.level).toBe('error');
        expect(plain.kind).toBe('error');
        const usage = mapRecordToEvent({ level: 'INFO', message: 'x', domainKind: 'usage' });
        expect(usage.kind).toBe('usage');
        const err = Object.assign(new Error('user admin@corp.com id 12345678 failed'), { errorCode: 'ComplexityException' });
        err.stack = 'Error: ...\n    at run (svc.js:10:5)';
        const mapped = mapRecordToEvent({ level: 'ERROR', message: 'op_failed', error: err });
        expect(mapped.err_name).toBe('Error');
        expect(mapped.err_code).toBe('ComplexityException');
        expect(mapped.stack1).toBe('at run (svc.js:10:5)');
        expect(mapped.err_msg).toContain('[email]');
        expect(mapped.err_msg).toContain('[num]');
        expect(JSON.stringify(mapped)).not.toContain('admin@corp.com');
      });

      it('CTX_ALLOW: short ids/counters ship; free-form (title/email/nested) stays local', () => {
        const { mapRecordToEvent } = surface.mod;
        const mapped = mapRecordToEvent({
          level: 'ERROR', message: 'm',
          context: { ms: 42, board: 'b1', title: 'secret title', email: 'a@b.co', nested: { x: 1 } },
        });
        expect(mapped.ms).toBe(42);
        expect(mapped.board).toBe('b1');
        for (const k of ['title', 'email', 'nested']) expect(k in mapped).toBe(false);
      });
    });
  }
});

// ============================================================================
// RED-GATE — prove the browser contract can FAIL (test/RED-GATE-LOG.md)
// ============================================================================

/** A deliberately-broken in-memory transport: OLD level|tag|message dedup (no fix5) and
 *  NO droppedShipFailure accounting (no fix1). Passes the gate + is otherwise plausible. */
function makeBrokenTransport(opts: { dataset?: string; token?: string; fetchFn?: (u: string, i: unknown) => Promise<{ ok: boolean; status: number }>; [k: string]: unknown }): unknown {
  if (!opts.dataset || !opts.token) {
    return {
      enqueue() {}, setContext() {}, flush() {}, dispose() {},
      stats: () => ({ enabled: false, queued: 0, shipped: 0, droppedQueue: 0, droppedDedup: 0, droppedSessionCap: 0, droppedShipFailure: 0, breakerState: 'closed', consecutiveFailures: 0 }),
    };
  }
  const queue: Array<Record<string, unknown>> = [];
  const dedup = new Map<string, number>();
  let droppedDedup = 0;
  let shipped = 0;
  const fetchFn = opts.fetchFn!;
  return {
    enqueue(e: Record<string, unknown>) {
      const key = `${e.level}|${e.tag}|${e.message}`; // OLD key — no err_name/err_msg
      const n = dedup.get(key) ?? 0;
      if (n >= 5) { droppedDedup++; return; }
      dedup.set(key, n + 1);
      queue.push(e);
    },
    setContext() {},
    async flush() {
      const batch = queue.splice(0);
      if (batch.length === 0) return;
      try {
        const r = await fetchFn('u', { body: JSON.stringify(batch) });
        if (r.ok) shipped += batch.length;
        // NOTE: no droppedShipFailure accounting on failure (the fix1 gap)
      } catch { /* swallowed — the fix1 gap */ }
    },
    stats: () => ({ enabled: true, queued: queue.length, shipped, droppedQueue: 0, droppedDedup, droppedSessionCap: 0, droppedShipFailure: 0, breakerState: 'closed', consecutiveFailures: 0 }),
    dispose() {},
  };
}

describe('drift — RED-GATE: the browser contract rejects a deliberately-broken transport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('at least 2 contract checks FAIL against the broken variant', async () => {
    let failures = 0;
    for (const check of BROWSER_CHECKS) {
      try {
        await check.run(makeBrokenTransport as unknown as CreateTransport);
      } catch {
        failures++; // an assertion (or a missing method) threw — the check rejected the drift
      }
    }
    expect(failures).toBeGreaterThanOrEqual(2);
  });
});

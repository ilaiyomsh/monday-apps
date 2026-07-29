// test-guard gate for the 5 hardening fixes ported into the vendored browser
// transport from the canonical error-kit source (packages/error-kit/src/browser/
// axiomTransport.ts): (1) droppedShipFailure counter, (2) terminal keepalive flush
// while the breaker is OPEN, (3+4) extended `stack` + `component_stack` allowlist
// keys, (5) dedup key that includes err_name + err_msg.

import { describe, it, expect, vi } from 'vitest';
import { createAxiomBrowserTransport, type TransportOptions } from './axiomBrowserTransport';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeTarget() {
  return { addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

interface Harness {
  fetchFn: ReturnType<typeof vi.fn>;
  bodies: string[];
}

function make(
  opts: Partial<TransportOptions> & { ok?: boolean; status?: number } = {},
): { transport: ReturnType<typeof createAxiomBrowserTransport> } & Harness {
  const bodies: string[] = [];
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  const fetchFn = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(String(init.body));
    return { ok, status } as unknown as Response;
  });
  const win = fakeTarget() as unknown as Window;
  const doc = { ...fakeTarget(), visibilityState: 'visible' } as unknown as Document;
  const transport = createAxiomBrowserTransport({
    dataset: 'd',
    token: 'tk',
    app: opts.app ?? `unit-${Math.random().toString(36).slice(2)}`,
    fetchFn: fetchFn as unknown as TransportOptions['fetchFn'],
    win,
    doc,
    caps: { flushIntervalMs: 100000, ...(opts.caps ?? {}) },
  });
  return { transport, fetchFn, bodies };
}

describe('transport fix 1 — droppedShipFailure', () => {
  it('counts events lost to a failed POST in stats().droppedShipFailure', async () => {
    const { transport } = make({ ok: false, status: 500 });
    transport.enqueue({ level: 'error', tag: 'x', message: 'm' });
    transport.flush('manual');
    await tick();
    await tick();
    expect(transport.stats().droppedShipFailure).toBe(1);
    expect(transport.stats().shipped).toBe(0);
  });

  it('reports droppedShipFailure: 0 on the inert (no dataset) handle', () => {
    const t = createAxiomBrowserTransport({ dataset: '', token: '', app: 'inert' });
    expect(t.stats().droppedShipFailure).toBe(0);
    expect(t.stats().enabled).toBe(false);
  });
});

describe('transport fix 2 — terminal keepalive flush while the breaker is OPEN', () => {
  it("attempts one send on a 'hidden' flush even after the breaker opened", async () => {
    const { transport, fetchFn } = make({ ok: false, status: 500, caps: { breakerFailureThreshold: 1 } });
    transport.enqueue({ level: 'error', tag: 'x', message: 'm1' });
    transport.flush('manual');
    await tick();
    await tick();
    expect(transport.stats().breakerState).toBe('open');

    const before = fetchFn.mock.calls.length;
    transport.enqueue({ level: 'error', tag: 'x', message: 'm2' });
    transport.flush('hidden'); // terminal path: last chance before the tab is gone
    await tick();
    await tick();
    expect(fetchFn.mock.calls.length).toBe(before + 1);
  });

  it("a routine 'manual' flush while OPEN sends nothing (breaker still closed to routine traffic)", async () => {
    const { transport, fetchFn } = make({ ok: false, status: 500, caps: { breakerFailureThreshold: 1 } });
    transport.enqueue({ level: 'error', tag: 'x', message: 'm1' });
    transport.flush('manual');
    await tick();
    await tick();
    const before = fetchFn.mock.calls.length;

    transport.enqueue({ level: 'error', tag: 'x', message: 'm2' });
    transport.flush('manual');
    await tick();
    await tick();
    expect(fetchFn.mock.calls.length).toBe(before);
  });
});

describe('transport fix 3/4 — extended stack + component_stack are allowlisted (shipped)', () => {
  it('passes through `stack` and `component_stack` into the posted envelope', async () => {
    const { transport, bodies } = make();
    transport.enqueue({
      level: 'error',
      tag: 'x',
      message: 'm',
      stack: 'at a\nat b\nat c',
      component_stack: 'in <Comp>',
    });
    transport.flush('manual');
    await tick();
    await tick();
    const ev = JSON.parse(bodies[0])[0];
    expect(ev.stack).toBe('at a\nat b\nat c');
    expect(ev.component_stack).toBe('in <Comp>');
  });
});

describe('transport fix 5 — dedup key includes err_name + err_msg', () => {
  it('two records with the same level|tag|message but DIFFERENT err_msg both ship (not deduped)', async () => {
    const { transport } = make({ caps: { dedupMaxPerWindow: 1 } });
    transport.enqueue({ level: 'error', tag: 'api', message: 'request failed', err_name: 'ApiError', err_msg: 'AAA' });
    transport.enqueue({ level: 'error', tag: 'api', message: 'request failed', err_name: 'ApiError', err_msg: 'BBB' });
    transport.flush('manual');
    await tick();
    await tick();
    expect(transport.stats().droppedDedup).toBe(0);
    expect(transport.stats().shipped).toBe(2);
  });

  it('identical records (same err_msg) still dedup within the window', async () => {
    const { transport } = make({ caps: { dedupMaxPerWindow: 1 } });
    transport.enqueue({ level: 'error', tag: 'api', message: 'request failed', err_name: 'ApiError', err_msg: 'AAA' });
    transport.enqueue({ level: 'error', tag: 'api', message: 'request failed', err_name: 'ApiError', err_msg: 'AAA' });
    transport.flush('manual');
    await tick();
    await tick();
    expect(transport.stats().droppedDedup).toBe(1);
    expect(transport.stats().shipped).toBe(1);
  });
});

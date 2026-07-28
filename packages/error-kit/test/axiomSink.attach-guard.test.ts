/**
 * Constructor-path coverage for errors/axiomSink.ts (the main suite injects `transport:`
 * and never hits the constructor — the gap the review flagged).
 *
 * The mock MODELS the real registry behavior: createAxiomBrowserTransport disposes any
 * transport already registered for the app (REG[app]) before returning a new one. That is
 * exactly what makes attach-guard ORDERING matter — so the `disposed` assertions below are
 * only meaningful because the mock reproduces it.
 *
 *   - guard BEFORE construct: a second attach must NOT construct (and therefore must not
 *     dispose the live transport).
 *   - teardown disposes the transport the sink OWNS (constructed), unlike a borrowed one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { created, byApp } = vi.hoisted(() => ({
  created: [] as Array<{ app: string; disposed: boolean }>,
  byApp: new Map<string, { app: string; disposed: boolean; dispose: () => void }>(),
}));

vi.mock('../src/browser/axiomTransport', () => ({
  createAxiomBrowserTransport: vi.fn((opts: { app: string }) => {
    byApp.get(opts.app)?.dispose(); // REAL REG behavior: constructing replaces + disposes the prior
    const handle = {
      app: opts.app,
      disposed: false,
      enqueue() {},
      setContext() {},
      flush() {},
      stats: () => ({
        enabled: true, queued: 0, shipped: 0, droppedQueue: 0,
        droppedDedup: 0, droppedSessionCap: 0, breakerState: 'closed' as const, consecutiveFailures: 0,
      }),
      dispose() { this.disposed = true; if (byApp.get(opts.app) === this) byApp.delete(opts.app); },
    };
    byApp.set(opts.app, handle);
    created.push(handle);
    return handle;
  }),
}));

import { attachAxiomSink } from '../src/browser/axiomSink';
import { createAxiomBrowserTransport } from '../src/browser/axiomTransport';
import type { Logger, LogRecord } from '../src/types';

function fakeLogger(): Logger {
  const sinks: Array<(r: LogRecord) => void> = [];
  return {
    getBuffer: () => [],
    addSink: (s: (r: LogRecord) => void) => { sinks.push(s); return () => {}; },
  } as unknown as Logger;
}

beforeEach(() => {
  created.length = 0;
  byApp.clear();
  (globalThis as { __AXIS_AXIOM_SINK_ATTACHED__?: boolean }).__AXIS_AXIOM_SINK_ATTACHED__ = false;
  vi.clearAllMocks();
});

describe('attachAxiomSink — guard precedes transport construction', () => {
  it('constructs exactly once across a double attach, never disposing the live transport', () => {
    const logger = fakeLogger();
    attachAxiomSink(logger, { app: 'a', dataset: 'd', token: 't', active: true });
    attachAxiomSink(logger, { app: 'a', dataset: 'd', token: 't', active: true }); // guarded: must NOT construct
    expect(createAxiomBrowserTransport).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    // Meaningful because the mock disposes-on-replace: a construct-before-guard bug would
    // have run a 2nd construct here and disposed created[0].
    expect(created[0].disposed).toBe(false);
  });

  it('teardown disposes the transport the sink constructed (owned)', () => {
    const logger = fakeLogger();
    const off = attachAxiomSink(logger, { app: 'b', dataset: 'd', token: 't', active: true });
    expect(created).toHaveLength(1);
    expect(created[0].disposed).toBe(false);
    off();
    expect(created[0].disposed).toBe(true);
  });
});

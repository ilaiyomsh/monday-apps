/**
 * axiomSink.test.ts — the shared app-core Axiom sink (errors/axiomSink.ts).
 * Mirrors the coverage of tracker's axiomSink.test.js, adapted to app-core's
 * LogRecord shape. Node env, injected transport + fake logger seams — no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldShip,
  mapRecordToEvent,
  attachAxiomSink,
  setAxiomContext,
  setRemoteLevel,
} from '../src/errors/axiomSink';
import type { AxiomTransport, AxiomEventInput } from '../src/axiomTransport';
import type { LogRecord, Logger } from '../src/logger';

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 'ERROR',
    module: 'app',
    message: 'event_id',
    timestamp: 0,
    timestampISO: '2026-07-11T00:00:00.000Z',
    ...over,
  };
}

function fakeTransport() {
  const enqueued: AxiomEventInput[] = [];
  const contexts: Array<Record<string, unknown>> = [];
  const t: AxiomTransport = {
    enqueue: (e) => enqueued.push(e),
    setContext: (c) => contexts.push(c),
    flush: () => {},
    stats: () => ({
      enabled: true, queued: 0, shipped: enqueued.length, droppedQueue: 0,
      droppedDedup: 0, droppedSessionCap: 0, breakerState: 'closed', consecutiveFailures: 0,
    }),
    dispose: () => {},
  };
  return { t, enqueued, contexts };
}

function fakeLogger(buffer: LogRecord[] = []) {
  const sinks: Array<(r: LogRecord) => void> = [];
  const logger = {
    getBuffer: () => [...buffer],
    addSink: (s: (r: LogRecord) => void) => {
      sinks.push(s);
      return () => {
        const i = sinks.indexOf(s);
        if (i >= 0) sinks.splice(i, 1);
      };
    },
  } as unknown as Logger;
  const emit = (r: LogRecord) => sinks.forEach((s) => s(r));
  return { logger, emit, sinks };
}

beforeEach(() => {
  // reset the HMR guard + incident level between tests
  (globalThis as { __AXIS_AXIOM_SINK_ATTACHED__?: boolean }).__AXIS_AXIOM_SINK_ATTACHED__ = false;
  setRemoteLevel(null);
});

describe('shouldShip — level policy', () => {
  it('ships ERROR and WARN by default', () => {
    expect(shouldShip(rec({ level: 'ERROR' }))).toBe(true);
    expect(shouldShip(rec({ level: 'WARN' }))).toBe(true);
  });
  it('drops INFO and DEBUG by default', () => {
    expect(shouldShip(rec({ level: 'INFO' }))).toBe(false);
    expect(shouldShip(rec({ level: 'DEBUG' }))).toBe(false);
  });
  it('drops duplicates regardless of level', () => {
    expect(shouldShip(rec({ level: 'ERROR', duplicate: true }))).toBe(false);
  });
  it('incident override ships lower levels by rank', () => {
    expect(shouldShip(rec({ level: 'INFO' }), 'INFO')).toBe(true);
    expect(shouldShip(rec({ level: 'DEBUG' }), 'INFO')).toBe(false);
    expect(shouldShip(rec({ level: 'DEBUG' }), 'DEBUG')).toBe(true);
  });
});

describe('mapRecordToEvent — allowlisted mapping', () => {
  it('maps level/tag/message + corr', () => {
    const ev = mapRecordToEvent(rec({ level: 'ERROR', module: 'API', message: 'boom', correlationId: 7 }));
    expect(ev).toMatchObject({ level: 'error', tag: 'api', message: 'boom', corr: '7' });
  });
  it('extracts err_name / err_code / stack1 from the error', () => {
    const err = Object.assign(new Error('secret detail'), { errorCode: 'ComplexityException' });
    err.stack = 'Error: secret detail\n    at foo (bar.js:1:1)';
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.err_name).toBe('Error');
    expect(ev.err_code).toBe('ComplexityException');
    expect(ev.stack1).toBe('at foo (bar.js:1:1)');
  });
  it('NEVER copies record.data, record.context payloads, or error.message', () => {
    const err = Object.assign(new Error('mail admin@x.co bounced'), { code: 500 });
    const ev = mapRecordToEvent(
      rec({ error: err, data: { secret: 'x' }, context: { query: 'q', variables: { a: 1 }, duration: 12 } }),
    );
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain('admin@x.co');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('variables');
    expect(ev.ms).toBe(12); // numeric timing IS allowed
    expect(ev.err_code).toBe('500');
  });
  it('prefers a V8 frame over an @-containing message line', () => {
    const err = Object.assign(new Error('x'), { stack: 'Error: mail a@b.co\n    at run (z.js:2:3)' });
    expect(mapRecordToEvent(rec({ error: err })).stack1).toBe('at run (z.js:2:3)');
  });
});

describe('attachAxiomSink', () => {
  it('is a no-op when inactive (no dataset/token in a non-prod build)', () => {
    const { t, enqueued } = fakeTransport();
    const { logger, emit } = fakeLogger([rec()]);
    const off = attachAxiomSink(logger, { app: 'day-off', transport: t }); // active resolves false
    emit(rec({ level: 'ERROR', message: 'live' }));
    expect(enqueued).toHaveLength(0);
    off();
  });

  it('replays the ring buffer then ships live ERROR/WARN records when active', () => {
    const { t, enqueued } = fakeTransport();
    const buffered = [rec({ message: 'buffered_error' }), rec({ level: 'DEBUG', message: 'buffered_debug' })];
    const { logger, emit } = fakeLogger(buffered);
    const off = attachAxiomSink(logger, { app: 'day-off', dataset: 'app-errors', token: 'tok', active: true, transport: t });
    // only the buffered ERROR replays (DEBUG dropped by shouldShip)
    expect(enqueued.map((e) => e.message)).toEqual(['buffered_error']);
    emit(rec({ level: 'WARN', message: 'live_warn' }));
    emit(rec({ level: 'INFO', message: 'live_info' }));
    expect(enqueued.map((e) => e.message)).toEqual(['buffered_error', 'live_warn']);
    off();
  });

  it('HMR guard prevents a second attach from double-shipping', () => {
    const { t, enqueued } = fakeTransport();
    const { logger, emit } = fakeLogger();
    const off1 = attachAxiomSink(logger, { app: 'a', active: true, transport: t });
    const off2 = attachAxiomSink(logger, { app: 'a', active: true, transport: t }); // guarded no-op
    emit(rec({ message: 'once' }));
    expect(enqueued).toHaveLength(1);
    off2();
    off1();
  });

  it('sink failures never throw to the logger (suppressed)', () => {
    const throwing: AxiomTransport = { ...fakeTransport().t, enqueue: () => { throw new Error('boom'); } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger, emit } = fakeLogger();
    const off = attachAxiomSink(logger, { app: 'a', active: true, transport: throwing });
    expect(() => emit(rec({ message: 'x' }))).not.toThrow();
    spy.mockRestore();
    off();
  });
});

describe('setAxiomContext', () => {
  it('maps ids to acc/usr/obj/board and prefers instanceId for obj', () => {
    const { t, contexts } = fakeTransport();
    setAxiomContext({ accountId: 1, userId: 2, boardId: 3, instanceId: 9 }, { transport: t });
    expect(contexts[0]).toEqual({ acc: 1, usr: 2, obj: 9, board: 3 });
  });
  it('falls back to boardId for obj when no instanceId', () => {
    const { t, contexts } = fakeTransport();
    setAxiomContext({ boardId: 3 }, { transport: t });
    expect(contexts[0]).toMatchObject({ obj: 3, board: 3 });
  });
});

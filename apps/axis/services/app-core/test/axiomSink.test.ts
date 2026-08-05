/**
 * axiomSink.test.ts — the shared app-core Axiom sink (errors/axiomSink.ts).
 * Mirrors the coverage of tracker's axiomSink.test.js, adapted to app-core's
 * LogRecord shape. Node env, injected transport + fake logger seams — no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldShip,
  mapRecordToEvent,
  scrubMessage,
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
  it('alwaysShip records ship even at INFO/DEBUG (usage/health)', () => {
    expect(shouldShip(rec({ level: 'INFO', alwaysShip: true }))).toBe(true);
    expect(shouldShip(rec({ level: 'DEBUG', alwaysShip: true }))).toBe(true);
  });
  it('alwaysShip never overrides the duplicate drop', () => {
    expect(shouldShip(rec({ level: 'INFO', alwaysShip: true, duplicate: true }))).toBe(false);
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
  it('does NOT treat an @-message line as a frame when there is no real frame (no leak)', () => {
    // stackTraceLimit=0 / wrapped-error style: an email in the message, NO `at ` frame and
    // NO `name@url:line:col` frame → stack1 must be undefined and never echo error.message.
    const err = Object.assign(new Error('contact admin@corp.com to reset'), {
      stack: 'Error: contact admin@corp.com to reset',
    });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.stack1).toBeUndefined();
    expect(JSON.stringify(ev)).not.toContain('admin@corp.com');
  });
  it('does NOT leak a frame-less @-message that ends in :<digits> (status code / port)', () => {
    // The subtle case: an email in the message AND a trailing ':500'. Still rejected because a
    // real frame has NO whitespace before '@' (regression for the incomplete first fix).
    const err = Object.assign(new Error('fetch to api@v2.example.com failed with status:500'), {
      stack: 'TypeError: fetch to api@v2.example.com failed with status:500',
    });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.stack1).toBeUndefined();
    expect(JSON.stringify(ev)).not.toContain('api@v2.example.com');
  });
  it('accepts a Firefox/Safari name@url:line:col frame as stack1', () => {
    const err = Object.assign(new Error('boom'), {
      stack: 'run@https://app.example.com/main.js:12:34\nload@https://app.example.com/main.js:5:6',
    });
    expect(mapRecordToEvent(rec({ error: err })).stack1).toBe('run@https://app.example.com/main.js:12:34');
  });
  it('stamps kind — default "error", or the record kind (usage/health)', () => {
    expect(mapRecordToEvent(rec()).kind).toBe('error');
    expect(mapRecordToEvent(rec({ level: 'INFO', kind: 'usage' })).kind).toBe('usage');
    expect(mapRecordToEvent(rec({ level: 'INFO', kind: 'health' })).kind).toBe('health');
  });
  it('ships error.message ONLY scrubbed, as err_msg (email/token/digits redacted)', () => {
    const err = Object.assign(
      new Error('login failed for admin@corp.com token abcdef0123456789ABCD id 12345678'),
      { stack: 'Error: ...\n    at f (a.js:1:1)' },
    );
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.err_msg).toContain('[email]');
    expect(ev.err_msg).toContain('[redacted]');
    expect(ev.err_msg).toContain('[num]');
    const s = JSON.stringify(ev);
    expect(s).not.toContain('admin@corp.com');
    expect(s).not.toContain('abcdef0123456789ABCD');
    expect(s).not.toContain('12345678');
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

  it('teardown does NOT dispose a borrowed (injected) transport', () => {
    // options.transport is a shared/test seam whose lifecycle the caller owns — the sink
    // constructed nothing, so it must not dispose it. (Owned-transport disposal is covered
    // in axiomSink.attach-guard.test.ts, which exercises the constructor path.)
    const { t } = fakeTransport();
    const disposed = vi.fn();
    t.dispose = disposed;
    const { logger } = fakeLogger();
    const off = attachAxiomSink(logger, { app: 'a', active: true, transport: t });
    off();
    expect(disposed).not.toHaveBeenCalled();
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

describe('scrubMessage', () => {
  it('redacts emails, long token/hex runs (>=16), and digit-runs (>=7)', () => {
    expect(scrubMessage('contact admin@corp.com now')).toBe('contact [email] now');
    expect(scrubMessage('key abcdef0123456789XYZ done')).toBe('key [redacted] done');
    expect(scrubMessage('id 1234567 ok')).toBe('id [num] ok');
  });
  it('runs email before token so the whole address collapses to one [email]', () => {
    expect(scrubMessage('verylonglocalpart1234@example.com')).toBe('[email]');
  });
  it('caps at 200 chars and returns "" for non-strings', () => {
    expect(scrubMessage('word '.repeat(100)).length).toBe(200); // words break token/digit runs
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(123 as unknown)).toBe('');
    expect(scrubMessage('')).toBe('');
  });
});

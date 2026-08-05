// test-guard gate for src/helpers/logger.js — the sink-aware server logger. The
// native writers (info/warn/error/debug, message-first) and the error-kit writers
// (logInfo/logWarn/logError, tag-first) BOTH render a console line and funnel through
// emit() so a single record reaches every sink. Also covers log-once dedup and
// beforeSend. Console is muted; records are captured via a test sink.

import { describe, it, expect, vi, afterEach } from 'vitest';
import logger, { emit, addSink, removeSink, setBeforeSend } from '../src/helpers/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
  setBeforeSend(); // reset to identity
});

/** Capture every record fanned out to sinks while fn() runs (console muted). */
function capture(fn) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const records = [];
  const unsub = addSink((r) => records.push(r));
  try {
    fn();
  } finally {
    unsub();
  }
  return records;
}

describe('native writers (message, tag, context)', () => {
  it('error() renders a stderr line AND emits an ERROR record with tag+message+context', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const records = [];
    const unsub = addSink((r) => records.push(r));
    logger.error('boom', 'guard', { boardId: '5' });
    unsub();

    expect(errSpy).toHaveBeenCalledTimes(1); // console line for mapps code:logs
    const rec = records.find((r) => r.message === 'boom');
    expect(rec.level).toBe('ERROR');
    expect(rec.tag).toBe('guard');
    expect(rec.context).toEqual({ boardId: '5' });
  });

  it('info() emits an INFO record (uppercased level) and writes to stdout not stderr', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const records = [];
    const unsub = addSink((r) => records.push(r));
    logger.info('listening', 'boot', { port: 8080 });
    unsub();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    expect(records.find((r) => r.message === 'listening').level).toBe('INFO');
  });

  it('defaults the tag to "guard" when none is given', () => {
    const recs = capture(() => logger.warn('no-tag'));
    expect(recs.find((r) => r.message === 'no-tag').tag).toBe('guard');
  });
});

describe('error-kit writers (tag, message, context) — tag FIRST', () => {
  it('logError(tag, message, ctx) emits the same ERROR record shape as error()', () => {
    const recs = capture(() => logger.logError('server', 'uncaught exception', { error: new Error('x') }));
    const rec = recs.find((r) => r.message === 'uncaught exception');
    expect(rec.level).toBe('ERROR');
    expect(rec.tag).toBe('server');
  });

  it('logInfo/logWarn map to INFO/WARN with the tag taken from the FIRST argument', () => {
    const recs = capture(() => {
      logger.logInfo('boot', 'up');
      logger.logWarn('auth', 'rejected');
    });
    expect(recs.find((r) => r.message === 'up')).toMatchObject({ level: 'INFO', tag: 'boot' });
    expect(recs.find((r) => r.message === 'rejected')).toMatchObject({ level: 'WARN', tag: 'auth' });
  });
});

describe('emit — log-once dedup + Error lifting', () => {
  it('lifts an Error out of context and marks the SECOND log of the same Error as duplicate', () => {
    const err = new Error('same');
    const recs = capture(() => {
      logger.error('first', 'guard', { error: err });
      logger.error('second', 'guard', { error: err });
    });
    const first = recs.find((r) => r.message === 'first');
    const second = recs.find((r) => r.message === 'second');
    expect(first.duplicate).toBe(false);
    expect(first.error).toBe(err);       // lifted from context
    // A duplicate is NOT dispatched to sinks — only the first reaches the sink.
    expect(second).toBeUndefined();
  });
});

describe('beforeSend', () => {
  it('a transform can strip a context field before the record reaches the sink', () => {
    setBeforeSend((record) => {
      if (record.context && 'secret' in record.context) {
        record.context = { ...record.context, secret: undefined };
      }
      return record;
    });
    const recs = capture(() => logger.info('x', 'guard', { secret: 'shh', keep: '1' }));
    const rec = recs.find((r) => r.message === 'x');
    expect(rec.context.secret).toBeUndefined();
    expect(rec.context.keep).toBe('1');
  });

  it('a null beforeSend return suppresses the record entirely', () => {
    setBeforeSend(() => null);
    const recs = capture(() => emit({ level: 'ERROR', tag: 'x', message: 'boom' }));
    expect(recs).toHaveLength(0);
  });

  it('a throwing beforeSend is swallowed and the original record still ships', () => {
    setBeforeSend(() => { throw new Error('transform bug'); });
    const recs = capture(() => emit({ level: 'ERROR', tag: 'x', message: 'survives' }));
    expect(recs.find((r) => r.message === 'survives')).toBeTruthy();
  });
});

describe('sink registry isolation', () => {
  it('a throwing sink does not prevent other sinks from receiving the record', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = [];
    const bad = () => { throw new Error('sink down'); };
    const unsubBad = addSink(bad);
    const unsubGood = addSink((r) => good.push(r));
    logger.info('fanned', 'guard');
    unsubBad();
    unsubGood();
    expect(good.find((r) => r.message === 'fanned')).toBeTruthy();
  });

  it('removeSink stops delivery to that sink', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const seen = [];
    const sink = (r) => seen.push(r);
    addSink(sink);
    removeSink(sink);
    logger.info('after-remove', 'guard');
    expect(seen).toHaveLength(0);
  });
});

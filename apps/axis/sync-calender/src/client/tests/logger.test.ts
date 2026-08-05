import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import logger, { encodeDims, getBuffer, addSink, type LogRecord } from '../admin/lib/logger';

describe('logger.error / warn', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits an ERROR record carrying the thrown error, domainKind error, and context', () => {
    const seen: LogRecord[] = [];
    const off = addSink((r) => seen.push(r));
    const err = new Error('boom');
    logger.error('mymod', 'op_failed', err, { componentStack: 'at Foo' });
    off();
    const rec = seen.at(-1)!;
    expect(rec.level).toBe('ERROR');
    expect(rec.module).toBe('mymod');
    expect(rec.message).toBe('op_failed');
    expect(rec.domainKind).toBe('error');
    expect(rec.error).toBe(err);
    expect(rec.context).toEqual({ componentStack: 'at Foo' });
  });

  it('emits a WARN record at level WARN', () => {
    const seen: LogRecord[] = [];
    const off = addSink((r) => seen.push(r));
    logger.warn('mymod', 'soft', { url: 'x' });
    off();
    expect(seen.at(-1)!.level).toBe('WARN');
  });
});

describe('logger.getBuffer ring buffer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('bounds the buffer to 50 records, dropping the oldest', () => {
    for (let i = 0; i < 60; i++) logger.debug('b', `b${i}`);
    const buf = getBuffer();
    expect(buf.length).toBe(50);
    expect(buf[buf.length - 1].message).toBe('b59'); // newest kept
    expect(buf[0].message).toBe('b10'); // oldest surviving = 60 - 50
    expect(buf.some((r) => r.message === 'b9')).toBe(false); // b0..b9 dropped
  });

  it('returns a COPY (mutating the result does not corrupt the buffer)', () => {
    const a = getBuffer();
    a.push({ level: 'ERROR', module: 'x', message: 'injected', timestamp: 0 });
    const b = getBuffer();
    expect(b.some((r) => r.message === 'injected')).toBe(false);
  });
});

describe('logger.track / health', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('track emits an INFO usage record with alwaysShip and dims folded into the message', () => {
    const seen: LogRecord[] = [];
    const off = addSink((r) => seen.push(r));
    logger.track('view', { tab: 'setup' });
    off();
    const rec = seen.at(-1)!;
    expect(rec.level).toBe('INFO');
    expect(rec.module).toBe('usage');
    expect(rec.domainKind).toBe('usage');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('view tab=setup');
  });

  it('health emits an INFO health record with domainKind health and alwaysShip', () => {
    const seen: LogRecord[] = [];
    const off = addSink((r) => seen.push(r));
    logger.health('boot', { ms: 12 });
    off();
    const rec = seen.at(-1)!;
    expect(rec.domainKind).toBe('health');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('boot ms=12');
  });
});

describe('logger.addSink', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('unsubscribe stops further delivery to that sink', () => {
    const fn = vi.fn();
    const off = addSink(fn);
    logger.track('a');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    logger.track('b');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('encodeDims', () => {
  it('sorts keys ascending and drops non-primitive values', () => {
    expect(encodeDims('base', { b: 2, a: 'x', c: {}, d: true })).toBe('base a=x b=2 d=true');
  });

  it('returns the base unchanged when there are no dims', () => {
    expect(encodeDims('base')).toBe('base');
  });
});

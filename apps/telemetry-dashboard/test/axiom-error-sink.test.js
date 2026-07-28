// test-guard gate for src/client/utils/axiomErrorSink.ts — the vendored record→envelope +
// privacy layer for the dashboard client. Plain JS (not TS) because this app's vitest config
// collects test/**/*.test.js only; vitest still transforms the imported .ts module.
//
// Until now this copy had NO local suite — only packages/error-kit/test/drift.test.ts covered
// it, from another package. That is what let audit finding 6 sit here: err_name was assigned
// without String(), and drift's own check asserted String(mapped.err_name), so coercing in
// the test hid the missing coercion in the source.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldShip, scrubMessage, mapRecordToEvent, attachAxiomSink } from '../src/client/utils/axiomErrorSink.ts';

const record = (over = {}) => ({ level: 'ERROR', module: 'svc', message: 'op_failed', ...over });

describe('mapRecordToEvent — err_name is the discriminator and must survive', () => {
  it('keeps a real Error name', () => {
    expect(mapRecordToEvent(record({ error: new TypeError('x') })).err_name).toBe('TypeError');
  });

  // Audit finding 6. The generic-name fallback below the assignment guards with
  // `typeof ev.err_name === 'string'`, so a NON-STRING name fails that check and the stable
  // logger message overwrites the real discriminator. The transport's dedup key reads
  // err_name the same guarded way, so distinct errors collapse under one key and after
  // dedupMaxPerWindow (5) in 60s the rest are silently dropped.
  it('coerces a non-string err.name instead of losing it to the generic message', () => {
    const mapped = mapRecordToEvent(record({ error: { name: 500, message: 'upstream exploded' } }));
    expect(typeof mapped.err_name).toBe('string');
    expect(mapped.err_name).toBe('500');
    expect(mapped.err_name).not.toBe('op_failed');
  });

  it('keeps two distinct non-string names distinct (one dedup key per error)', () => {
    const a = mapRecordToEvent(record({ error: { name: 500, message: 'a' } }));
    const b = mapRecordToEvent(record({ error: { name: 503, message: 'b' } }));
    expect(a.err_name).not.toBe(b.err_name);
  });

  it('falls back message → tag → unknown when there is no Error at all', () => {
    expect(mapRecordToEvent(record({ message: 'Uncaught error' })).err_name).toBe('Uncaught error');
    expect(mapRecordToEvent(record({ module: 'boot', message: '' })).err_name).toBe('boot');
    expect(mapRecordToEvent(record({ module: '   ', message: '  ' })).err_name).toBe('unknown');
  });
});

describe('mapRecordToEvent — privacy: the raw error.message never ships', () => {
  it('ships err_msg SCRUBBED, with no raw PII anywhere in the envelope', () => {
    const err = new Error('user admin@corp.com id 12345678 failed');
    const mapped = mapRecordToEvent(record({ error: err }));
    expect(mapped.err_msg).toContain('[email]');
    expect(mapped.err_msg).toContain('[num]');
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain('admin@corp.com');
    expect(serialized).not.toContain('12345678');
  });

  it('never copies record.data', () => {
    const mapped = mapRecordToEvent(record({ data: { secretish: 'do-not-ship-me' } }));
    expect(JSON.stringify(mapped)).not.toContain('do-not-ship-me');
  });

  it('ships the stable message event-id as-is', () => {
    expect(mapRecordToEvent(record()).message).toBe('op_failed');
  });
});

describe('scrubMessage — redaction spec (emails / tokens>=16 / digit-runs>=7), cap 200', () => {
  it('redacts emails, long token runs and long digit runs', () => {
    expect(scrubMessage('ping a@b.co')).toContain('[email]');
    expect(scrubMessage('tok abcdef0123456789abcdef')).toContain('[redacted]');
    expect(scrubMessage('id 1234567')).toContain('[num]');
  });

  it('leaves a short digit run alone (boundary: 6 digits)', () => {
    expect(scrubMessage('id 123456')).toBe('id 123456');
  });

  it('caps at 200 characters', () => {
    // Short whitespace-separated tokens on purpose: one long unbroken run would be eaten by
    // the >=16-char token rule and collapse to '[redacted]' before the cap ever applied.
    expect(scrubMessage('ab '.repeat(200))).toHaveLength(200);
  });

  it('returns empty string for non-strings', () => {
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(42)).toBe('');
  });
});

describe('shouldShip — WARN/ERROR policy, duplicate drop, alwaysShip bypass', () => {
  it('ships ERROR and WARN, drops INFO and DEBUG', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'DEBUG' })).toBe(false);
  });

  it('never ships a duplicate, even at ERROR (log-once)', () => {
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
  });

  it('lets alwaysShip bypass the level policy', () => {
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
  });

  it('drops a nullish record rather than throwing', () => {
    expect(shouldShip(null)).toBe(false);
    expect(shouldShip(undefined)).toBe(false);
  });
});

// Audit finding 5: the teardown returned by attachAxiomSink was just logger.addSink's raw
// unsubscribe. It left the global attach guard SET, so every later attach hit the guard and
// became a permanent no-op — remote logging was gone for the rest of the session — and it
// never disposed the transport, so the flush timer plus the visibility/pagehide listeners
// kept running on a transport nobody fed.
//
// Ownership is the subtlety: a transport this module BUILT is ours to dispose, while one
// handed in by a caller is not (its lifecycle belongs to them). The `create` seam exists so
// the owned path is testable — under vitest the activation gate is false, so the module's
// own transport is null and the owned branch would otherwise be unreachable.
describe('attachAxiomSink teardown — releases the guard and the transport it owns', () => {
  function fakeTransport() {
    return {
      enqueue: vi.fn(),
      setContext: vi.fn(),
      flush: vi.fn(),
      stats: vi.fn(() => ({})),
      dispose: vi.fn(),
    };
  }

  /** A logger double exposing just the surface attachAxiomSink touches. */
  function fakeLogger(buffer = []) {
    const sinks = new Set();
    return {
      getBuffer: () => buffer,
      addSink: (fn) => {
        sinks.add(fn);
        return () => sinks.delete(fn);
      },
      emit: (record) => sinks.forEach((fn) => fn(record)),
      sinkCount: () => sinks.size,
    };
  }

  const shippable = { level: 'ERROR', module: 'svc', message: 'boom' };

  // Two pieces of module state outlive a test: the globalThis attach guard, and the
  // module's own transport slot. Leaving either set meant the next attach reused a stale
  // transport instead of calling create() — so tests asserted on the wrong spy. Every
  // attachment is registered and torn down.
  const teardowns = [];
  const attach = (opts) => {
    const fn = attachAxiomSink(opts);
    teardowns.push(fn);
    return fn;
  };

  beforeEach(() => {
    delete globalThis.__ERROR_GUARD_AXIOM_SINK_ATTACHED__;
  });

  afterEach(() => {
    // Teardown is idempotent, so re-running one a test already called is safe.
    while (teardowns.length > 0) teardowns.pop()();
    delete globalThis.__ERROR_GUARD_AXIOM_SINK_ATTACHED__;
  });

  it('disposes the transport it built, so the flush timer and listeners stop', () => {
    const t = fakeTransport();
    const log = fakeLogger();
    attach({ log, create: () => t })();
    expect(t.dispose).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the sink, so records stop reaching the transport', () => {
    const t = fakeTransport();
    const log = fakeLogger();
    const teardown = attach({ log, create: () => t });

    log.emit(shippable);
    expect(t.enqueue).toHaveBeenCalledTimes(1);

    teardown();
    log.emit(shippable);
    expect(t.enqueue).toHaveBeenCalledTimes(1); // no further ships
    expect(log.sinkCount()).toBe(0);
  });

  it('clears the attach guard, so a later attach really attaches again', () => {
    const first = fakeTransport();
    const log1 = fakeLogger();
    attach({ log: log1, create: () => first })();

    // THE bug: with the guard still set this second attach was a permanent no-op.
    const second = fakeTransport();
    const log2 = fakeLogger();
    attach({ log: log2, create: () => second });
    log2.emit(shippable);

    expect(second.enqueue).toHaveBeenCalledTimes(1);
  });

  it('builds a FRESH transport on re-attach rather than reusing the disposed one', () => {
    const first = fakeTransport();
    const second = fakeTransport();
    const builds = [first, second];

    const log1 = fakeLogger();
    attach({ log: log1, create: () => builds.shift() })();
    const log2 = fakeLogger();
    attach({ log: log2, create: () => builds.shift() });
    log2.emit(shippable);

    expect(second.enqueue).toHaveBeenCalledTimes(1);
    expect(first.enqueue).not.toHaveBeenCalled(); // the disposed one is never fed again
  });

  it('never disposes a BORROWED transport — the caller owns its lifecycle', () => {
    const t = fakeTransport();
    const log = fakeLogger();
    attach({ log, t })();
    expect(t.dispose).not.toHaveBeenCalled();
  });

  it('a second attach while one is live is a no-op that does not tear the live one down', () => {
    const live = fakeTransport();
    const log = fakeLogger();
    attach({ log, create: () => live });

    const intruder = fakeTransport();
    const teardownOfNoop = attach({ log: fakeLogger(), create: () => intruder });
    teardownOfNoop();

    // The live transport must survive the no-op's teardown, and still be fed.
    expect(live.dispose).not.toHaveBeenCalled();
    log.emit(shippable);
    expect(live.enqueue).toHaveBeenCalledTimes(1);
  });

  it('is safe to tear down twice', () => {
    const t = fakeTransport();
    const log = fakeLogger();
    const teardown = attach({ log, create: () => t });
    teardown();
    expect(() => teardown()).not.toThrow();
    expect(t.dispose).toHaveBeenCalledTimes(1);
  });
});

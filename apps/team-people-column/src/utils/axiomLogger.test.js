// axiomLogger.js — the adapter bridging this app's logger.js record shape to
// the `Logger` interface @mapps/error-kit/browser's attachAxiomSink expects.
//
// This app's logger.js uses `record.kind` for the CONSOLE RENDER kind
// ('simple' | 'error' | 'api' | ...) and a SEPARATE `record.domainKind` field
// for the Axiom domain discriminator ('usage' | 'health', undefined meaning
// 'error' by convention). The package's mapRecordToEvent reads `record.kind`
// itself as the domain discriminator (app-core's convention). Without this
// adapter, every WARN/DEBUG/INFO record would ship with kind='simple' and
// every usage/health record would ship with kind='simple' instead of
// 'usage'/'health' — silently breaking the Axiom `kind=` dashboard filter.

import { describe, it, expect, vi } from 'vitest';
import { remapKind, toAxiomLogger } from './axiomLogger';

describe('remapKind', () => {
  it('maps kind -> domainKind when domainKind is set (usage/health records)', () => {
    const rec = { kind: 'simple', domainKind: 'usage', level: 'INFO', module: 'usage', message: 'view_open' };
    expect(remapKind(rec).kind).toBe('usage');

    const rec2 = { kind: 'simple', domainKind: 'health', level: 'INFO', module: 'health', message: 'boot' };
    expect(remapKind(rec2).kind).toBe('health');
  });

  it('defaults kind to "error" when domainKind is absent (plain error/warn/debug/info records)', () => {
    expect(remapKind({ kind: 'error', level: 'ERROR', module: 'x', message: 'boom' }).kind).toBe('error');
    expect(remapKind({ kind: 'simple', level: 'WARN', module: 'x', message: 'careful' }).kind).toBe('error');
    expect(remapKind({ kind: 'apiError', level: 'ERROR', module: 'API', message: 'fn' }).kind).toBe('error');
  });

  it('never mutates the original record (returns a new object)', () => {
    const rec = { kind: 'simple', domainKind: 'usage', level: 'INFO', module: 'usage', message: 'x' };
    const mapped = remapKind(rec);
    expect(mapped).not.toBe(rec);
    expect(rec.kind).toBe('simple'); // original untouched — console rendering must see the render kind
  });

  it('passes through non-kind fields unchanged (level, module, message, error, context, …)', () => {
    const err = new Error('boom');
    const rec = { kind: 'error', level: 'ERROR', module: 'x', message: 'boom', error: err, correlationId: 7 };
    const mapped = remapKind(rec);
    expect(mapped.level).toBe('ERROR');
    expect(mapped.module).toBe('x');
    expect(mapped.message).toBe('boom');
    expect(mapped.error).toBe(err);
    expect(mapped.correlationId).toBe(7);
  });

  it('is a safe no-op on a nullish record', () => {
    expect(remapKind(null)).toBe(null);
    expect(remapKind(undefined)).toBe(undefined);
  });
});

describe('toAxiomLogger', () => {
  it('forwards debug/info/warn/error calls straight to the base logger (same function identity)', () => {
    const base = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getBuffer: vi.fn(() => []), addSink: vi.fn() };
    const view = toAxiomLogger(base);
    view.error('m', 'msg', 'e');
    expect(base.error).toHaveBeenCalledWith('m', 'msg', 'e');
  });

  it('getBuffer() remaps kind on every buffered record', () => {
    const base = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      getBuffer: () => [
        { kind: 'simple', domainKind: 'usage', level: 'INFO', module: 'usage', message: 'a' },
        { kind: 'error', level: 'ERROR', module: 'x', message: 'b' },
      ],
      addSink: vi.fn(),
    };
    const view = toAxiomLogger(base);
    const buf = view.getBuffer();
    expect(buf[0].kind).toBe('usage');
    expect(buf[1].kind).toBe('error');
  });

  it('addSink() wraps the sink so it receives remapped records, and returns the unsubscribe', () => {
    let registered;
    const unsub = vi.fn();
    const base = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getBuffer: vi.fn(() => []),
      addSink: vi.fn((fn) => { registered = fn; return unsub; }),
    };
    const view = toAxiomLogger(base);
    const received = [];
    const returnedUnsub = view.addSink((record) => received.push(record));

    // Simulate the base logger firing a live record through the registered wrapper.
    registered({ kind: 'simple', domainKind: 'health', level: 'INFO', module: 'health', message: 'boot' });

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('health');
    expect(returnedUnsub).toBe(unsub);
  });
});

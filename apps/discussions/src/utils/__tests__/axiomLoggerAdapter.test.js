import { describe, it, expect, vi } from 'vitest';
import { toAxiomRecord, makeAxiomLogger } from '../axiomLoggerAdapter';

// error-kit's Axiom sink reads the DOMAIN discriminator off record.kind, while this app's
// logger carries it as record.domainKind (record.kind is the console-rendering kind). These
// tests lock the bridge that preserves the vendored sink's wire meaning across the migration.

describe('toAxiomRecord', () => {
  it('uses domainKind as kind when present (usage/health records)', () => {
    expect(toAxiomRecord({ level: 'INFO', domainKind: 'usage', kind: 'simple' }).kind).toBe('usage');
    expect(toAxiomRecord({ level: 'INFO', domainKind: 'health', kind: 'simple' }).kind).toBe('health');
  });

  it('falls back to "error" when domainKind is absent, overwriting the rendering kind', () => {
    // a WARN record has rendering kind 'simple' and NO domainKind -> must ship as 'error'
    expect(toAxiomRecord({ level: 'WARN', kind: 'simple' }).kind).toBe('error');
    expect(toAxiomRecord({ level: 'ERROR', kind: 'error' }).kind).toBe('error');
  });

  it('preserves all other fields unchanged', () => {
    const out = toAxiomRecord({ level: 'ERROR', module: 'X', message: 'boom', correlationId: 7, domainKind: 'usage' });
    expect(out.level).toBe('ERROR');
    expect(out.module).toBe('X');
    expect(out.message).toBe('boom');
    expect(out.correlationId).toBe(7);
  });

  it('tolerates a null/undefined record without throwing', () => {
    expect(toAxiomRecord(null).kind).toBe('error');
    expect(toAxiomRecord(undefined).kind).toBe('error');
  });

  it('does not mutate the input record', () => {
    const input = { level: 'INFO', domainKind: 'usage', kind: 'simple' };
    toAxiomRecord(input);
    expect(input.kind).toBe('simple');
  });
});

describe('makeAxiomLogger', () => {
  it('maps every buffered record through toAxiomRecord on getBuffer', () => {
    const base = {
      getBuffer: () => [
        { level: 'WARN', kind: 'simple' },
        { level: 'INFO', domainKind: 'usage', kind: 'simple' },
      ],
      addSink: vi.fn(),
    };
    const buf = makeAxiomLogger(base).getBuffer();
    expect(buf.map((r) => r.kind)).toEqual(['error', 'usage']);
  });

  it('remaps live records before handing them to the wrapped sink', () => {
    let registered;
    const base = {
      getBuffer: () => [],
      addSink: (fn) => { registered = fn; return () => {}; },
    };
    const received = [];
    makeAxiomLogger(base).addSink((r) => received.push(r));
    registered({ level: 'WARN', kind: 'simple' });
    registered({ level: 'INFO', domainKind: 'health', kind: 'simple' });
    expect(received.map((r) => r.kind)).toEqual(['error', 'health']);
  });

  it('returns the wrapped logger unsubscribe from addSink', () => {
    const unsub = () => 'UNSUB';
    const base = { getBuffer: () => [], addSink: () => unsub };
    expect(makeAxiomLogger(base).addSink(() => {})).toBe(unsub);
  });
});

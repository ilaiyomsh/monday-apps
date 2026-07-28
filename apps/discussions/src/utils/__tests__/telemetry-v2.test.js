import { describe, it, expect } from 'vitest';
import logger, { encodeDims } from '../logger';

// Locks the app-OWNED Axiom logging primitives: the usage/health telemetry encoder
// (encodeDims) and the logger.track/health records that carry domainKind + alwaysShip.
//
// The wire-shipping primitives (scrubMessage / shouldShip / mapRecordToEvent) moved to
// the shared @mapps/error-kit/browser package with the migration off the vendored sink;
// they are covered by error-kit's own suite (packages/error-kit/test/axiomSink.test.ts).
// The app-side bridge that keeps domainKind landing on the shipped `kind` field lives in
// src/utils/axiomLoggerAdapter.js and is locked by axiomLoggerAdapter.test.js.

describe('encodeDims', () => {
  it('returns the base unchanged when there are no dims', () => {
    expect(encodeDims('view_open')).toBe('view_open');
  });
  it('folds dims into a sorted key=value suffix', () => {
    expect(encodeDims('e', { b: 2, a: 1 })).toBe('e a=1 b=2');
  });
  it('keeps only string/bool/finite-number values (drops objects/fns/NaN/Infinity)', () => {
    expect(encodeDims('e', { s: 'x', ok: true, n: 3, bad: {}, f: () => {}, nan: NaN, inf: Infinity }))
      .toBe('e n=3 ok=true s=x');
  });
});

describe('logger.track / logger.health', () => {
  const capture = (fn) => {
    const records = [];
    const unsub = logger.addSink((r) => records.push(r));
    fn();
    unsub();
    return records;
  };

  it('track() emits an INFO record with domainKind usage + alwaysShip + encoded message', () => {
    const recs = capture(() => logger.track('view_open', { view: 'x', a: 1 }));
    const rec = recs.find((r) => r.module === 'usage');
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('INFO');
    expect(rec.domainKind).toBe('usage');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('view_open a=1 view=x');
    expect(rec.kind).toBe('simple'); // rendering kind stays 'simple', not a domain value
  });

  it('health() emits an INFO record with domainKind health + alwaysShip', () => {
    const recs = capture(() => logger.health('boot', { ms: 42 }));
    const rec = recs.find((r) => r.module === 'health');
    expect(rec.domainKind).toBe('health');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('boot ms=42');
  });
});


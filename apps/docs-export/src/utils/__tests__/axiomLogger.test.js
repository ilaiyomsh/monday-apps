/**
 * Characterization tests for the Axiom domain-kind adapter.
 *
 * WHY THIS IS THE HIGHEST-VALUE TEST IN THE APP: `remapKind` is the only thing
 * standing between this app's logger.js (where `kind` is the CONSOLE RENDER kind
 * — 'simple' | 'error' | 'api' | 'apiResponse' | 'apiError') and the Axiom
 * `kind=` filter every dashboard is built on ('error' | 'usage' | 'health').
 * If the adapter regresses, NOTHING throws and NOTHING looks broken — the
 * dashboards just quietly stop matching. So the assertions below are on the
 * exact remapped values, never on "it returned something".
 *
 * The toAxiomLogger tests drive the REAL logger.js rather than a hand-built
 * fake, so the record shapes are the ones production actually produces
 * (logger.track/health are the only writers of `domainKind`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { remapKind, toAxiomLogger } from '../axiomLogger';
import logger from '../logger';

describe('remapKind', () => {
  it('keeps kind=usage for a usage record (logger.track shape)', () => {
    const record = {
      kind: 'simple',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message: 'view_open surface=board_view',
    };

    expect(remapKind(record)).toEqual({
      kind: 'usage',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message: 'view_open surface=board_view',
    });
  });

  it('keeps kind=health for a health record (logger.health shape)', () => {
    const record = { kind: 'simple', domainKind: 'health', level: 'INFO', message: 'boot ms=12' };

    expect(remapKind(record).kind).toBe('health');
  });

  it("maps a record with NO domainKind to kind=error, not to its render kind 'simple'", () => {
    const record = { kind: 'simple', level: 'WARN', module: 'Mod', message: 'something_odd' };

    // 'error' by convention — the pre-fix bug shipped 'simple' here, which
    // matches no dashboard filter at all.
    expect(remapKind(record).kind).toBe('error');
  });

  it("maps the 'apiError' render kind to kind=error", () => {
    const record = { kind: 'apiError', level: 'ERROR', module: 'API', message: 'fetchItems' };

    expect(remapKind(record).kind).toBe('error');
  });

  it('treats an explicitly null domainKind as kind=error', () => {
    const record = { kind: 'simple', domainKind: null, level: 'INFO', message: 'x' };

    expect(remapKind(record).kind).toBe('error');
  });

  it('returns a fresh object and leaves the caller-owned record unmutated', () => {
    const record = { kind: 'simple', domainKind: 'usage', message: 'export_clicked' };

    const out = remapKind(record);

    expect(out).not.toBe(record);
    // The real logger keeps this exact object in its ring buffer and hands it to
    // the console renderer and the UI toast sink — mutating it would change what
    // those two see.
    expect(record.kind).toBe('simple');
  });

  it('preserves every other field, including the error instance and diagnostic context', () => {
    const error = new Error('boom');
    const record = {
      kind: 'error',
      level: 'ERROR',
      module: 'Mod',
      message: 'stable_event_id',
      error,
      context: { componentStack: '\n    at Thing' },
      correlationId: 'log_7',
      duplicate: false,
      timestamp: 1753747200000,
      timestampISO: '2025-07-29T00:00:00.000Z',
      consoleEnabled: true,
    };

    const out = remapKind(record);

    expect(out).toEqual({ ...record, kind: 'error' });
    // Same instance, not a clone — the sink reads err.stack off it.
    expect(out.error).toBe(error);
    expect(out.context).toBe(record.context);
  });

  it('passes null and undefined through instead of throwing', () => {
    expect(remapKind(null)).toBeNull();
    expect(remapKind(undefined)).toBeUndefined();
  });
});

describe('toAxiomLogger', () => {
  let restoreLevel;

  beforeEach(() => {
    restoreLevel = logger.getLevel();
    // Mute console rendering; the records are what we assert on.
    logger.setLevel('NONE');
  });

  afterEach(() => {
    logger.setLevel(restoreLevel);
  });

  it('exposes exactly the six members attachAxiomSink reads, delegating the level methods verbatim', () => {
    const axiomLogger = toAxiomLogger(logger);

    expect(Object.keys(axiomLogger).sort()).toEqual([
      'addSink',
      'debug',
      'error',
      'getBuffer',
      'info',
      'warn',
    ]);
    expect(axiomLogger.debug).toBe(logger.debug);
    expect(axiomLogger.info).toBe(logger.info);
    expect(axiomLogger.warn).toBe(logger.warn);
    expect(axiomLogger.error).toBe(logger.error);
  });

  it('getBuffer() remaps EVERY buffered record while the real buffer keeps its render kinds', () => {
    const axiomLogger = toAxiomLogger(logger);
    const offset = logger.getBuffer().length;

    logger.track('view_open', { surface: 'board_view' });
    logger.warn('Mod', 'something_odd');
    logger.health('boot', { ms: 12 });
    logger.error('Mod', 'stable_event_id', new Error('boom'));

    const mapped = axiomLogger.getBuffer().slice(offset);
    expect(mapped.map((r) => r.kind)).toEqual(['usage', 'error', 'health', 'error']);
    // Field pass-through: encodeDims' wire format survives the remap.
    expect(mapped[0].message).toBe('view_open surface=board_view');
    expect(mapped[2].message).toBe('boot ms=12');

    // The adapter is a VIEW: the underlying logger still renders as before.
    expect(logger.getBuffer().slice(offset).map((r) => r.kind)).toEqual([
      'simple',
      'simple',
      'simple',
      'error',
    ]);
  });

  it('addSink hands the sink remapped records and forwards the unsubscribe', () => {
    const sink = vi.fn();
    const axiomLogger = toAxiomLogger(logger);

    const unsubscribe = axiomLogger.addSink(sink);
    try {
      logger.track('export_clicked', { format: 'docx' });
      logger.warn('Mod', 'something_odd');
    } finally {
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    }

    logger.track('after_unsubscribe');

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0].kind).toBe('usage');
    expect(sink.mock.calls[0][0].message).toBe('export_clicked format=docx');
    expect(sink.mock.calls[1][0].kind).toBe('error');
    expect(sink.mock.calls[1][0].message).toBe('something_odd');
  });

  it('addSink does not let the wrapper mutate the record the other sinks receive', () => {
    const axiomSink = vi.fn();
    const plainSink = vi.fn();
    const axiomLogger = toAxiomLogger(logger);

    const unsubAxiom = axiomLogger.addSink(axiomSink);
    const unsubPlain = logger.addSink(plainSink);
    try {
      logger.track('view_open');
    } finally {
      unsubAxiom();
      unsubPlain();
    }

    expect(axiomSink.mock.calls[0][0].kind).toBe('usage');
    // The UI toast sink discriminates on the RENDER kind — it must still see 'simple'.
    expect(plainSink.mock.calls[0][0].kind).toBe('simple');
  });
});

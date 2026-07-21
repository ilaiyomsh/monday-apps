import { describe, it, expect } from 'vitest';
import { logger, type LogRecord } from '../Logger';

// Locks Logger.bridge — the structured entry the @mapps/error-kit adapter uses
// (module, message, payload?, context?). Unlike the variadic surface it carries an explicit
// context (e.g. the ErrorBoundary componentStack) onto the record, and mirrors labeled()'s
// fan-out policy: WARN/ERROR reach sinks; INFO/DEBUG stay console-only.

const capture = (fn: () => void): LogRecord[] => {
  const records: LogRecord[] = [];
  const unsub = logger.addSink((r) => records.push(r));
  fn();
  unsub();
  return records;
};

describe('Logger.bridge', () => {
  it('ERROR fans out a record carrying module, message, Error payload, and context', () => {
    const err = new Error('e');
    const recs = capture(() => logger.bridge('ERROR', 'Mod', 'msg', err, { componentStack: 'cs' }));
    const rec = recs.find((r) => r.level === 'ERROR' && r.module === 'Mod');
    expect(rec).toBeTruthy();
    expect(rec!.message).toBe('msg');
    expect(rec!.error).toBe(err);
    expect(rec!.kind).toBe('error');
    expect(rec!.context?.componentStack).toBe('cs');
  });

  it('WARN with a non-Error payload fans out with rendering kind "simple" and no error', () => {
    const recs = capture(() => logger.bridge('WARN', 'ModW', 'w', { data: 1 }));
    const rec = recs.find((r) => r.module === 'ModW' && r.level === 'WARN');
    expect(rec).toBeTruthy();
    expect(rec!.kind).toBe('simple');
    expect(rec!.error).toBeUndefined();
  });

  it('INFO and DEBUG do NOT fan out to sinks (console-only)', () => {
    const recs = capture(() => {
      logger.bridge('INFO', 'ModI', 'i');
      logger.bridge('DEBUG', 'ModI', 'd');
    });
    expect(recs.find((r) => r.module === 'ModI')).toBeUndefined();
  });
});

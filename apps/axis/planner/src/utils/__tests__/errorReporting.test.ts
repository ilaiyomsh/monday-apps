import { describe, it, expect, vi } from 'vitest';
import { setupGlobalErrorHandlers } from '@mapps/error-kit/browser';
import { adaptRecord, mondayIdsForAxiom, errorKitLogger } from '../errorReporting';
import { type LogRecord } from '../Logger';

// Locks the app-local bridge between planner's Logger and the shared @mapps/error-kit browser
// layer: the domainKind→kind promotion (adaptRecord), the monday-context id mapping
// (mondayIdsForAxiom), the error-kit-shaped logger adapter, and the global-handler wiring.

describe('adaptRecord (domainKind → kind promotion)', () => {
  const base = { level: 'INFO', module: 'usage', message: 'view_open', kind: 'simple' } as unknown as LogRecord;

  it('promotes domainKind onto kind for usage records', () => {
    expect(adaptRecord({ ...base, domainKind: 'usage' } as LogRecord).kind).toBe('usage');
  });

  it('promotes domainKind onto kind for health records', () => {
    expect(adaptRecord({ ...base, domainKind: 'health' } as LogRecord).kind).toBe('health');
  });

  it('defaults kind to "error" when domainKind is absent — never the rendering kind', () => {
    expect(adaptRecord({ level: 'ERROR', module: 'x', message: 'boom', kind: 'error' } as unknown as LogRecord).kind).toBe('error');
    expect(adaptRecord({ level: 'ERROR', module: 'x', message: 'boom', kind: 'simple' } as unknown as LogRecord).kind).toBe('error');
  });

  it('preserves message/module/level/error/context unchanged', () => {
    const err = new Error('e');
    const rec = adaptRecord({
      level: 'WARN', module: 'm', message: 'msg', kind: 'error', error: err,
      context: { componentStack: 'cs' },
    } as unknown as LogRecord);
    expect(rec.message).toBe('msg');
    expect(rec.module).toBe('m');
    expect(rec.level).toBe('WARN');
    expect(rec.error).toBe(err);
    expect((rec.context as { componentStack?: string }).componentStack).toBe('cs');
  });
});

describe('mondayIdsForAxiom', () => {
  it('maps account.id, user.id, boardId, instanceId', () => {
    expect(mondayIdsForAxiom({ account: { id: 'a1' }, user: { id: 'u1' }, boardId: 'b1', instanceId: 'i1' }))
      .toEqual({ accountId: 'a1', userId: 'u1', boardId: 'b1', instanceId: 'i1' });
  });

  it('falls back to top-level accountId when account.id is absent', () => {
    expect(mondayIdsForAxiom({ accountId: 'a2', user: { id: 'u2' } }).accountId).toBe('a2');
  });

  it('prefers account.id over top-level accountId when both present', () => {
    expect(mondayIdsForAxiom({ account: { id: 'a1' }, accountId: 'a2' }).accountId).toBe('a1');
  });

  it('returns all-undefined ids for an empty context (no throw)', () => {
    expect(mondayIdsForAxiom({})).toEqual({ accountId: undefined, userId: undefined, boardId: undefined, instanceId: undefined });
  });
});

describe('errorKitLogger (error-kit-shaped adapter over the app logger)', () => {
  it('error() fans out an adapted ERROR record with module/message/error/context', () => {
    const records: LogRecord[] = [];
    const unsub = errorKitLogger.addSink((r) => records.push(r as unknown as LogRecord));
    const err = new Error('boom');
    errorKitLogger.error('ModX', 'save_failed', err, { componentStack: 'at Foo' });
    unsub();
    const rec = records.find((r) => r.level === 'ERROR' && r.module === 'ModX');
    expect(rec).toBeTruthy();
    expect(rec!.message).toBe('save_failed');
    expect(rec!.error).toBe(err);
    expect(rec!.kind as unknown as string).toBe('error');
    expect(rec!.context?.componentStack).toBe('at Foo');
  });

  it('warn() fans out an adapted WARN record', () => {
    const records: LogRecord[] = [];
    const unsub = errorKitLogger.addSink((r) => records.push(r as unknown as LogRecord));
    errorKitLogger.warn('ModY', 'resource_slow', { url: 'x' });
    unsub();
    const rec = records.find((r) => r.module === 'ModY');
    expect(rec).toBeTruthy();
    expect(rec!.level).toBe('WARN');
  });

  it('info()/debug() do NOT fan out to sinks (console-only), matching the logger contract', () => {
    const records: LogRecord[] = [];
    const unsub = errorKitLogger.addSink((r) => records.push(r as unknown as LogRecord));
    errorKitLogger.info('ModZ', 'hello');
    errorKitLogger.debug('ModZ', 'dbg');
    unsub();
    expect(records.find((r) => r.module === 'ModZ')).toBeUndefined();
  });

  it('getBuffer() returns records adapted through adaptRecord (kind promoted)', () => {
    errorKitLogger.error('BufMod', 'buffered_err', new Error('x'));
    const rec = errorKitLogger.getBuffer().find((r) => r.module === 'BufMod');
    expect(rec).toBeTruthy();
    expect(rec!.kind).toBe('error');
  });
});

describe('setupGlobalErrorHandlers wired to errorKitLogger', () => {
  const makeWin = () => {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    return {
      listeners,
      win: { addEventListener: (t: string, l: (e: unknown) => void) => { (listeners[t] ??= []).push(l); } },
    };
  };

  it('logs an ERROR on an unhandledrejection', () => {
    const { win, listeners } = makeWin();
    const spy = vi.spyOn(errorKitLogger, 'error').mockImplementation(() => {});
    setupGlobalErrorHandlers(errorKitLogger, { win: win as never });
    const reason = new Error('rejected');
    listeners['unhandledrejection'][0]({ reason, preventDefault() {} });
    expect(spy).toHaveBeenCalledWith('UnhandledPromiseRejection', 'Global error caught', reason);
    spy.mockRestore();
  });

  it('logs an ERROR on an uncaught window error', () => {
    const { win, listeners } = makeWin();
    const spy = vi.spyOn(errorKitLogger, 'error').mockImplementation(() => {});
    setupGlobalErrorHandlers(errorKitLogger, { win: win as never });
    const error = new Error('uncaught');
    const errListeners = listeners['error']; // [capture-phase resource, bubble-phase uncaught]
    errListeners[errListeners.length - 1]({ error });
    expect(spy).toHaveBeenCalledWith('UncaughtError', 'Global error caught', error);
    spy.mockRestore();
  });
});

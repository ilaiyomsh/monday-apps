/**
 * logger.test.ts — v2 telemetry primitives on the app-core logger: encodeDims + the
 * track()/health() usage/health helpers (decisions D3/D4/D5). Node env, sink-capture seam.
 */
import { describe, it, expect } from 'vitest';
import { createLogger, encodeDims, type LogRecord } from '../src/logger';

function capture() {
  const logger = createLogger({ app: 'test' });
  const records: LogRecord[] = [];
  logger.addSink((r) => records.push(r));
  return { logger, records };
}

describe('encodeDims', () => {
  it('returns the base alone when there are no dims', () => {
    expect(encodeDims('view_open')).toBe('view_open');
    expect(encodeDims('view_open', {})).toBe('view_open');
  });
  it('appends key=value pairs with keys sorted (stable output)', () => {
    expect(encodeDims('view_open', { view: 'calendar', tab: 'month' })).toBe('view_open tab=month view=calendar');
  });
  it('includes only string/bool/finite-number values; drops objects, NaN, Infinity, null, undefined', () => {
    expect(
      encodeDims('e', { s: 'x', b: true, n: 3, bad: {}, nan: NaN, inf: Infinity, u: undefined, nul: null }),
    ).toBe('e b=true n=3 s=x');
  });
});

describe('track / health', () => {
  it('track() ships an INFO usage record (kind+alwaysShip), dims folded into the message', () => {
    const { logger, records } = capture();
    logger.track('settings_opened', { source: 'toolbar' });
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.level).toBe('INFO');
    expect(r.kind).toBe('usage');
    expect(r.alwaysShip).toBe(true);
    expect(r.module).toBe('usage');
    expect(r.message).toBe('settings_opened source=toolbar');
  });
  it('health() ships an INFO health record (kind+alwaysShip)', () => {
    const { logger, records } = capture();
    logger.health('boot_ok', { ms: 120 });
    const r = records[0];
    expect(r.level).toBe('INFO');
    expect(r.kind).toBe('health');
    expect(r.alwaysShip).toBe(true);
    expect(r.message).toBe('boot_ok ms=120');
  });
  it('ordinary log records carry no kind/alwaysShip', () => {
    const { logger, records } = capture();
    logger.error('API', 'boom', new Error('x'));
    const r = records[0];
    expect(r.kind).toBeUndefined();
    expect(r.alwaysShip).toBeUndefined();
  });
});

describe('context forwarding (error-kit ErrorBoundary componentStack → ERROR record)', () => {
  it('error() forwards a 4th context arg onto record.context (so component_stack ships)', () => {
    const { logger, records } = capture();
    logger.error('ErrorBoundary', 'boom', new Error('x'), { componentStack: '\n  in App\n  in Provider' });
    expect(records[0].context).toEqual({ componentStack: '\n  in App\n  in Provider' });
  });
  it('warn() forwards a 4th context arg onto record.context', () => {
    const { logger, records } = capture();
    logger.warn('mod', 'msg', undefined, { url: 'x', tag: 'IMG' });
    expect(records[0].context).toEqual({ url: 'x', tag: 'IMG' });
  });
  it('a 3-arg error() call leaves record.context undefined (back-compat)', () => {
    const { logger, records } = capture();
    logger.error('mod', 'msg', new Error('x'));
    expect(records[0].context).toBeUndefined();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { shouldDisplay, selectReplayRecords, useUiErrorSink, REPLAY_CAP } from '../useUiErrorSink';
import { logger, type LogRecord } from '../../utils/Logger';

const mk = (o: Partial<LogRecord>): LogRecord =>
  ({ kind: 'error', level: 'ERROR', module: 'app', message: 'm', ...o } as LogRecord);

describe('shouldDisplay', () => {
  it('is true for ERROR records', () => {
    expect(shouldDisplay(mk({ level: 'ERROR' }))).toBe(true);
  });
  it('is false for non-ERROR levels', () => {
    expect(shouldDisplay(mk({ level: 'WARN' }))).toBe(false);
    expect(shouldDisplay(mk({ level: 'INFO' }))).toBe(false);
    expect(shouldDisplay(mk({ level: 'DEBUG' }))).toBe(false);
  });
  it('is false for ErrorBoundary records (shown by the boundary fallback, not a toast)', () => {
    expect(shouldDisplay(mk({ level: 'ERROR', module: 'ErrorBoundary' }))).toBe(false);
  });
});

describe('selectReplayRecords', () => {
  it('keeps only ERROR, non-duplicate records', () => {
    const buf = [mk({ message: 'a' }), mk({ level: 'WARN', message: 'w' }), mk({ message: 'b', duplicate: true })];
    expect(selectReplayRecords(buf).map((r) => r.message)).toEqual(['a']);
  });

  it('caps at REPLAY_CAP and returns chronological order (newest cap kept)', () => {
    const buf = Array.from({ length: REPLAY_CAP + 3 }, (_, i) => mk({ message: `e${i}` }));
    const out = selectReplayRecords(buf);
    expect(out.length).toBe(REPLAY_CAP);
    expect(out[0].message).toBe('e3');
    expect(out[out.length - 1].message).toBe(`e${REPLAY_CAP + 2}`);
  });

  it('de-dupes by correlationId, keeping the newest occurrence', () => {
    const buf = [
      mk({ message: 'old', correlationId: 'c1' }),
      mk({ message: 'new', correlationId: 'c1' }),
      mk({ message: 'other', correlationId: 'c2' }),
    ];
    expect(selectReplayRecords(buf).map((r) => r.message).sort()).toEqual(['new', 'other']);
  });
});

describe('useUiErrorSink (integration over the singleton logger)', () => {
  it('calls onError exactly once per new ERROR record, skipping WARN and ErrorBoundary', () => {
    const onError = vi.fn();
    const { unmount } = renderHook(() => useUiErrorSink({ onError }));
    onError.mockClear(); // discard any ring-buffer replay from earlier tests
    logger.error('[UISINK] boom');
    logger.warn('[UISINK] warn');
    logger.bridge('ERROR', 'ErrorBoundary', 'crash');
    unmount();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as LogRecord).message).toBe('[UISINK] boom');
  });
});

import { useEffect, useRef } from 'react';
import { logger, type LogRecord } from '../utils/Logger';

/**
 * useUiErrorSink — the single UI display path for caught errors (TS port of
 * apps/discussions/src/hooks/useUiErrorSink.js, adapted to planner's Logger record shape).
 *
 * Registered once at the app shell as a sink on the logger: every ERROR-level record turns
 * into exactly one toast. Principles carried over from the reference:
 *  - Since every catch must log (error-guard), displaying every ERROR record == displaying
 *    every caught error, through ONE path.
 *  - `duplicate` records (log-once) are already skipped inside logger.emit — no double toast.
 *  - Render crashes are shown by the ErrorBoundary fallback, so ERROR records tagged
 *    module==='ErrorBoundary' are NOT also toasted.
 *  - replay: ERROR records buffered before mount (early init errors) are displayed once, up
 *    to REPLAY_CAP, de-duped by correlationId, in chronological order.
 *  - loop guard: a throw from inside the display callback cannot re-enter and re-toast.
 */

/** Cap on records replayed from the ring buffer at mount (early init errors). */
export const REPLAY_CAP = 5;

/**
 * Should this record produce a toast? ERROR level only; ErrorBoundary crashes are shown by
 * the boundary fallback, not a toast (single display path).
 */
export function shouldDisplay(record: Pick<LogRecord, 'level' | 'module'>): boolean {
  if (record.level !== 'ERROR') return false;
  if (record.module === 'ErrorBoundary') return false;
  return true;
}

/**
 * The ERROR records to replay at mount, newest-first-capped then returned in chronological
 * order, de-duped by correlationId. `duplicate` records are excluded (already displayed via
 * their original record).
 */
export function selectReplayRecords(buffer: LogRecord[], cap: number = REPLAY_CAP): LogRecord[] {
  const errorRecords = buffer.filter((r) => shouldDisplay(r) && !r.duplicate);
  const seen = new Set<string>();
  const picked: LogRecord[] = [];
  for (let i = errorRecords.length - 1; i >= 0 && picked.length < cap; i--) {
    const r = errorRecords[i];
    if (r.correlationId) {
      if (seen.has(r.correlationId)) continue;
      seen.add(r.correlationId);
    }
    picked.push(r);
  }
  return picked.reverse();
}

export interface UseUiErrorSinkOptions {
  /** Display exactly one toast for the given ERROR record. */
  onError: (record: LogRecord) => void;
}

export const useUiErrorSink = ({ onError }: UseUiErrorSinkOptions): void => {
  // Fresh onError without re-registering the sink on every render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Synchronous loop guard — a throw inside the handler cannot recurse through emit.
  const inSinkRef = useRef(false);

  useEffect(() => {
    const handler = (record: LogRecord): void => {
      if (!shouldDisplay(record)) return;
      if (inSinkRef.current) return;
      inSinkRef.current = true;
      try {
        onErrorRef.current(record);
      } catch {
        // Intentional, unique silent catch: this IS the sink — logging from here would
        // recurse through emit (exactly what the guard prevents). logger.emit already
        // reports a throwing sink via raw console.error.
      } finally {
        inSinkRef.current = false;
      }
    };

    const unsubscribe = logger.addSink(handler);
    // Replay early init errors captured before mount.
    for (const rec of selectReplayRecords(logger.getBuffer())) handler(rec);
    return unsubscribe;
    // Register once at mount; the handler reads onError via a fresh ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

export default useUiErrorSink;

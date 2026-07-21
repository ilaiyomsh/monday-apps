/**
 * ErrorBoundary.test.tsx — TDD gate for fix 4: componentDidCatch must put componentStack
 * into the ERROR record's context (4th arg) so it actually ships, and must NOT emit the
 * separate DEBUG record (which never shipped). componentDidCatch is exercised directly (no
 * DOM render needed). RED against the baseline (a debug call + no context). See RED-GATE-LOG.md.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ErrorInfo } from 'react';
import { ErrorBoundary } from '../src/react/ErrorBoundary';
import type { Logger } from '../src/types';

function fakeLogger() {
  const error = vi.fn();
  const debug = vi.fn();
  const logger = { error, debug, warn: vi.fn(), info: vi.fn(), addSink: () => () => {}, getBuffer: () => [] } as unknown as Logger;
  return { logger, error, debug };
}

describe('ErrorBoundary — fix 4: componentStack ships in the ERROR record context', () => {
  it('F4a: componentDidCatch passes { componentStack } as the ERROR record context', () => {
    const { logger, error } = fakeLogger();
    const onError = vi.fn();
    const boundary = new ErrorBoundary({ logger, children: null, onError });
    const err = new Error('render blew up');
    const info: ErrorInfo = { componentStack: '\n    in Broken\n    in App' };
    boundary.componentDidCatch(err, info);
    expect(error).toHaveBeenCalledTimes(1);
    // The message is the CONSTANT event id, not error.message (see F4d). The Error still
    // travels as the payload so err_msg/err_name/stack ship; componentStack rides the context.
    expect(error).toHaveBeenCalledWith('ErrorBoundary', 'render_error', err, {
      componentStack: '\n    in Broken\n    in App',
    });
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('F4d (M4): a raw error.message NEVER becomes the record message (ships unscrubbed)', () => {
    // The sink ships `message` verbatim (only err_msg is scrubbed). A boundary that folded
    // error.message into the message arg would leak PII past the D2 privacy scrub.
    const { logger, error } = fakeLogger();
    const boundary = new ErrorBoundary({ logger, children: null });
    const pii = new Error('failed for admin@corp.co token ABCDEF0123456789ghij id 12345678');
    boundary.componentDidCatch(pii, { componentStack: '\n    in App' });
    const [, message] = error.mock.calls[0];
    expect(message).toBe('render_error');
    expect(message).not.toContain('@');
    expect(message).not.toContain('12345678');
  });

  it('F4b: no separate DEBUG record is emitted (it never shipped)', () => {
    const { logger, debug } = fakeLogger();
    const boundary = new ErrorBoundary({ logger, children: null });
    boundary.componentDidCatch(new Error('x'), { componentStack: '\n    in App' });
    expect(debug).not.toHaveBeenCalled();
  });

  it('F4c: getDerivedStateFromError flips hasError to true', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });
});

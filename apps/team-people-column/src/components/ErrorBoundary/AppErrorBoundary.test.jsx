// AppErrorBoundary — locks the render-throw log record's message contract.
//
// M4 (privacy, 2026-07-21): the logged message is now the CONSTANT event id 'render_error',
// NOT error.message. The sink ships `message` verbatim (only err_msg is scrubbed), so folding
// a raw error.message into it would leak PII past the D2 privacy scrub. The crash identity
// travels on the Error INSTANCE (3rd arg to logger.error) — scrubbed to err_msg by the sink —
// and distinct crashes still dedup distinctly because the shared @mapps/error-kit transport's
// dedup key includes err_name + err_msg (fix 5), no longer relying on the message string.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import logger from '../../utils/logger';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(() => cleanup());

function Boom({ message }) {
  throw new Error(message);
}

describe('AppErrorBoundary — render-throw log message', () => {
  it('logs the CONSTANT event id and never leaks the raw error.message into the message field', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary scope="test-scope">
        <Boom message="settings payload was not an array for admin@corp.co" />
      </AppErrorBoundary>
    );

    expect(spy).toHaveBeenCalled();
    const [module, message, error] = spy.mock.calls[0];
    expect(module).toBe('ErrorBoundary:test-scope');
    expect(message).toBe('render_error');
    expect(message).not.toContain('settings payload');
    expect(message).not.toContain('@');
    // the crash identity travels on the Error instance (scrubbed to err_msg by the sink)
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('settings payload was not an array');

    spy.mockRestore();
  });

  it('two DISTINCT crashes carry distinct Error instances (dedup keys on err_name+err_msg, fix 5)', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <AppErrorBoundary scope="a">
        <Boom message="first distinct crash" />
      </AppErrorBoundary>
    );
    unmount();
    render(
      <AppErrorBoundary scope="a">
        <Boom message="second distinct crash" />
      </AppErrorBoundary>
    );

    // message is the same constant for both — dedup no longer relies on it …
    const messages = spy.mock.calls.map((call) => call[1]);
    expect(messages[0]).toBe('render_error');
    expect(messages[1]).toBe('render_error');
    // … the distinct identity is on the Error instances (→ distinct err_msg → distinct key).
    const errMsgs = spy.mock.calls.map((call) => call[2]?.message);
    expect(errMsgs[0]).toContain('first distinct crash');
    expect(errMsgs[1]).toContain('second distinct crash');
    expect(errMsgs[0]).not.toBe(errMsgs[1]);

    spy.mockRestore();
  });

  it('still renders the Hebrew render-crash fallback (UX unchanged by the message fix)', () => {
    render(
      <AppErrorBoundary scope="test-scope">
        <Boom message="boom" />
      </AppErrorBoundary>
    );
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
  });
});

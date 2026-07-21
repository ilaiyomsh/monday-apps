// AppErrorBoundary — locks the render-throw log record's message contract.
//
// Regression this guards: handleError used to log a FIXED string ('React
// render error caught') for every render crash under a scope. Because the
// Axiom transport dedups on (level|tag|message), two DISTINCT render crashes
// in the same scope collided on one dedup key and were throttled together —
// an observability gap (see error-inventory topGaps for AppErrorBoundary.jsx:121).
// The fix folds error.message into the logged message so distinct crashes get
// distinct keys. This test asserts the logged message CONTAINS the thrown
// error's own message (not a fixed string).

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
  it('logs a message that CONTAINS the thrown error.message (not a fixed string)', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary scope="test-scope">
        <Boom message="settings payload was not an array" />
      </AppErrorBoundary>
    );

    expect(spy).toHaveBeenCalled();
    const [module, message] = spy.mock.calls[0];
    expect(module).toBe('ErrorBoundary:test-scope');
    expect(message).toContain('settings payload was not an array');

    spy.mockRestore();
  });

  it('gives two DISTINCT crashes two DISTINCT messages (no dedup-collision on a fixed string)', () => {
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

    const messages = spy.mock.calls.map((call) => call[1]);
    expect(messages[0]).not.toBe(messages[1]);
    expect(messages[0]).toContain('first distinct crash');
    expect(messages[1]).toContain('second distinct crash');

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

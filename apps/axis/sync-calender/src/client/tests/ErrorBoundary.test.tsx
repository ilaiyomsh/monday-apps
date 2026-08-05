// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../admin/components/feedback/ErrorBoundary';
import logger from '../admin/lib/logger';

function Boom(): React.ReactElement {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs render_error with the Error and a componentStack context when a child throws', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [mod, msg, err, ctx] = spy.mock.calls[0];
    expect(mod).toBe('admin');
    expect(msg).toBe('render_error');
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('kaboom');
    expect(ctx).toBeTruthy();
    expect(typeof (ctx as { componentStack?: unknown }).componentStack).toBe('string');
    expect(((ctx as { componentStack: string }).componentStack).length).toBeGreaterThan(0);

    act(() => root.unmount());
  });
});

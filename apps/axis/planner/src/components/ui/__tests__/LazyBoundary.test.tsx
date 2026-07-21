import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LazyBoundary } from '../LazyBoundary';
import { logger } from '../../../utils/Logger';

// Locks the boundary wiring: a render-time throw inside a LazyBoundary shows the reload-prompt
// fallback (not a white screen) AND funnels through the app logger with the React componentStack
// so the crash ships to Axiom as component_stack.

const Boom: React.FC = () => {
  throw new Error('render blew up');
};

afterEach(() => vi.restoreAllMocks());

describe('LazyBoundary', () => {
  it('renders children normally when they do not throw', () => {
    render(
      <LazyBoundary>
        <div>healthy child</div>
      </LazyBoundary>
    );
    expect(screen.getByText('healthy child')).toBeInTheDocument();
  });

  it('shows the reload-prompt fallback and logs ERROR with componentStack when a child throws', () => {
    const bridgeSpy = vi.spyOn(logger, 'bridge');
    // Silence React's console.error noise for the intentional throw.
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LazyBoundary>
        <Boom />
      </LazyBoundary>
    );

    // Fallback (ChunkErrorFallback) is shown instead of a blank surface.
    expect(screen.getByText('טעינת הרכיב נכשלה. יש לרענן את הדף ולנסות שוב.')).toBeInTheDocument();

    // The boundary logged through the app logger at ERROR, module 'ErrorBoundary', with a
    // componentStack in the context arg.
    const call = bridgeSpy.mock.calls.find(
      (c) => c[0] === 'ERROR' && c[1] === 'ErrorBoundary'
    );
    expect(call).toBeTruthy();
    const context = call![4] as { componentStack?: string } | undefined;
    expect(typeof context?.componentStack).toBe('string');
    expect(context!.componentStack!.length).toBeGreaterThan(0);

    consoleErr.mockRestore();
  });
});

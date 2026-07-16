import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStableHandler } from '../useStableHandler.js';

// round136 — the useEvent-style stable handler that keeps memoized rows frozen
// while tab-level handlers read fresh state on every call.

function Harness({ spy }) {
  const [count, setCount] = useState(0);
  // A NEW closure every render (captures `count`), wrapped to a stable identity.
  const onFire = useStableHandler(() => spy(count));
  // Track identity across renders: push the reference once per render.
  Harness.identities.push(onFire);
  return (
    <div>
      <button onClick={() => setCount((c) => c + 1)}>bump</button>
      <button onClick={onFire}>fire</button>
      <span data-testid="count">{count}</span>
    </div>
  );
}
Harness.identities = [];

describe('useStableHandler', () => {
  it('keeps ONE function identity across re-renders', () => {
    Harness.identities = [];
    render(<Harness spy={() => {}} />);
    fireEvent.click(screen.getByText('bump'));
    fireEvent.click(screen.getByText('bump'));
    expect(Harness.identities.length).toBeGreaterThanOrEqual(3);
    expect(new Set(Harness.identities).size).toBe(1);
  });

  it('always invokes the LATEST closure (fresh state), and forwards arguments', () => {
    const spy = vi.fn();
    Harness.identities = [];
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByText('fire'));
    expect(spy).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByText('bump'));
    fireEvent.click(screen.getByText('bump'));
    fireEvent.click(screen.getByText('fire'));
    expect(spy).toHaveBeenLastCalledWith(2); // latest closure, not the mount-time one

    // argument forwarding via a direct call
    let got;
    function ArgHarness() {
      const h = useStableHandler((a, b) => { got = [a, b]; return a + b; });
      return <button onClick={() => h(1, 2)}>go</button>;
    }
    render(<ArgHarness />);
    fireEvent.click(screen.getByText('go'));
    expect(got).toEqual([1, 2]);
  });
});

import React, { useRef, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEscToClearSelection } from '../useEscToClearSelection.js';

// round135 — the shared ESC-clears-selection hook (extracted from six views).

function Harness({ startSelected = true }) {
  const rootRef = useRef(null);
  const [count, setCount] = useState(startSelected ? 2 : 0);
  useEscToClearSelection(rootRef, count > 0, () => setCount(0));
  return (
    <div ref={rootRef}>
      <span data-testid="count">{count}</span>
      <input aria-label="rename" />
    </div>
  );
}

// jsdom has no layout, so offsetParent is null by default — the hook's
// visibility guard would always bail. Give every element a non-null
// offsetParent so the "visible view" path is exercised; individual tests
// flip it back to null to test the hidden-view guard.
function stubOffsetParent(value) {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return value; },
  });
}

describe('useEscToClearSelection', () => {
  it('ESC clears the selection while the view is visible', () => {
    stubOffsetParent(document.body);
    render(<Harness />);
    expect(screen.getByTestId('count').textContent).toBe('2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('does NOT clear when the view is hidden (offsetParent null) or when typing in a text input', () => {
    stubOffsetParent(null); // hidden tab
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('2');

    stubOffsetParent(document.body); // visible again — but typing
    fireEvent.keyDown(screen.getByLabelText('rename'), { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('2');

    // and a plain ESC after leaving the field does clear
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('ignores non-ESC keys and already-handled events; open dialog blocks clearing', () => {
    stubOffsetParent(document.body);
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByTestId('count').textContent).toBe('2');

    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('2');
    dlg.remove();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

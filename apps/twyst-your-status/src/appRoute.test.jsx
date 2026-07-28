/**
 * Which shell modifier each route gets.
 *
 * This looks like cosmetics and is not. `index.css` hangs the height +
 * `overflow: hidden` chain (html, body, #root, .app-shell) off these two classes, and
 * zeroes the shell's 20px padding for them. Without the modifier the required-fields
 * modal is `block-size: 100%` of a padded, unconstrained shell, which measured as a
 * CONSTANT 40px of document scroll at every field count — the page scrolling took the
 * form's title and submit button with it while the field list, the only box meant to
 * scroll, did not. That regression is invisible in jsdom, so the class mapping is what
 * gets pinned here.
 *
 * `settings` and `settings-full` deliberately get NO modifier: they are scrollable
 * documents that want the shell's padding.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mockUseMondayContext = vi.fn();

vi.mock('./hooks/useMondayContext', () => ({
  useMondayContext: (...args) => mockUseMondayContext(...args),
}));

// The picker and the settings surfaces are not under test here — only the shell class.
vi.mock('./components/OnClickDialog/OnClickDialog', () => ({
  default: () => <div data-testid="picker" />,
}));

vi.mock('./services/boardOwnerGate', () => ({
  loadIsBoardOwner: () => Promise.resolve(false),
}));

const { default: App, shellModifier } = await import('./App.jsx');

function shellOf(container) {
  return container.querySelector('[class*="app-shell"]');
}

describe('shellModifier', () => {
  it('gives the picker the is-picker modifier', () => {
    expect(shellModifier('picker')).toBe(' is-picker');
  });

  it('gives the required-fields modal the is-modal modifier', () => {
    expect(shellModifier('required-fields')).toBe(' is-modal');
  });

  it('gives the slim settings shell no modifier — it keeps the shell padding', () => {
    expect(shellModifier('settings')).toBe('');
  });

  it('gives the full settings overlay no modifier', () => {
    expect(shellModifier('settings-full')).toBe('');
  });

  it('gives an unrecognised route no modifier', () => {
    expect(shellModifier(null)).toBe('');
    expect(shellModifier('nope')).toBe('');
  });
});

describe('App shell classes per route', () => {
  beforeEach(() => {
    mockUseMondayContext.mockReset().mockReturnValue({
      context: { boardId: '5501', columnId: 'status', user: { id: '4002' } },
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('marks the required-fields route as a full-iframe modal', () => {
    window.history.replaceState({}, '', '/required-fields');

    const { container } = render(<App />);

    const shell = shellOf(container);
    expect(shell).toHaveClass('app-shell');
    expect(shell).toHaveClass('is-modal');
    expect(shell).not.toHaveClass('is-picker');
  });

  it('marks the picker route as a full-iframe picker', () => {
    window.history.replaceState({}, '', '/picker');

    const { container } = render(<App />);

    const shell = shellOf(container);
    expect(shell).toHaveClass('is-picker');
    expect(shell).not.toHaveClass('is-modal');
  });

  it('leaves the settings shell with neither modifier', async () => {
    window.history.replaceState({}, '', '/settings');

    const { container } = render(<App />);

    // Wait for the lazy chunk so the assertion is not racing Suspense.
    await screen.findByText(/./);
    const shell = shellOf(container);
    expect(shell).not.toHaveClass('is-modal');
    expect(shell).not.toHaveClass('is-picker');
  });
});

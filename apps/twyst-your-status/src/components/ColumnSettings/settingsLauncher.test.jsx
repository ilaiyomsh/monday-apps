/**
 * The settings shell shows the button to board owners and to nobody else.
 *
 * Three states, and the difference between the last two is the point: a NON-OWNER is
 * told who can configure, while a check that FAILED says so in the user's language.
 * Collapsing the second into the first would tell a real owner they lack rights the
 * moment the network hiccups.
 *
 * The gate itself is pinned in services/boardOwnerGate.test.js; here it is mocked so
 * these assertions are about what the shell renders from its answer.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockLoadIsBoardOwner = vi.fn();
const mockOpenAppFeatureModal = vi.fn();

vi.mock('../../services/boardOwnerGate', () => ({
  loadIsBoardOwner: (...args) => mockLoadIsBoardOwner(...args),
}));

vi.mock('../../services/mondayService', () => ({
  default: {
    openAppFeatureModal: (...args) => mockOpenAppFeatureModal(...args),
  },
}));

const { default: SettingsLauncher, GATE_ERROR_MESSAGE, NON_OWNER_MESSAGE } = await import('./SettingsLauncher.jsx');

const CONTEXT = { boardId: '5501', columnId: 'status', user: { id: '4002' } };

describe('SettingsLauncher ownership gate', () => {
  beforeEach(() => {
    mockLoadIsBoardOwner.mockReset();
    mockOpenAppFeatureModal.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the settings button for a board owner', async () => {
    mockLoadIsBoardOwner.mockResolvedValue(true);

    render(<SettingsLauncher context={CONTEXT} />);

    expect(await screen.findByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
    expect(screen.queryByText(NON_OWNER_MESSAGE)).not.toBeInTheDocument();
  });

  it('replaces the button with the owners-only statement for a non-owner', async () => {
    mockLoadIsBoardOwner.mockResolvedValue(false);

    render(<SettingsLauncher context={CONTEXT} />);

    expect(await screen.findByText(NON_OWNER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הגדרות' })).not.toBeInTheDocument();
  });

  it('states the owners-only message in English, in five words', () => {
    expect(NON_OWNER_MESSAGE).toBe('Only board owners can configure');
    expect(NON_OWNER_MESSAGE.split(' ')).toHaveLength(5);
  });

  it('shows a failed check as an error, not as a permission denial, and still withholds the button', async () => {
    mockLoadIsBoardOwner.mockRejectedValue(new Error('Network Error'));

    render(<SettingsLauncher context={CONTEXT} />);

    expect(await screen.findByText(GATE_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הגדרות' })).not.toBeInTheDocument();
    expect(screen.queryByText(NON_OWNER_MESSAGE)).not.toBeInTheDocument();
  });

  it('shows neither the button nor a message while the check is in flight', async () => {
    let resolveGate;
    mockLoadIsBoardOwner.mockReturnValue(new Promise((resolve) => { resolveGate = resolve; }));

    render(<SettingsLauncher context={CONTEXT} />);

    expect(screen.queryByRole('button', { name: 'הגדרות' })).not.toBeInTheDocument();
    expect(screen.queryByText(NON_OWNER_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(GATE_ERROR_MESSAGE)).not.toBeInTheDocument();

    resolveGate(true);
    expect(await screen.findByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
  });

  it('asks the gate about the board and user from the monday context', async () => {
    mockLoadIsBoardOwner.mockResolvedValue(true);

    render(<SettingsLauncher context={CONTEXT} />);

    await waitFor(() => {
      expect(mockLoadIsBoardOwner).toHaveBeenCalledWith({ boardId: '5501', userId: '4002' });
    });
  });

  it('does not open the settings overlay for a non-owner, having no button to open it with', async () => {
    mockLoadIsBoardOwner.mockResolvedValue(false);

    render(<SettingsLauncher context={CONTEXT} />);

    await screen.findByText(NON_OWNER_MESSAGE);
    expect(mockOpenAppFeatureModal).not.toHaveBeenCalled();
  });
});

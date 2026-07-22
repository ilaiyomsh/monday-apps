import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// The triple box lazy-loads TipTap and drives three monday-update hooks — stub
// them so this stays a hermetic test of the round230 pane-reset behavior.
const emptyPane = { html: '', loading: false, author: null, updatedAt: null, save: async () => true, saveErrorCode: null };
vi.mock('@generated/hooks/useBackground.js', () => ({ useBackground: () => emptyPane }));
vi.mock('@generated/hooks/useReferences.js', () => ({ useReferences: () => emptyPane }));
vi.mock('@generated/hooks/useSummary.js', () => ({ useSummary: () => emptyPane }));
vi.mock('@generated/utils/backgroundStore.js', () => ({ loadBackgroundLinks: async () => [], saveBackgroundLinks: () => {} }));
vi.mock('@api/itemFiles.js', () => ({ getItemFiles: async () => [] }));
vi.mock('@api/board-config-store.js', () => ({ getColumns: () => ({}), getBoardId: () => '1' }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: async () => {} } }));
vi.mock('@generated/utils/lazyRetry.js', () => ({ default: (fn) => fn }));
vi.mock('@components/RichTextEditor', () => ({ default: ({ onReady }) => { onReady?.('<p></p>'); return <div data-testid="rte" />; } }));
vi.mock('@components/BrandLoader', () => ({ BrandLoader: () => <div data-testid="loader" /> }));

import { UpdatesTripleBox } from '../UpdatesTripleBox.jsx';

const tabSelected = (name) => screen.getByRole('tab', { name }).getAttribute('aria-selected');

describe('UpdatesTripleBox — round230 deep-link pane reset', () => {
  it('a resetPaneNonce bump jumps back to the רקע (background) pane', async () => {
    const { rerender } = render(<UpdatesTripleBox discussionId="D1" canEdit resetPaneNonce={0} />);
    // Default lands on רקע (the first pane).
    await waitFor(() => expect(tabSelected('רקע')).toBe('true'));

    // User navigates away to סיכום…
    fireEvent.click(screen.getByRole('tab', { name: 'סיכום' }));
    expect(tabSelected('סיכום')).toBe('true');
    expect(tabSelected('רקע')).toBe('false');

    // …then a produced-link activation bumps the nonce → back to רקע.
    rerender(<UpdatesTripleBox discussionId="D1" canEdit resetPaneNonce={1} />);
    expect(tabSelected('רקע')).toBe('true');
    expect(tabSelected('סיכום')).toBe('false');
  });
});

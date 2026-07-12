import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Force the loading branch so only the initial-load placeholder renders.
vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: [],
    loading: true,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: () => {},
    softDeleteDiscussion: () => {},
  }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

import { DiscussionList } from '../DiscussionList.jsx';

// Round 46: the LEFT discussions list NEVER shows the branded "Meetings" splash.
// The list is preloaded at boot (prefetchDiscussions), so its initial-load window
// renders a plain, empty placeholder — no animation. The branded loader now lives
// ONLY in the boot gate (App) and the RIGHT card pane on a return to discussions
// from My Tasks / My Decisions.
describe('DiscussionList — initial list load shows NO branded splash', () => {
  it('does NOT render the BrandLoader (no "טוען" status / no "Meetings") while loading', () => {
    render(<DiscussionList onSelect={() => {}} />);
    expect(screen.queryByRole('status', { name: 'טוען' })).toBeNull();
    expect(screen.queryByText('Meetings')).toBeNull();
    expect(screen.queryByText('Powered by twyst')).toBeNull();
  });

  it('does not show the "no discussions" empty text while still loading', () => {
    render(<DiscussionList onSelect={() => {}} />);
    // During the initial load the list shows neither the animation nor the
    // "no discussions found" message — just the plain settling placeholder.
    expect(screen.queryByText('לא נמצאו דיונים')).toBeNull();
  });

  it('no longer renders the old grey skeleton bars', () => {
    const { container } = render(<DiscussionList onSelect={() => {}} />);
    expect(container.querySelectorAll('[data-testid="skeleton"]').length).toBe(0);
  });
});

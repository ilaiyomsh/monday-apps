import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// round171 — round170 shipped a render-time crash ("Cannot access X before
// initialization": a const referenced filter state declared below it). The build
// can't catch that — only mounting does. This smoke test renders the list header
// with all data hooks stubbed, so a bad hook/const ordering fails CI (via the
// non-blocking test job) instead of the user's screen.
vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: [],
    loading: false,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: () => {},
    softDeleteDiscussion: () => {},
    refetch: () => {},
  }),
  useDiscussionMonths: () => ({ months: [] }),
}));
vi.mock('@generated/hooks/usePermission.js', () => ({
  usePermission: () => () => true,
  useIsSuperMember: () => false,
}));
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({ options: [] }),
}));
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => ({ typeColor: () => '#0073ea' }),
}));

import { DiscussionList } from '../DiscussionList';

describe('DiscussionList render smoke', () => {
  it('mounts the list header without a render/TDZ crash', () => {
    render(
      <DiscussionList
        onSelect={() => {}}
        onCreateNew={() => {}}
        onOpenPersonal={() => {}}
        onOpenSettings={() => {}}
        canManageSettings
        viewMode="list"
      />
    );
    // The "סינון" and "האזור האישי" header controls are the round170 controls whose
    // surrounding code crashed at render. round176 made them icon buttons, so they
    // are matched by accessible name (aria-label), not visible text.
    expect(screen.getByRole('button', { name: 'סינון' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /האזור האישי/ })).toBeInTheDocument();
  });
});

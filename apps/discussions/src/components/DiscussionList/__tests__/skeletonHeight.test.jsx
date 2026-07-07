import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Force the loading branch so only the skeleton list renders.
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
import styles from '../DiscussionList.module.css';

// The skeleton bar must equal the real `.item` row height (--list-row-height,
// 36px) — NOT the old 56px which over-shot the row and caused a visible jump.
const ROW_SKELETON_H = 36;

describe('DiscussionList — loading skeleton matches real row height + spacing', () => {
  it('renders 6 skeleton bars at the row height (not the old 56)', () => {
    const { container } = render(<DiscussionList onSelect={() => {}} />);
    const skeletons = container.querySelectorAll('[data-testid="skeleton"]');
    expect(skeletons.length).toBe(6);
    skeletons.forEach((sk) => {
      const inner = sk.querySelector('div');
      expect(inner).toBeTruthy();
      expect(inner.style.height).toBe(`${ROW_SKELETON_H}px`);
      expect(inner.style.height).not.toBe('56px');
    });
  });

  it('uses a dedicated skeletonList container so spacing can match the real list', () => {
    const { container } = render(<DiscussionList onSelect={() => {}} />);
    const skeletonList = container.querySelector(`.${styles.skeletonList}`);
    expect(skeletonList).toBeTruthy();
    // All 6 skeletons live inside that container.
    expect(skeletonList.querySelectorAll('[data-testid="skeleton"]').length).toBe(6);
  });
});

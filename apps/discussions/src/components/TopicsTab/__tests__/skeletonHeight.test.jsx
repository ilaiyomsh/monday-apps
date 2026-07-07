import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Force the loading branch so only the skeleton renders.
vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: [],
    loading: true,
    addTopic: () => {},
    addPoint: () => {},
    togglePoint: () => {},
    refetch: () => {},
    togglePointNotForDiscussion: () => {},
    toggleTopicNotForDiscussion: () => {},
    renameTopic: () => {},
    deleteTopic: () => {},
    renamePoint: () => {},
    deletePoint: () => {},
    reorderTopics: () => {},
    reorderPoints: () => {},
  }),
}));

vi.mock('@generated/components/TopicPointRow', () => ({
  TopicPointRow: () => <div data-testid="point-row" />,
}));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({
  ApplyTemplateMenu: () => <div data-testid="apply-template" />,
}));

import { TopicsTab } from '../TopicsTab.jsx';

const discussion = { id: 'D1' };

// The skeleton bar must approximate a real COLLAPSED topic card header band
// (~44px). It must NOT be the old 48px (which over-shot the real card height).
const TOPIC_SKELETON_H = 44;

describe('TopicsTab — loading skeleton height matches a real topic card', () => {
  it('renders 3 skeleton bars at the topic-card height (not the old 48)', () => {
    const { container } = render(<TopicsTab discussion={discussion} canEdit />);
    const skeletons = container.querySelectorAll('[data-testid="skeleton"]');
    expect(skeletons.length).toBe(3);
    skeletons.forEach((sk) => {
      // Skeleton renders an inner div with style.height set from the height prop.
      const inner = sk.querySelector('div');
      expect(inner).toBeTruthy();
      expect(inner.style.height).toBe(`${TOPIC_SKELETON_H}px`);
      expect(inner.style.height).not.toBe('48px');
    });
  });
});

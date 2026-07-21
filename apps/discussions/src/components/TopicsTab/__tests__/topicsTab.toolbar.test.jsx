import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable topic list so each test can choose "has topics" vs "empty".
const state = vi.hoisted(() => ({
  items: [{ id: 't1', name: 'נושא א', _subitems: [], notForDiscussion: false }],
}));

vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: state.items,
    loading: false,
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

// Keep the row + template menu dumb so the test stays focused on the toolbar.
vi.mock('@generated/components/TopicPointRow', () => ({
  TopicPointRow: () => <div data-testid="point-row" />,
  RowKebabMenu: () => <div data-testid="kebab" />,
  CreatorAvatar: () => <div data-testid="avatar" />,
}));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({
  ApplyTemplateMenu: () => <div data-testid="apply-template" />,
}));
// round200 — the references panel talks to monday.storage + lazy-loads TipTap;
// stub it so the toolbar tests stay hermetic.
vi.mock('../ReferencesPanel.jsx', () => ({
  ReferencesPanel: () => <div data-testid="references-panel" />,
}));

import { TopicsTab } from '../TopicsTab.jsx';
import styles from '../TopicsTab.module.css';

const discussion = { id: 'D1' };

describe('TopicsTab — toolbar collapse-all alignment', () => {
  beforeEach(() => {
    state.items = [{ id: 't1', name: 'נושא א', _subitems: [], notForDiscussion: false }];
  });

  it('renders the collapse-all button as the LAST toolbar child so space-between pins it to the LTR end', () => {
    const { container } = render(<TopicsTab discussion={discussion} canEdit />);
    const toolbar = container.querySelector(`.${styles.toolbar}`);
    expect(toolbar).toBeTruthy();
    // The leading controls live in their own group; the collapse-all IconButton
    // is a sibling that comes AFTER it, so it sits at the far (LTR) end.
    const leadingGroup = toolbar.querySelector(`.${styles.toolbarLeft}`);
    expect(leadingGroup).toBeTruthy();
    // Topics now default-OPEN on entering the tab, so the button starts as "collapse".
    const collapseBtn = screen.getByLabelText('קפל הכל');
    expect(toolbar.lastElementChild.contains(collapseBtn)).toBe(true);
    expect(toolbar.lastElementChild).not.toBe(leadingGroup);
  });

  it('toggles the collapse-all aria-label between קפל הכל and פתח הכל on click', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    // Topics now default-OPEN on entering the tab, so the button starts as "collapse".
    const btn = screen.getByLabelText('קפל הכל');
    fireEvent.click(btn);
    expect(screen.getByLabelText('פתח הכל')).toBeTruthy();
  });

  it('does not render the collapse-all button when there are no topics', () => {
    state.items = [];
    render(<TopicsTab discussion={discussion} canEdit />);
    expect(screen.queryByLabelText('קפל הכל')).toBeNull();
    expect(screen.queryByLabelText('פתח הכל')).toBeNull();
  });

  it('renders the discussed column header as "#" (round 52 rename of נידונה)', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    // The open topic's column-header row shows the check column's title as "#",
    // and the old "נידונה" label is gone from the header.
    expect(screen.getByText('#')).toBeTruthy();
    expect(screen.queryByText('נידונה')).toBeNull();
  });
});

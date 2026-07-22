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
vi.mock('../UpdatesTripleBox.jsx', () => ({
  UpdatesTripleBox: () => <div data-testid="updates-triple-box" />,
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
    // round206 — topics default-COLLAPSED on entering the tab, so the button
    // starts as "expand all".
    const collapseBtn = screen.getByLabelText('פתח הכל');
    expect(toolbar.lastElementChild.contains(collapseBtn)).toBe(true);
    expect(toolbar.lastElementChild).not.toBe(leadingGroup);
  });

  it('toggles the collapse-all aria-label between פתח הכל and קפל הכל on click', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    // round206 — topics default-COLLAPSED, so the button starts as "expand all".
    const btn = screen.getByLabelText('פתח הכל');
    fireEvent.click(btn);
    expect(screen.getByLabelText('קפל הכל')).toBeTruthy();
  });

  it('does not render the collapse-all button when there are no topics', () => {
    state.items = [];
    render(<TopicsTab discussion={discussion} canEdit />);
    expect(screen.queryByLabelText('קפל הכל')).toBeNull();
    expect(screen.queryByLabelText('פתח הכל')).toBeNull();
  });

  it('round226b — the card body renders NO column-header row (clean list)', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    // round206 — topics start collapsed: expand all first. The card redesign
    // dropped the table's column-header row entirely — no "#"/"תוצרים" header
    // labels and no legacy "נידונה" title anywhere; the inline add-point row
    // renders instead.
    fireEvent.click(screen.getByLabelText('פתח הכל'));
    expect(screen.queryByText('#')).toBeNull();
    expect(screen.queryByText('נידונה')).toBeNull();
    expect(screen.getByLabelText('הוסף נקודה')).toBeTruthy();
  });

  it('round230 — a produced-link activation (resetViewNonce bump) re-collapses all topics', () => {
    const { rerender } = render(<TopicsTab discussion={discussion} canEdit resetViewNonce={0} />);
    // Expand the (default-collapsed) topic so its open state is observable via
    // the inline add-point row.
    fireEvent.click(screen.getByLabelText('פתח הכל'));
    expect(screen.getByLabelText('הוסף נקודה')).toBeTruthy(); // topic is open
    // A link activation bumps the nonce → the tab FORCES every topic collapsed.
    rerender(<TopicsTab discussion={discussion} canEdit resetViewNonce={1} />);
    expect(screen.queryByLabelText('הוסף נקודה')).toBeNull(); // collapsed again
  });
});

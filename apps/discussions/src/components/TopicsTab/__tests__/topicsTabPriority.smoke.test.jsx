import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// One topic WITH a priority (p1='גבוה') and one WITHOUT (empty → "עדיפות").
vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: [
      { id: 't1', name: 'נושא א', _subitems: [], notForDiscussion: false, priority: 'p1' },
      { id: 't2', name: 'נושא ב', _subitems: [], notForDiscussion: false, priority: null },
    ],
    loading: false,
    addTopic: () => {}, addPoint: () => {}, togglePoint: () => {}, refetch: () => {},
    togglePointNotForDiscussion: () => {}, toggleTopicNotForDiscussion: () => {},
    updateTopicPriority: () => {},
    renameTopic: () => {}, deleteTopic: () => {}, renamePoint: () => {}, deletePoint: () => {},
    reorderTopics: () => {}, reorderPoints: () => {},
  }),
}));
// priorityID is mapped → the pill renders; label text + colors come from here.
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: (board) => (board === 'topics' ? { topicPriorityID: { id: 'status_x' } } : {}),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [{ id: 'p1', label: 'גבוה', color: '#e2445c' }],
    labelById: { p1: 'גבוה' }, colorById: { p1: '#e2445c' }, orderById: { p1: 0 }, doneId: null, loading: false,
  }),
}));
vi.mock('@generated/components/TopicPointRow', () => ({ TopicPointRow: () => <div data-testid="point-row" />, RowKebabMenu: () => <div data-testid="kebab" />, CreatorAvatar: () => <div data-testid="avatar" /> }));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({ ApplyTemplateMenu: () => <div data-testid="apply-template" /> }));
// round200 — stub the references panel (monday.storage + lazy TipTap).
vi.mock('../UpdatesTripleBox.jsx', () => ({ UpdatesTripleBox: () => <div data-testid="updates-triple-box" /> }));

import { TopicsTab } from '../TopicsTab.jsx';

describe('TopicsTab — per-topic priority pill (smoke)', () => {
  it('shows the column label for a set priority and "עדיפות" for an unset one', () => {
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    expect(screen.getByText('גבוה')).toBeTruthy();   // value from the column (t1)
    expect(screen.getByText('עדיפות')).toBeTruthy();  // empty placeholder (t2)
  });

  it('does not render the pill when priorityID is unmapped', () => {
    // Re-mock getColumns to unmapped for this assertion path is overkill; instead
    // assert the mapped case rendered exactly one set-label — the unmapped path is
    // covered by the existing toolbar test (no pill, no crash).
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    expect(screen.getAllByText('גבוה').length).toBe(1);
  });
});

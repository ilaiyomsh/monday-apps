import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// One topic WITH a priority (p1='גבוה') and one WITHOUT.
const spies = vi.hoisted(() => ({ updateTopicPriority: null }));
vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: [
      { id: 't1', name: 'נושא א', _subitems: [], notForDiscussion: false, priority: 'p1' },
      { id: 't2', name: 'נושא ב', _subitems: [], notForDiscussion: false, priority: null },
    ],
    loading: false,
    addTopic: () => {}, addPoint: () => {}, togglePoint: () => {}, refetch: () => {},
    togglePointNotForDiscussion: () => {}, toggleTopicNotForDiscussion: () => {},
    updateTopicPriority: (...a) => spies.updateTopicPriority?.(...a),
    renameTopic: () => {}, deleteTopic: () => {}, renamePoint: () => {},
    softDeletePoints: () => ({ undo: () => {}, count: 0 }),
    reorderTopics: () => {}, reorderPoints: () => {},
  }),
}));
// priorityID is mapped → the ribbon tints by priority + the ⋮ menu offers it.
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
vi.mock('../UpdatesTripleBox.jsx', () => ({ UpdatesTripleBox: () => <div data-testid="updates-triple-box" /> }));

import { TopicsTab } from '../TopicsTab.jsx';

describe('TopicsTab — round235 topic priority via the ribbon ⋮ menu (smoke)', () => {
  it('a topic WITH a priority tints its ribbon label with the priority color', () => {
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    const tabs = screen.getAllByRole('tab');
    // t1 carries the priority color; t2 falls back to its palette accent var.
    expect(tabs[0].style.getPropertyValue('--tile-accent')).toBe('#e2445c');
    expect(tabs[1].style.getPropertyValue('--tile-accent')).toContain('--topic-color-');
  });

  it('the ⋮ menu lists the priority options and picking one writes it', () => {
    spies.updateTopicPriority = vi.fn();
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    const kebab = screen.getByLabelText('אפשרויות הנושא: נושא ב');
    fireEvent.pointerDown(kebab);
    fireEvent.pointerUp(document);
    expect(screen.getByText('עדיפות')).toBeTruthy();
    fireEvent.click(screen.getByText('גבוה'));
    expect(spies.updateTopicPriority).toHaveBeenCalledWith('t2', 'p1');
  });
});

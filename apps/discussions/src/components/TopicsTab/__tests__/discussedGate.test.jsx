import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/*
 * round340 (owner spec) — edit/delete of a topic or point splits on whether the thing
 * has already been DISCUSSED:
 *
 *   "משתתף יכול לערוך או למחוק נושא לפני שאחת הנקודות שתחתיו נידונה ויכול לערוך או
 *    למחוק נקודה לפני שהיא נידונה אבל לא יכול לערוך או למחוק נושא לאחר שאחת הנקודות
 *    שתחתיו נידונה"
 *
 * The interesting part — and the reason this is a component test and not a resolver
 * one — is that the two capabilities are resolved ONCE per discussion in
 * DiscussionCard, so which of the pair applies has to be decided per ROW here. A topic
 * counts as discussed once ANY of its points is, because the topic is the container:
 * renaming or removing it after the meeting reached one of its points rewrites the
 * record just as much as editing that point would.
 *
 * The two props are driven directly (they are booleans from `can(...)`), which lets
 * each case pin one axis: BEFORE-only grants, AFTER-only grants, or neither.
 */

// t1 has NO discussed point; t2 has one. Both carry two points so "some" is a real test.
vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: [
      {
        id: 't1',
        name: 'נושא לא נידון',
        notForDiscussion: false,
        priority: null,
        _subitems: [
          { id: 'p1a', name: 'נקודה א', discussed: false, notForDiscussion: false },
          { id: 'p1b', name: 'נקודה ב', discussed: false, notForDiscussion: false },
        ],
      },
      {
        id: 't2',
        name: 'נושא שנידון',
        notForDiscussion: false,
        priority: null,
        _subitems: [
          { id: 'p2a', name: 'נקודה ג', discussed: false, notForDiscussion: false },
          { id: 'p2b', name: 'נקודה ד', discussed: true, notForDiscussion: false },
        ],
      },
    ],
    loading: false,
    addTopic: () => {}, addPoint: () => {}, togglePoint: () => {}, refetch: () => {},
    togglePointNotForDiscussion: () => {}, toggleTopicNotForDiscussion: () => {},
    updateTopicPriority: () => {},
    renameTopic: () => {}, deleteTopic: () => {}, renamePoint: () => {},
    softDeletePoints: () => ({ undo: () => {}, count: 0 }),
    softDeleteTopic: () => ({ undo: () => {}, count: 0 }),
    reorderTopics: () => {}, reorderPoints: () => {},
  }),
}));
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({ getColumns: () => ({}) }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, loading: false,
  }),
}));
vi.mock('@generated/components/TopicPointRow', () => ({
  TopicPointRow: () => <div data-testid="point-row" />,
  RowKebabMenu: () => <div data-testid="kebab" />,
  CreatorAvatar: () => <div data-testid="avatar" />,
}));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({ ApplyTemplateMenu: () => <div data-testid="apply-template" /> }));
vi.mock('../UpdatesTripleBox.jsx', () => ({ UpdatesTripleBox: () => <div data-testid="updates-triple-box" /> }));

import { TopicsTab } from '../TopicsTab.jsx';

// A participant under the round340 seed: may act BEFORE, not after.
const PARTICIPANT = {
  editTopicOrPoint: true,
  deleteTopicOrPoint: true,
  editTopicOrPointDiscussed: false,
  deleteTopicOrPointDiscussed: false,
};
// A manager role (creator / lead / coordinator): both halves.
const MANAGER = {
  editTopicOrPoint: true,
  deleteTopicOrPoint: true,
  editTopicOrPointDiscussed: true,
  deleteTopicOrPointDiscussed: true,
};

const mount = (caps) => render(
  <TopicsTab discussion={{ id: 'D1' }} canEdit canHide={false} {...caps} />
);
const tileFor = (name) => screen.getAllByRole('tab').find((t) => t.textContent.includes(name));
// The right-click menu's items, by their visible text.
const menuItems = () => [...document.querySelectorAll('button')].map((b) => b.textContent.trim());

describe('round340 — a participant may edit/delete only BEFORE it was discussed', () => {
  it('offers עריכת שם + מחיקת נושא on a topic with no discussed point', () => {
    mount(PARTICIPANT);
    fireEvent.contextMenu(tileFor('נושא לא נידון'));
    expect(menuItems()).toContain('עריכת שם');
    expect(menuItems()).toContain('מחיקת נושא');
  });

  /*
   * The load-bearing case. t2 differs from t1 in exactly one respect — one of its two
   * points is ticked נידונה — so anything that shows up here and not above is the gate
   * reading the row rather than the discussion.
   */
  it('offers NEITHER on a topic where one point was already discussed', () => {
    mount(PARTICIPANT);
    fireEvent.contextMenu(tileFor('נושא שנידון'));
    expect(menuItems()).not.toContain('עריכת שם');
    expect(menuItems()).not.toContain('מחיקת נושא');
  });

  // The context menu opens at all only when SOMETHING in it is available; with both
  // halves revoked for a discussed topic there is nothing to show, so it must not open.
  it('does not open the menu at all when the row grants nothing', () => {
    mount({
      editTopicOrPoint: false,
      deleteTopicOrPoint: false,
      editTopicOrPointDiscussed: false,
      deleteTopicOrPointDiscussed: false,
    });
    fireEvent.contextMenu(tileFor('נושא לא נידון'));
    expect(menuItems()).not.toContain('עריכת שם');
    expect(menuItems()).not.toContain('מחיקת נושא');
  });
});

describe('round340 — a manager role keeps both halves', () => {
  it('offers עריכת שם + מחיקת נושא on a DISCUSSED topic too', () => {
    mount(MANAGER);
    fireEvent.contextMenu(tileFor('נושא שנידון'));
    expect(menuItems()).toContain('עריכת שם');
    expect(menuItems()).toContain('מחיקת נושא');
  });
});

/*
 * The AFTER grant alone must be enough for a discussed topic and must NOT be what a
 * not-yet-discussed one reads. Asserting the pair in both directions is what catches
 * the gate being wired to the wrong member — a swap that a one-sided test would pass.
 */
describe('round340 — the two halves are not interchangeable', () => {
  // Deliberately the INVERSE of the participant seed: only the after-discussed half.
  const AFTER_ONLY = {
    editTopicOrPoint: false,
    deleteTopicOrPoint: false,
    editTopicOrPointDiscussed: true,
    deleteTopicOrPointDiscussed: true,
  };

  it('an AFTER-only grant reaches the DISCUSSED topic', () => {
    mount(AFTER_ONLY);
    fireEvent.contextMenu(tileFor('נושא שנידון'));
    expect(menuItems()).toContain('עריכת שם');
    expect(menuItems()).toContain('מחיקת נושא');
  });

  it('…and does NOT reach the not-yet-discussed one', () => {
    mount(AFTER_ONLY);
    fireEvent.contextMenu(tileFor('נושא לא נידון'));
    expect(menuItems()).not.toContain('עריכת שם');
    expect(menuItems()).not.toContain('מחיקת נושא');
  });
});

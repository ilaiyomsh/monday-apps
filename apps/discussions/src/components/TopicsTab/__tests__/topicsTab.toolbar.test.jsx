import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable topic list + spies so each test can choose the data AND observe writes.
const state = vi.hoisted(() => ({
  items: [],
  addTopic: null,
  deleteTopic: null,
  softDeleteTopic: null,
  renameTopic: null,
  onNotify: null,
}));

vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: state.items,
    loading: false,
    addTopic: (...a) => state.addTopic?.(...a),
    addPoint: () => {},
    togglePoint: () => {},
    refetch: () => {},
    togglePointNotForDiscussion: () => {},
    toggleTopicNotForDiscussion: () => {},
    renameTopic: (...a) => state.renameTopic?.(...a),
    deleteTopic: (...a) => state.deleteTopic?.(...a),
    softDeleteTopic: (...a) => { state.softDeleteTopic?.(...a); return { undo: () => {} }; },
    renamePoint: () => {},
    softDeletePoints: () => ({ undo: () => {}, count: 0 }),
    reorderTopics: () => {},
    reorderPoints: () => {},
  }),
}));

// Keep the row + template menu dumb so the test stays focused on the ribbon.
vi.mock('@generated/components/TopicPointRow', () => ({
  TopicPointRow: ({ point }) => <div data-testid="point-row">{point.name}</div>,
  RowKebabMenu: () => <div data-testid="kebab" />,
  CreatorAvatar: () => <div data-testid="avatar" />,
}));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({
  ApplyTemplateMenu: () => <div data-testid="apply-template" />,
}));
// round200 — the references panel talks to monday.storage + lazy-loads TipTap;
// stub it so the ribbon tests stay hermetic.
vi.mock('../UpdatesTripleBox.jsx', () => ({
  UpdatesTripleBox: () => <div data-testid="updates-triple-box" />,
}));

import { TopicsTab } from '../TopicsTab.jsx';

const discussion = { id: 'D1' };
const twoTopics = () => ([
  { id: 't1', name: 'נושא א', _subitems: [{ id: 'p1', name: 'נקודה א1', discussed: false }], notForDiscussion: false },
  { id: 't2', name: 'נושא ב', _subitems: [{ id: 'p2', name: 'נקודה ב1', discussed: false }], notForDiscussion: false },
]);

describe('TopicsTab — round235 topics ribbon', () => {
  beforeEach(() => {
    state.items = twoTopics();
    state.addTopic = vi.fn();
    state.deleteTopic = vi.fn();
    state.softDeleteTopic = vi.fn();
    state.renameTopic = vi.fn();
    state.onNotify = vi.fn();
  });

  it('the old toolbar buttons are GONE (נושא חדש / collapse-all / hide-columns)', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    expect(screen.queryByText('נושא חדש')).toBeNull();
    expect(screen.queryByLabelText('פתח הכל')).toBeNull();
    expect(screen.queryByLabelText('קפל הכל')).toBeNull();
  });

  it('renders a ribbon label per topic; the FIRST topic is active and ONLY its points show', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('נקודה א1')).toBeTruthy();
    expect(screen.queryByText('נקודה ב1')).toBeNull();
  });

  it('clicking another label switches the points below to that topic', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.queryByText('נקודה א1')).toBeNull();
    expect(screen.getByText('נקודה ב1')).toBeTruthy();
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('round237 — the "+" at the END opens an inline editable box; Enter appends (position bottom)', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    fireEvent.click(screen.getByLabelText('נושא בסוף הדיון'));
    const input = screen.getByLabelText('שם הנושא החדש (בסוף הדיון)');
    fireEvent.change(input, { target: { value: 'נושא חדש לגמרי' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.addTopic).toHaveBeenCalledWith('נושא חדש לגמרי', { position: 'bottom' });
  });

  it('round237 — the "+" at the START opens an inline box; Enter PREPENDS (no position)', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    fireEvent.click(screen.getByLabelText('נושא בתחילת הדיון'));
    const input = screen.getByLabelText('שם הנושא החדש (בתחילת הדיון)');
    fireEvent.change(input, { target: { value: 'נושא בהתחלה' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.addTopic).toHaveBeenCalledWith('נושא בהתחלה', {});
  });

  it('round239 — RIGHT-CLICK → מחיקת נושא deletes IMMEDIATELY (no confirm) with an undo toast', () => {
    render(<TopicsTab discussion={discussion} canEdit onNotify={state.onNotify} />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[0]); // נושא א
    fireEvent.click(screen.getByText('מחיקת נושא'));
    // No confirmation step — it soft-deletes right away…
    expect(screen.queryByLabelText('אישור מחיקה')).toBeNull();
    expect(state.softDeleteTopic).toHaveBeenCalledWith('t1');
    // …and surfaces an undo ("בטל") toast (like point deletion).
    const notify = state.onNotify.mock.calls.at(-1);
    expect(notify[0]).toBe('הנושא נמחק');
    expect(notify[3]).toMatchObject({ label: 'בטל' });
  });

  it('round237 — עריכת שם from the right-click menu turns the label into an RTL input; Enter renames', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[1]); // נושא ב
    fireEvent.click(screen.getByText('עריכת שם'));
    const input = screen.getByLabelText('ערוך שם נושא');
    expect(input.getAttribute('dir')).not.toBe('ltr'); // RTL editing (owner request)
    fireEvent.change(input, { target: { value: 'נושא ב מעודכן' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.renameTopic).toHaveBeenCalledWith('t2', 'נושא ב מעודכן');
  });

  it('round226b/235 — the active section is HEADLESS: no column headers, inline add-point renders', () => {
    render(<TopicsTab discussion={discussion} canEdit />);
    expect(screen.queryByText('#')).toBeNull();
    expect(screen.queryByText('נידונה')).toBeNull();
    expect(screen.getByLabelText('הוסף נקודה')).toBeTruthy();
  });

  it('round230/235 — a produced-link activation (resetViewNonce bump) lands back on the FIRST topic', () => {
    const { rerender } = render(<TopicsTab discussion={discussion} canEdit resetViewNonce={0} />);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByText('נקודה ב1')).toBeTruthy();
    rerender(<TopicsTab discussion={discussion} canEdit resetViewNonce={1} />);
    expect(screen.getByText('נקודה א1')).toBeTruthy();
    expect(screen.queryByText('נקודה ב1')).toBeNull();
  });

  it('no topics → no ribbon labels (but the + buttons stay) and the empty note renders', () => {
    state.items = [];
    render(<TopicsTab discussion={discussion} canEdit />);
    expect(screen.queryAllByRole('tab').length).toBe(0);
    // both end "+" buttons are always present so a first topic can be added
    expect(screen.getByLabelText('נושא בתחילת הדיון')).toBeTruthy();
    expect(screen.getByLabelText('נושא בסוף הדיון')).toBeTruthy();
    expect(screen.getByText('אין נושאים לדיון זה')).toBeTruthy();
  });
});

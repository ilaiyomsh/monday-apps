import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable viewport flag so we can test both the desktop popover and the mobile
// bottom-sheet branch. (The desktop @vibe Dialog can't be opened in jsdom, but
// the mobile sheet opens via plain React state — so we exercise the builder
// panel + segments there.)
const vp = vi.hoisted(() => ({ mobile: false }));

const TASKS = [
  { id: '1', name: 'משימה א', deadlineID: new Date(2026, 0, 10), statusID: 's1', priorityID: 'p1', discussionLinkID: { linkedItems: [{ id: 'D1', name: 'דיון א' }], ids: ['D1'], text: null } },
  { id: '2', name: 'משימה ב', deadlineID: null, statusID: 's2', priorityID: null, discussionLinkID: { linkedItems: [], ids: [], text: null } },
];

vi.mock('@generated/hooks/useMyTasks.js', () => ({
  useMyTasks: () => ({
    items: TASKS, loading: false, loadingMore: false, hasMore: false, error: null,
    loadMore: () => {}, updateTaskStatus: () => {}, updateTaskPriority: () => {}, updateTaskNotes: () => {},
  }),
}));
vi.mock('@generated/hooks/useDiscussions.js', () => ({ useDiscussions: () => ({ items: [], loading: false }) }));
vi.mock('@generated/hooks/useViewport.js', () => ({ useViewport: () => ({ isMobile: vp.mobile, isTablet: false, isDesktop: !vp.mobile }) }));
vi.mock('@generated/contexts/MondayContext.jsx', async (importOriginal) => ({ ...(await importOriginal()), useMondayContext: () => ({ context: {}, currentUser: { id: '1' } }) }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: (_b, alias) => (alias === 'priorityID'
    ? { options: [{ id: 'p1', label: 'דחוף', color: '#df2f4a' }], labelById: { p1: 'דחוף' }, colorById: { p1: '#df2f4a' }, orderById: { p1: 0 } }
    : { options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }, { id: 's2', label: 'בוצע', color: '#00c875' }], labelById: { s1: 'בעבודה', s2: 'בוצע' }, colorById: { s1: '#fdab3d', s2: '#00c875' }, orderById: { s1: 0, s2: 1 } }),
}));
// Keep the table dumb so the smoke test stays focused on the toolbar/builder.
vi.mock('../MyTasksTable.jsx', () => ({
  MyTasksTable: ({ tasks }) => <div data-testid="table">{tasks.map((t) => <div key={t.id}>{t.name}</div>)}</div>,
}));
// round208 — mobile renders MyTasksCardList instead of the table; keep it dumb
// too (its own behavior is pinned in myTasksCardList.test.jsx) so card chip
// texts (e.g. the empty "עדיפות" chip) don't collide with builder options here.
vi.mock('../MyTasksCardList.jsx', () => ({
  MyTasksCardList: ({ tasks }) => <div data-testid="cards">{tasks.map((t) => <div key={t.id}>{t.name}</div>)}</div>,
}));
// No saved view / no save permission — the smoke test runs without the
// Settings/Monday providers the real hook needs.
// The permission resolver reads MondayContext + SettingsContext (mocked only
// partially here) — stub it to allow-all; gating has its own unit tests.
vi.mock('@generated/hooks/usePermission.js', () => ({ usePermission: () => () => true }));
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  useSavedViews: () => ({ view: null, canSave: false, saveView: () => {} }),
}));

import { MyTasksView } from '../MyTasksView.jsx';

describe('MyTasksView — toolbar + builder (smoke)', () => {
  beforeEach(() => { vp.mobile = false; });

  it('renders the toolbar pills and tasks (round224 default: GROUP BY STATUS, top-down)', () => {
    render(<MyTasksView />);
    expect(screen.getByText('סינון')).toBeTruthy();
    expect(screen.getByText('סדר')).toBeTruthy();
    expect(screen.getByText('קבץ לפי')).toBeTruthy();
    // round224 — the default grouping is STATUS (owner mockup): the mocked
    // status labels render as group headers; no flat "all tasks" group.
    expect(screen.queryByText('כל המשימות')).toBeNull();
    expect(screen.getByText('בעבודה')).toBeTruthy();
    expect(screen.getByText('בוצע')).toBeTruthy();
    expect(screen.getByText('משימה א')).toBeTruthy();
    expect(screen.getByText('משימה ב')).toBeTruthy();
  });

  it('round224 — the scope toggle renders with משימות באחריות as the default', () => {
    render(<MyTasksView />);
    const mine = screen.getByRole('tab', { name: 'משימות באחריות' });
    const led = screen.getByRole('tab', { name: 'משימות בדיונים שהובלתי' });
    expect(mine.getAttribute('aria-selected')).toBe('true');
    expect(led.getAttribute('aria-selected')).toBe('false');
  });

  it('round213 — MOBILE: the builders are replaced by the "סידור לפי" toggle, grouping by status then priority', () => {
    vp.mobile = true;
    render(<MyTasksView />);
    // No Filter/Sort/Group builders on the phone.
    expect(screen.queryByLabelText('סדר')).toBeNull();
    expect(screen.queryByLabelText('סינון')).toBeNull();
    expect(screen.queryByLabelText('קבץ לפי')).toBeNull();
    // Default: grouped top-down by STATUS (the mocked labels are group headers).
    const pill = screen.getByRole('button', { name: 'החלפת הסידור בין סטטוס לעדיפות' });
    expect(pill.textContent).toContain('סטטוס');
    expect(screen.getByText('בעבודה')).toBeTruthy();
    expect(screen.getByText('בוצע')).toBeTruthy();
    // One tap flips the toggle to PRIORITY grouping.
    fireEvent.click(pill);
    expect(pill.textContent).toContain('עדיפות');
    expect(screen.getByText('דחוף')).toBeTruthy();
    expect(screen.queryByText('בעבודה')).toBeNull();
  });
});

// Single shared scroll container (a real monday board): the .board child owns
// BOTH-axis scrolling so all group tables move together under one bottom
// scrollbar — the root itself does NOT scroll. jsdom does not apply class-based
// stylesheet rules to getComputedStyle, so we assert the CSS module source
// carries the architecture; the render check confirms the elements exist.
describe('MyTasksView — single shared scroll board (CSS)', () => {
  beforeEach(() => { vp.mobile = false; });

  const css = readFileSync(
    resolve(process.cwd(), 'src/components/MyTasksView/MyTasksView.module.css'),
    'utf8',
  );
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)) + 1);
  const rootBlock = block('.root {');
  const boardBlock = block('.board {');
  const innerBlock = block('.groupScrollInner {');

  it('renders the toolbar and the .board scroll container', () => {
    const { container } = render(<MyTasksView />);
    expect(container.querySelector('.toolbar')).toBeTruthy();
    expect(container.querySelector('.board')).toBeTruthy();
  });

  it('the root does not scroll — the .board owns both-axis scrolling', () => {
    expect(/overflow:\s*hidden/i.test(rootBlock)).toBe(true);
    expect(/overflow:\s*auto/i.test(boardBlock)).toBe(true);
    // flex:1 + min-height:0 lets the board fill the remaining height so the
    // horizontal scrollbar pins to the view bottom.
    expect(/flex:\s*1/i.test(boardBlock)).toBe(true);
    expect(/min-height:\s*0/i.test(boardBlock)).toBe(true);
  });

  it('the shared inner sets one horizontal extent for all groups (max-content, min-width:100%)', () => {
    expect(/width:\s*max-content/i.test(innerBlock)).toBe(true);
    expect(/min-width:\s*100%/i.test(innerBlock)).toBe(true);
  });
});

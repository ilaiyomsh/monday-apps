import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// round302 — two structural guarantees of the agenda pane:
//  1. `__building` (a discussion whose creation is still finishing in the
//     background) shows the app's STANDARD loading animation instead of a
//     half-filled agenda.
//  2. the ribbon's tiles live in their own scroll track while BOTH "+" pieces stay
//     pinned outside it, so they can never scroll out of reach.

const state = vi.hoisted(() => ({ items: [], loading: false }));

vi.mock('@generated/hooks/useTopics', () => ({
  useTopics: () => ({
    items: state.items,
    loading: state.loading,
    addTopic: () => {}, addPoint: () => {}, togglePoint: () => {}, refetch: () => {},
    togglePointNotForDiscussion: () => {}, toggleTopicNotForDiscussion: () => {},
    renameTopic: () => {}, deleteTopic: () => {},
    softDeleteTopic: () => ({ undo: () => {} }),
    renamePoint: () => {},
    softDeletePoints: () => ({ undo: () => {}, count: 0 }),
    reorderTopics: () => {}, reorderPoints: () => {},
  }),
}));
vi.mock('@generated/components/TopicPointRow', () => ({
  TopicPointRow: ({ point }) => <div data-testid="point-row">{point.name}</div>,
  RowKebabMenu: () => <div data-testid="kebab" />,
  CreatorAvatar: () => <div data-testid="avatar" />,
}));
vi.mock('@generated/components/ApplyTemplateMenu', () => ({
  ApplyTemplateMenu: () => <div data-testid="apply-template" />,
}));
vi.mock('../UpdatesTripleBox.jsx', () => ({
  UpdatesTripleBox: () => <div data-testid="updates-triple-box" />,
}));

import { TopicsTab } from '../TopicsTab.jsx';

const topics = () => ([
  { id: 't1', name: 'נושא א', _subitems: [{ id: 'p1', name: 'נקודה א1', discussed: false }], notForDiscussion: false },
  { id: 't2', name: 'נושא ב', _subitems: [{ id: 'p2', name: 'נקודה ב1', discussed: false }], notForDiscussion: false },
]);

beforeEach(() => {
  state.items = topics();
  state.loading = false;
});

describe('TopicsTab — staged-create "building" state (round302)', () => {
  it('shows the standard loading animation, not the agenda, while the discussion is still being built', () => {
    render(<TopicsTab discussion={{ id: 'D1', __building: true }} canEdit />);
    // The BrandLoader announces itself as a "טוען" status.
    expect(screen.getByRole('status', { name: 'טוען' })).toBeTruthy();
    expect(screen.getByText('בונה את סדר היום…')).toBeTruthy();
    // No half-built agenda behind it.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByText('נקודה א1')).toBeNull();
  });

  it('renders the agenda (and no loader) once building is done', () => {
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    expect(screen.queryByRole('status', { name: 'טוען' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});

describe('TopicsTab — the ribbon scroll track (round302)', () => {
  it('puts the tiles inside a scrollable track with BOTH "+" pieces pinned outside it', () => {
    const { container } = render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    const track = container.querySelector('.ribbonTrack');
    expect(track).toBeTruthy();
    // every tile is inside the track…
    const tiles = screen.getAllByRole('tab');
    expect(tiles).toHaveLength(2);
    tiles.forEach((tile) => expect(track.contains(tile)).toBe(true));
    // …and neither "+" is, so scrolling can never carry them away.
    const startPlus = screen.getByLabelText('נושא בתחילת הדיון');
    const endPlus = screen.getByLabelText('נושא בסוף הדיון');
    expect(track.contains(startPlus)).toBe(false);
    expect(track.contains(endPlus)).toBe(false);
  });

  it('exposes both scroll chevrons, distinct from the "+" pieces', () => {
    render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    expect(screen.getByLabelText('לנושאים הקודמים')).toBeTruthy();
    expect(screen.getByLabelText('לנושאים הבאים')).toBeTruthy();
  });

  it('shows the drag bar from OVERFLOW alone, never from the thumb it has to size', () => {
    // Regression guard for a deadlock that shipped in review: the bar was
    // display:none until a thumb existed, and the thumb was computed from the
    // bar's clientWidth — which is 0 while hidden. So the thumb never computed,
    // the bar never displayed, and the drag affordance could never appear. Its
    // visibility must therefore depend only on the TRACK's overflow, which is
    // measurable whether or not the bar is currently painted.
    const { container } = render(<TopicsTab discussion={{ id: 'D1' }} canEdit />);
    const bar = container.querySelector('.ribbonSbar');
    expect(bar).toBeTruthy();
    // jsdom reports every width as 0, so the track never overflows here and the
    // bar is correctly hidden. The point of the assertion is the GATE: the class
    // that reveals it must not be the thumb's.
    expect(bar.className).not.toContain('ribbonSbarOn');

    const track = container.querySelector('.ribbonTrack');
    // Force a real overflow the way a browser would report one…
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(track, 'scrollWidth', { value: 900, configurable: true });
    // …and the bar must reveal itself on the next measurement pass, WITHOUT
    // needing a thumb first.
    fireEvent.scroll(track);
    expect(container.querySelector('.ribbonSbar').className).toContain('ribbonSbarOn');
  });
});

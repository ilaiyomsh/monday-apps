import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatusBadge } from '../StatusBadge';
import { TaskCard } from '../TaskCard';

// TaskCard resolves a status id -> label/color via useStatusOptions; mock it so
// the read-only smoke render doesn't hit the SDK and a known label is available.
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [{ id: 1, index: 0, label: 'בוצע', color: '#00c875', isDone: true }],
    labelById: { 1: 'בוצע' },
    colorById: { 1: '#00c875' },
    orderById: { 1: 0 },
    doneId: 1,
    loading: false,
  }),
}));

// Render-level smoke for converted components — catches @vibe/core API misuse
// that compiles but throws on render. Read-only props (no handlers) so no SDK /
// popover / monday-context dependency is hit.
describe('converted component render smoke', () => {
  it('StatusBadge renders the status label', () => {
    render(<StatusBadge label="בעבודה" color="#fdab3d" />);
    expect(screen.getByText('בעבודה')).toBeInTheDocument();
  });

  it('StatusBadge renders a fallback "ללא סטאטוס" for an empty label', () => {
    render(<StatusBadge label="" />);
    expect(screen.getByText('ללא סטאטוס')).toBeInTheDocument();
  });

  it('TaskCard (read-only) renders task name + status', () => {
    const task = {
      id: '1',
      name: 'משימת בדיקה',
      phaseID: 'תיאור',
      statusID: 1, // status is now the stable label id (1 -> 'בוצע')
      responsibilityID: [], // no assignees -> PersonList shows placeholder, no SDK call
      deadlineID: null,
      detailsID: '',
    };
    render(<TaskCard task={task} />);
    expect(screen.getByText('משימת בדיקה')).toBeInTheDocument();
    expect(screen.getByText('בוצע')).toBeInTheDocument();
  });
});

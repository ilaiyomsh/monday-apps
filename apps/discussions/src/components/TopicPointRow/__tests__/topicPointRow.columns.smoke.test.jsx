import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { TopicPointRow } from '../TopicPointRow.jsx';

const POINT = { id: '7', name: 'נקודה לבדיקה', discussed: false, notForDiscussion: false, creatorId: null, decisionIds: [], taskIds: [] };

// useSortable needs the DnD wrappers TopicsTab normally provides.
function renderRow(props) {
  return render(
    <DndContext>
      <SortableContext items={['7']} strategy={verticalListSortingStrategy}>
        <TopicPointRow point={POINT} rowStyle={{}} {...props} />
      </SortableContext>
    </DndContext>
  );
}

describe('TopicPointRow — fixed decisions/tasks table structure (smoke)', () => {
  it('renders the fixed cell order: lead, name, נידונה, החלטות, משימות', () => {
    renderRow({});
    const row = document.querySelector('.row');
    const classes = [...row.children].map((el) => el.className);
    const idx = (c) => classes.findIndex((cls) => cls.includes(c));
    expect(idx('lead')).toBeLessThan(idx('nameCell'));
    expect(idx('nameCell')).toBeLessThan(idx('checkCell'));
    expect(idx('checkCell')).toBeLessThan(idx('decisionsCell'));
    expect(idx('decisionsCell')).toBeLessThan(idx('tasksCell'));
  });

  it('shows the create-from-point buttons only when the create callbacks are provided', () => {
    const { unmount } = renderRow({});
    expect(document.querySelector('[aria-label="החלטה חדשה מהנקודה"]')).toBeNull();
    expect(document.querySelector('[aria-label="משימה חדשה מהנקודה"]')).toBeNull();
    unmount();

    const onCreateDecision = vi.fn();
    const onCreateTask = vi.fn();
    renderRow({ onCreateDecision, onCreateTask });
    const decBtn = document.querySelector('[aria-label="החלטה חדשה מהנקודה"]');
    const taskBtn = document.querySelector('[aria-label="משימה חדשה מהנקודה"]');
    expect(decBtn).toBeTruthy();
    expect(taskBtn).toBeTruthy();
    fireEvent.click(decBtn);
    expect(onCreateDecision).toHaveBeenCalledWith(POINT);
    fireEvent.click(taskBtn);
    expect(onCreateTask).toHaveBeenCalledWith(POINT);
  });

  it('renders the counters and opens the popup callbacks on click', () => {
    const onOpenDecisions = vi.fn();
    const onOpenTasks = vi.fn();
    renderRow({ decisionCount: 2, taskCount: 0, onOpenDecisions, onOpenTasks });
    const decCounter = document.querySelector('[aria-label="הצג החלטות מהנקודה"]');
    const taskCounter = document.querySelector('[aria-label="הצג משימות מהנקודה"]');
    expect(decCounter.textContent).toBe('2');
    expect(taskCounter.textContent).toBe('0');
    // Filled style only when count > 0.
    expect(decCounter.className).toContain('counterDecisionOn');
    expect(taskCounter.className).not.toContain('counterTaskOn');
    fireEvent.click(decCounter);
    expect(onOpenDecisions).toHaveBeenCalledWith(POINT);
    fireEvent.click(taskCounter);
    expect(onOpenTasks).toHaveBeenCalledWith(POINT);
  });

  it('shows the create-progress overlay (pending) then the success ✓ (round 52)', () => {
    // Query the CreateProgressBar by its unique data-variant — dnd-kit injects
    // its OWN role="status" live region into the row, so matching on role alone
    // is ambiguous. Pending on the decisions cell → an in-flight bar ("יוצר…").
    const { unmount } = renderRow({ decisionCreateStatus: 'pending' });
    const pending = document.querySelector('[data-variant="decision"]');
    expect(pending).toBeTruthy();
    expect(pending.getAttribute('aria-label')).toBe('יוצר…');
    unmount();

    // Success on the tasks cell → a green ✓ with the "נוצרה" caption.
    renderRow({ taskCreateStatus: 'success' });
    const done = document.querySelector('[data-variant="task"]');
    expect(done).toBeTruthy();
    expect(done.getAttribute('aria-label')).toBe('נוצרה בהצלחה');
    expect(done.textContent).toContain('נוצרה');
  });

  it('renders NO progress overlay when no create is in flight', () => {
    renderRow({});
    expect(document.querySelector('[data-variant]')).toBeNull();
  });
});

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
  it('round226 — renders the fixed cell order: lead, name, נידונה, תוצרים (unified)', () => {
    renderRow({});
    const row = document.querySelector('.row');
    const classes = [...row.children].map((el) => el.className);
    const idx = (c) => classes.findIndex((cls) => cls.includes(c));
    expect(idx('lead')).toBeLessThan(idx('nameCell'));
    expect(idx('nameCell')).toBeLessThan(idx('checkCell'));
    expect(idx('checkCell')).toBeLessThan(idx('outputsCell'));
    // the two legacy cells are gone
    expect(idx('decisionsCell')).toBe(-1);
    expect(idx('tasksCell')).toBe(-1);
  });

  it('round226 — ONE unified create "+" (תוצר חדש), only when a create callback is provided', () => {
    const { unmount } = renderRow({});
    expect(document.querySelector('[aria-label="תוצר חדש מהנקודה"]')).toBeNull();
    unmount();

    const onCreateDecision = vi.fn();
    const onCreateTask = vi.fn();
    renderRow({ onCreateDecision, onCreateTask });
    const addBtn = document.querySelector('[aria-label="תוצר חדש מהנקודה"]');
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    // the TASK path is preferred (the unified box opens with משימה as default);
    // item 12 anchoring is preserved (the +'s own rect rides along).
    expect(onCreateTask).toHaveBeenCalledWith(POINT, expect.anything());
    expect(onCreateDecision).not.toHaveBeenCalled();
  });

  it('round226 — the unified counter shows the tasks+decisions SUM (only when >0) and opens the popup', () => {
    const onOpenTasks = vi.fn();
    const { unmount } = renderRow({ decisionCount: 2, taskCount: 1, onOpenTasks });
    const counter = document.querySelector('[aria-label="הצג תוצרים מהנקודה"]');
    expect(counter.textContent).toBe('3');
    // the tooltip carries the per-kind breakdown
    expect(counter.getAttribute('title')).toBe('1 משימות · 2 החלטות');
    fireEvent.click(counter);
    expect(onOpenTasks).toHaveBeenCalledWith(POINT);
    unmount();

    // zero outputs → no pill at all (quiet cell)
    renderRow({ decisionCount: 0, taskCount: 0, onOpenTasks });
    expect(document.querySelector('[aria-label="הצג תוצרים מהנקודה"]')).toBeNull();
  });

  it('shows the create-progress overlay (pending) then the success ✓ (round 52)', () => {
    // Query the CreateProgressBar by its unique data-variant — dnd-kit injects
    // its OWN role="status" live region into the row, so matching on role alone
    // is ambiguous. Pending on the decisions cell → an in-flight bar
    // ("יוצר החלטה" — round 54: kind-specific pending label, no ellipsis).
    const { unmount } = renderRow({ decisionCreateStatus: 'pending' });
    const pending = document.querySelector('[data-variant="decision"]');
    expect(pending).toBeTruthy();
    expect(pending.getAttribute('aria-label')).toBe('יוצר החלטה');
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

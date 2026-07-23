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
        <TopicPointRow point={POINT} {...props} />
      </SortableContext>
    </DndContext>
  );
}

describe('TopicPointRow — clean list row structure (round226 stage B smoke)', () => {
  it('round260 — renders the list order: check, name, centered action cluster, spacer (no table cells)', () => {
    renderRow({});
    const row = document.querySelector('.row');
    const classes = [...row.children].map((el) => el.className);
    const idx = (c) => classes.findIndex((cls) => cls.includes(c));
    expect(idx('checkCell')).toBeLessThan(idx('nameCell'));
    // round260 — the actions live in one .pointCluster, followed by a flex
    // .clusterSpacer that balances the name (flex:1) so the cluster is centered.
    expect(idx('nameCell')).toBeLessThan(idx('pointCluster'));
    expect(idx('pointCluster')).toBeLessThan(idx('clusterSpacer'));
    // the legacy table cells / split action+outputs cells are gone
    expect(idx('lead')).toBe(-1);
    expect(idx('rowActs')).toBe(-1);
    expect(idx('outputsCell')).toBe(-1);
  });

  it('round226b — the discussed state draws the green check and strikes the name', () => {
    const { unmount } = renderRow({});
    // Unchecked: the check button is pressable and unpressed; the row has no done class.
    const btn = document.querySelector('[aria-label="סמן כנידונה"]');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.rowDone')).toBeNull();
    unmount();

    renderRow({ point: { ...POINT, discussed: true } });
    const on = document.querySelector('[aria-label="נידונה — בטל סימון"]');
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.rowDone')).toBeTruthy();
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
    const zero = renderRow({ decisionCount: 0, taskCount: 0, onOpenTasks });
    expect(document.querySelector('[aria-label="הצג תוצרים מהנקודה"]')).toBeNull();
    zero.unmount();

    // exactly ONE output → the pill ALREADY shows (threshold is >0, not >1)
    renderRow({ decisionCount: 0, taskCount: 1, onOpenTasks });
    expect(document.querySelector('[aria-label="הצג תוצרים מהנקודה"]').textContent).toBe('1');
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

  it('round229 — the "עדכונים" (updates) affordance is GONE from a point row', () => {
    renderRow({});
    expect(document.querySelector('[aria-label="פתח עדכונים"]')).toBeNull();
  });

  it('round232 — a per-point trash button deletes via onDelete; absent without it or when hidden', () => {
    const onDelete = vi.fn();
    const { unmount } = renderRow({ onDelete });
    const trash = document.querySelector('[aria-label="מחק נקודה: נקודה לבדיקה"]');
    expect(trash).toBeTruthy();
    fireEvent.click(trash);
    expect(onDelete).toHaveBeenCalledWith(POINT);
    unmount();

    // No handler → no trash.
    const noHandler = renderRow({});
    expect(document.querySelector('[aria-label^="מחק נקודה"]')).toBeNull();
    noHandler.unmount();

    // Hidden (notForDiscussion) row is inert → no trash even with a handler.
    renderRow({ onDelete, point: { ...POINT, notForDiscussion: true } });
    expect(document.querySelector('[aria-label^="מחק נקודה"]')).toBeNull();
  });

  it('round260 — inside the cluster the RTL order is +, count, creator, delete', () => {
    renderRow({
      onCreateTask: vi.fn(),
      onDelete: vi.fn(),
      decisionCount: 1,
      taskCount: 1,
      point: { ...POINT, creatorId: '99' },
      usersById: { 99: { name: 'דנה' } },
    });
    const cluster = document.querySelector('.pointCluster');
    const kids = [...cluster.children];
    const add = kids.findIndex((el) => el.getAttribute('aria-label') === 'תוצר חדש מהנקודה');
    const count = kids.findIndex((el) => el.getAttribute('aria-label') === 'הצג תוצרים מהנקודה');
    const creator = kids.findIndex((el) => el.className.includes('creatorAvatar'));
    const del = kids.findIndex((el) => (el.getAttribute('aria-label') || '').startsWith('מחק נקודה'));
    expect(add).toBeGreaterThanOrEqual(0);
    // DOM order = RTL right→left: + first (rightmost), then count, creator, delete (leftmost).
    expect(add).toBeLessThan(count);
    expect(count).toBeLessThan(creator);
    expect(creator).toBeLessThan(del);
  });

  it('round260 — clicking the point text enters inline edit (the pencil button is gone)', () => {
    renderRow({});
    // the hover pencil button was removed…
    expect(document.querySelector('[aria-label="ערוך שם נקודה: נקודה לבדיקה"]')).toBeNull();
    // …and a single click on the name opens the inline editor input.
    expect(document.querySelector('[aria-label="ערוך שם נקודה"]')).toBeNull();
    fireEvent.click(document.querySelector('.name'));
    expect(document.querySelector('[aria-label="ערוך שם נקודה"]')).toBeTruthy();
  });

  it('round260 — a read-only point does NOT enter edit on click', () => {
    renderRow({ canEditPoint: false });
    fireEvent.click(document.querySelector('.name'));
    expect(document.querySelector('[aria-label="ערוך שם נקודה"]')).toBeNull();
  });

  it('round233 — a six-dot drag grip renders at the row START (editable, not hidden)', () => {
    const { unmount } = renderRow({});
    expect(document.querySelector('[aria-label^="גרירה לשינוי סדר"]')).toBeTruthy();
    // first child of the row (rightmost in rtl → the leading edge)
    expect(document.querySelector('.row').firstElementChild.className).toContain('dragGrip');
    unmount();

    // Read-only point → no grip.
    const ro = renderRow({ canEditPoint: false });
    expect(document.querySelector('[aria-label^="גרירה לשינוי סדר"]')).toBeNull();
    ro.unmount();

    // Hidden (inert) point → no grip.
    renderRow({ point: { ...POINT, notForDiscussion: true } });
    expect(document.querySelector('[aria-label^="גרירה לשינוי סדר"]')).toBeNull();
  });
});

import React, { useState } from 'react';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './SortableColumnHeader.module.css';

/*
 * Drag-to-reorder for table column HEADERS, shared by MyTasksTable and TaskTable.
 * Uses @dnd-kit with a DragOverlay so the dragged column shows a tall floating
 * "ghost" that follows the cursor FREELY (both axes) — the original header cell
 * stays in place as a dimmed drop-placeholder while siblings reflow horizontally.
 * The whole header cell is the drag handle; the right-edge ResizeHandle stops its
 * own pointerdown so resizing never starts a reorder.
 *
 * Usage: wrap header cells in <ColumnHeaderDnd enabled ids labels onReorder> and
 * render each MOVABLE header cell via <SortableHeaderCell>. `labels` (key→text)
 * feeds the ghost preview. Pinned (frozen) cells like the name column stay plain
 * <div>s. When `enabled` is false the wrapper is a passthrough, so
 * SortableHeaderCell is only ever mounted inside a DndContext.
 */
export function ColumnHeaderDnd({ enabled, ids, labels = {}, onReorder, children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState(null);

  if (!enabled) return <>{children}</>;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>
      {/* Floating ghost — follows the pointer freely (up/down + sideways). */}
      <DragOverlay>
        {activeId ? <div className={styles.ghost}>{labels[activeId] ?? ''}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function SortableHeaderCell({ id, className, style, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(id) });
  // Siblings reflow horizontally (lock Y on the in-list transform); the floating
  // DragOverlay is what moves with the cursor. The active cell dims as a
  // drop-placeholder.
  const cellStyle = {
    ...style,
    transform: transform ? CSS.Transform.toString({ ...transform, y: 0 }) : undefined,
    transition,
    position: 'relative',
    cursor: 'grab',
    touchAction: 'none',
    opacity: isDragging ? 0.35 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${styles.draggable}`}
      style={cellStyle}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export default ColumnHeaderDnd;

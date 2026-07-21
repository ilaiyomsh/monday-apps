import React, { useMemo, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { HighlightedText } from '@generated/components/HighlightedText';
import { getTaskDiscussion } from './grouping.js';
import styles from './MyTasksCardList.module.css';

/*
 * round208 — the MOBILE renderer for one "המשימות שלי" group: stacked task CARDS
 * instead of the wide sticky table (owner spec):
 *   · card = task name (tap opens the monday item card) + the linked discussion
 *     name — HIDDEN when the view is already grouped by discussion — and a
 *     bottom chips row: priority + deadline on the RIGHT, status alone on the
 *     bottom-LEFT.
 *   · tapping a chip opens a bottom sheet with big touch targets; edits are
 *     permission-gated per task (no handler → plain read-only chip).
 *   · long-press-drag reorders cards (dnd-kit, delay-activated so scrolling
 *     still works); the parent persists the new order per user.
 */

const NEUTRAL = 'var(--ui-border-color, #c4c4c4)';

const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
  ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  : null);

const isOverdue = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
};

// round214 — the deadline sheet's own HEBREW, RTL month calendar (owner spec):
// the native <input type="date"> opened the OS picker whose header is
// English/LTR and can't be localized. Sunday (א׳) is the rightmost column;
// the chevron on the RIGHT goes to the PREVIOUS month (Hebrew calendar
// convention); tapping a day picks it.
const DOW_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function MobileHebrewCalendar({ value, onPick }) {
  const today = new Date();
  const valid = value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  const seed = valid || today;
  const [view, setView] = useState(() => new Date(seed.getFullYear(), seed.getMonth(), 1));
  const monthLabel = view.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  const firstDow = view.getDay(); // 0 = Sunday (א׳)
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const sameDay = (d, ref) => ref
    && ref.getFullYear() === view.getFullYear()
    && ref.getMonth() === view.getMonth()
    && ref.getDate() === d;
  return (
    <div className={styles.cal} dir="rtl">
      <div className={styles.calHead}>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
          aria-label="חודש קודם"
        >
          ›
        </button>
        <span className={styles.calMonth}>{monthLabel}</span>
        <button
          type="button"
          className={styles.calNav}
          onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
          aria-label="חודש הבא"
        >
          ‹
        </button>
      </div>
      <div className={styles.calGrid}>
        {DOW_HE.map((d) => <span key={d} className={styles.calDow}>{d}</span>)}
        {Array.from({ length: firstDow }, (_, i) => <span key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            type="button"
            className={`${styles.calDay} ${sameDay(d, valid) ? styles.calDaySel : ''} ${sameDay(d, today) ? styles.calDayToday : ''}`}
            onClick={() => onPick(new Date(view.getFullYear(), view.getMonth(), d))}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortableCard({ task, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(task.id) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export function MyTasksCardList({
  tasks,
  color = null,
  showDiscussion = true,
  statusOptions = [],
  priorityOptions = [],
  statusLabelById = {},
  statusColorById = {},
  priorityLabelById = {},
  priorityColorById = {},
  canTask = () => true,
  onStatusChange,
  onPriorityChange,
  onDeadlineChange,
  onReorder,
  searchTerm = '',
  newTaskRow = null,
}) {
  // Bottom sheet state: which task + which field ('status' | 'priority' | 'deadline').
  const [sheet, setSheet] = useState(null);
  const closeSheet = () => setSheet(null);

  // Long-press activation so vertical scrolling still works; mouse drags (dev)
  // activate on a small distance instead.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const ids = useMemo(() => tasks.map((t) => String(t.id)), [tasks]);

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !onReorder) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  const sheetTask = sheet ? tasks.find((t) => String(t.id) === String(sheet.taskId)) : null;

  const chip = (allowed, fill, text, empty, onOpen, extraClass = '') => (allowed ? (
    <button
      type="button"
      className={`${styles.chip} ${fill ? '' : styles.chipEmpty} ${extraClass}`}
      style={fill ? { background: fill } : undefined}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {text ?? empty}
    </button>
  ) : (
    <span
      className={`${styles.chip} ${styles.chipStatic} ${fill ? '' : styles.chipEmpty} ${extraClass}`}
      style={fill ? { background: fill } : undefined}
    >
      {text ?? empty}
    </span>
  ));

  return (
    <div className={styles.stack} dir="rtl">
      {newTaskRow && (
        <div className={styles.card} style={{ borderStyle: 'dashed' }}>
          <input
            className={styles.newInput}
            autoFocus
            defaultValue=""
            placeholder={newTaskRow.defaultName || 'משימה חדשה'}
            aria-label="שם המשימה החדשה"
            onKeyDown={(e) => {
              if (e.key === 'Enter') newTaskRow.onCommit(e.target.value);
              else if (e.key === 'Escape') newTaskRow.onCancel();
            }}
            onBlur={(e) => {
              if (e.target.value.trim()) newTaskRow.onCommit(e.target.value);
              else newTaskRow.onCancel();
            }}
          />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => {
            const discussion = getTaskDiscussion(task);
            const statusFill = task.statusID != null && statusLabelById[task.statusID] != null
              ? (statusColorById[task.statusID] || NEUTRAL) : null;
            const prioFill = task.priorityID != null && priorityLabelById[task.priorityID] != null
              ? (priorityColorById[task.priorityID] || NEUTRAL) : null;
            const deadlineText = fmtDate(task.deadlineID);
            const late = isOverdue(task.deadlineID);
            return (
              <SortableCard key={task.id} task={task}>
                <div className={styles.card} data-testid="mytask-card">
                  {color ? <span className={styles.stripe} style={{ background: color }} /> : null}
                  <button
                    type="button"
                    className={styles.name}
                    title={task.name}
                    onClick={() => openOrToggleItemCard(task.id)}
                  >
                    <HighlightedText text={task.name} query={searchTerm} />
                  </button>
                  {showDiscussion && discussion?.name ? (
                    <div className={styles.disc}>{discussion.name}</div>
                  ) : null}
                  <div className={styles.chipsRow}>
                    {/* RIGHT side (RTL start): priority + deadline */}
                    <div className={styles.chipsStart}>
                      {chip(
                        Boolean(onPriorityChange && canTask('editTaskPriority', task)),
                        prioFill,
                        priorityLabelById[task.priorityID],
                        'עדיפות',
                        () => setSheet({ taskId: task.id, kind: 'priority' }),
                      )}
                      {chip(
                        Boolean(onDeadlineChange && canTask('editTaskDeadline', task)),
                        null,
                        deadlineText ? `📅 ${deadlineText}` : null,
                        '📅 ללא תאריך',
                        () => setSheet({ taskId: task.id, kind: 'deadline' }),
                        late ? styles.chipLate : '',
                      )}
                    </div>
                    {/* LEFT side (RTL end): status alone — owner spec round208 */}
                    <div className={styles.chipsEnd}>
                      {chip(
                        Boolean(onStatusChange && canTask('editTaskStatus', task)),
                        statusFill,
                        statusLabelById[task.statusID],
                        'סטטוס',
                        () => setSheet({ taskId: task.id, kind: 'status' }),
                      )}
                    </div>
                  </div>
                </div>
              </SortableCard>
            );
          })}
        </SortableContext>
      </DndContext>

      {sheet && sheetTask && (
        <>
          <div className={styles.backdrop} onClick={closeSheet} />
          <div className={styles.sheet} role="dialog" aria-label="עריכת משימה">
            <div className={styles.grip} />
            <div className={styles.sheetTitle}>{sheetTask.name}</div>
            {sheet.kind === 'status' && statusOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.sheetOpt}
                style={{ background: opt.color || NEUTRAL }}
                onClick={() => { onStatusChange?.(sheetTask.id, opt.id); closeSheet(); }}
              >
                {opt.label}
              </button>
            ))}
            {sheet.kind === 'priority' && priorityOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.sheetOpt}
                style={{ background: opt.color || NEUTRAL }}
                onClick={() => { onPriorityChange?.(sheetTask.id, opt.id); closeSheet(); }}
              >
                {opt.label}
              </button>
            ))}
            {sheet.kind === 'deadline' && (
              <div className={styles.dateBody}>
                <MobileHebrewCalendar
                  value={sheetTask.deadlineID}
                  onPick={(d) => { onDeadlineChange?.(sheetTask.id, d); closeSheet(); }}
                />
                <button
                  type="button"
                  className={styles.sheetGhost}
                  onClick={() => { onDeadlineChange?.(sheetTask.id, null); closeSheet(); }}
                >
                  נקה תאריך
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default MyTasksCardList;

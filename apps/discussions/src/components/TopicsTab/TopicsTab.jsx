import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton, Button, TextField, Dialog, DialogContentContainer, Text, Checkbox } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import { useUsers } from '@generated/utils/mondayApi/hooks/use-users.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { Plus, ChevronDown, Eye, EyeOff } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTopics } from '@generated/hooks/useTopics';
import { useColumnWidths } from '@generated/hooks/useColumnWidths.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { TOPICS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import { TopicPointRow, RowKebabMenu, CreatorAvatar } from '@generated/components/TopicPointRow';
import { ApplyTemplateMenu } from '@generated/components/ApplyTemplateMenu';
import { PointItemsPopup } from '@generated/components/PointItemsPopup';
import styles from './TopicsTab.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Column order for the points table (decisions redesign — per the approved
// mockup): [checkbox lead 36px] | נקודה לדיון (fill) | נידונה | החלטות | משימות.
// The leading cell is a FIXED 36px track — the selection checkbox + accent strip,
// matching TaskTable's `.selectCell`; the other four keys resize via
// useColumnWidths under the shared 'topics' tableId (owner-draggable, persisted
// for all users). Widths/clamps come from constants/columnWidths TOPICS_COLUMN_WIDTHS.
const LEAD_TRACK = '36px';
const TOPIC_COLUMN_KEYS = ['name', 'check', 'decisions', 'tasks'];

// Per-topic priority box — identical look to the status column: FIXED width,
// centered label, white text on the status color (label text + colors come from
// the column itself via useStatusOptions), NO chevron. Empty = grey "עדיפות".
function PriorityPill({ value, options, labelById, colorById, canEdit, onChange }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom-end');
  const triggerRef = useRef(null);

  const has = value != null && labelById?.[value] != null;
  const label = has ? labelById[value] : 'עדיפות';
  const fill = has ? (colorById?.[value] || NEUTRAL) : null;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect, preferred: 'bottom-end',
      popupWidth: 180, popupHeight: Math.max(160, (options?.length || 0) * 44 + 16), offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={`${styles.prio} ${has ? styles.prioSet : styles.prioNone}`}
      style={has ? { background: fill } : undefined}
      onMouseDown={canEdit ? updatePosition : undefined}
      title="עדיפות"
    >
      {label}
    </button>
  );

  if (!canEdit) return <span className={styles.prioWrap}>{trigger}</span>;

  return (
    <span className={styles.prioWrap} onClick={(e) => e.stopPropagation()}>
      <Dialog
        open={open}
        showTrigger={['click']}
        hideTrigger={['clickoutside', 'esc', 'onContentClick']}
        onDialogDidShow={() => { updatePosition(); setOpen(true); }}
        onDialogDidHide={() => setOpen(false)}
        position={position}
        zIndex={1000}
        content={() => (
          <DialogContentContainer>
            <div className={styles.prioMenu}>
              {(options || []).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={styles.prioOption}
                  style={{ background: opt.color || NEUTRAL }}
                  onClick={() => { onChange(opt.id); setOpen(false); }}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className={`${styles.prioOption} ${styles.prioOptionNone}`}
                onClick={() => { onChange(null); setOpen(false); }}
              >
                ללא עדיפות
              </button>
            </div>
          </DialogContentContainer>
        )}
      >
        {trigger}
      </Dialog>
    </span>
  );
}

// Select-all-in-topic checkbox — checked when every point of the topic is
// selected, indeterminate when some are. Toggles the whole topic's points.
function TopicSelectAll({ points, selectedPointIds, onToggleTopicPoints }) {
  const ids = points.map((p) => String(p.id));
  const selCount = ids.reduce((n, id) => n + (selectedPointIds?.has(id) ? 1 : 0), 0);
  const allChecked = ids.length > 0 && selCount === ids.length;
  const indeterminate = selCount > 0 && selCount < ids.length;
  return (
    <Checkbox
      checked={allChecked}
      indeterminate={indeterminate}
      onChange={(e) => onToggleTopicPoints?.(points, e.target.checked)}
      ariaLabel={allChecked ? 'בטל בחירת נושא' : 'בחר את כל נקודות הנושא'}
    />
  );
}

const TOPIC_SKELETON_H = 44;

/* 20-color monday LABEL palette (see theme-tokens.css --topic-color-1..20). */
const TOPIC_COLOR_COUNT = 20;
function topicColorStartIndex(id, seed = 0) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return (h + seed) % TOPIC_COLOR_COUNT;
}

/* One topic = a GROUP (mockup structure): a header row (hover kebab, collapse
   chevron, drag grip, accent-colored name, "discussed/total" chip, spacer,
   priority pill) + a fixed column-header row + the topic's point rows as a
   table + the add-point row. */
function SortableTopicSection({
  topic, accent, open, onToggleOpen, usersById,
  renameTopic,
  // Optimistic-create error affordance (topic OR its points): retry re-runs the
  // failed create; dismissal reuses the existing kebab delete / point trash.
  onRetryCreate,
  deleteTopic, addPoint, togglePoint,
  togglePointNotForDiscussion, toggleTopicNotForDiscussion,
  renamePoint, deletePoint, reorderPoints,
  // Shared fixed grid template (same object for header + rows).
  rowStyle,
  // Granular discussion-tier caps (each equals the legacy canEdit while the
  // feature is off). add → add topic/point; edit → rename/priority/drag-reorder;
  // del → delete/hide; check → "נידונה" toggle.
  canAdd = true, canEditTopic = true, canDelete = true, canCheck = true,
  priorityMapped = false, priorityOptions, priorityLabelById, priorityColorById, updateTopicPriority,
  // Decisions/tasks-from-point wiring (threaded from TopicsTab).
  onCreatePointDecision, onCreatePointTask, onOpenPointItems,
  // Owner column-resize (shared 'topics' tableId): when canResize, each column
  // header cell gets a ResizeHandle whose drag calls startResize(key, e). The
  // widths are shared across every topic section (one grid template).
  canResize = false, startResize,
  // Multi-select (Round 7): when `selectable`, each point row shows a checkbox;
  // selection is tracked by point id in the parent. The section header hosts a
  // select-all-in-topic checkbox.
  selectable = false, selectedPointIds, onTogglePointSelect, onToggleTopicPoints,
  // Sets of the discussion's REAL decision/task ids — the per-point counters
  // intersect the point's linked ids with these so the count is accurate.
  decisionIdSet, taskIdSet,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(topic.id) });
  const accentTri = `var(${accent})`;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    '--topic-accent': `hsl(${accentTri})`,
  };

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(topic.name || '');
  const [newPointText, setNewPointText] = useState('');
  const [showAddPointInput, setShowAddPointInput] = useState(false);
  const addPointInputRef = useRef(null);
  // Single click on the title toggles collapse/expand (same as the chevron);
  // double click renames. A short timer defers the toggle so a double-click
  // opens rename WITHOUT the collapse flicker (React fires onClick before
  // onDoubleClick). The pending toggle is cancelled when the dblclick lands.
  const titleClickTimerRef = useRef(null);

  const points = topic._subitems || [];
  const excluded = topic.notForDiscussion === true;
  // Background create failed: keep the topic + show a clear error + retry in the
  // header (dismissal = the existing kebab "מחק", which removes a temp row locally).
  const topicFailed = topic._createFailed === true;
  const effectiveOpen = open && !excluded;

  const forDiscussion = points.filter((p) => p.notForDiscussion !== true);
  const discussedCount = forDiscussion.filter((p) => p.discussed === true).length;
  const total = forDiscussion.length;

  // Pill visibility (mockup): shown when the topic HAS a priority label; kept
  // visible (grey "עדיפות" placeholder) for editors so they can still set one.
  const hasPriorityLabel = topic.priority != null && priorityLabelById?.[topic.priority] != null;

  // Activation distance (8px) lets a plain click inside a cell edit/toggle while
  // a small press-move starts the whole-row drag (native monday board feel).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const handlePointDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = points.map((p) => String(p.id));
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderPoints(topic.id, arrayMove(ids, oldIndex, newIndex));
  };

  const handleAddPoint = () => {
    const t = newPointText.trim();
    if (!t) return;
    addPoint(topic.id, t);
    setNewPointText('');
    addPointInputRef.current?.focus();
  };

  const saveTopicTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== topic.name && renameTopic) renameTopic(topic.id, trimmed);
    setEditingTitle(false);
  };

  // Whole-header drag (native monday feel): the sortable listeners/attributes
  // ride on the section HEADER when the topic is editable — no six-dot grip. The
  // PointerSensor activation distance (TopicsTab, ~8px) keeps a plain click on
  // the chevron/title/eye/kebab working; only a press-move starts a group drag.
  const headerDragProps = canEditTopic ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.section} ${excluded ? styles.sectionExcluded : ''}`}
    >
      <div
        className={`${styles.sectionHeader} ${canEditTopic ? styles.sectionHeaderDraggable : ''}`}
        {...headerDragProps}
      >
        {/* Hover-revealed 3-dot kebab (⋯) at the LEFT of the group header —
            deletes the WHOLE topic (inline confirm-before-delete). Matches
            monday's group ⋯ menu: hidden at rest, opacity 0→1 on header hover
            (styles in .headerKebab). No select-all checkbox lives here anymore —
            the per-topic select-all moved into the points' column-header leading
            cell, so this group-title row reads like the Tasks group header
            (chevron + colored title + the kept eye/count/avatar/priority). */}
        {canDelete && (
          <RowKebabMenu
            excluded={excluded}
            kind="נושא"
            className={styles.headerKebab}
            onDelete={() => deleteTopic(topic.id)}
          />
        )}
        <button
          type="button"
          className={styles.triangle}
          onClick={excluded ? undefined : onToggleOpen}
          disabled={excluded}
          aria-label={effectiveOpen ? 'קפל נושא' : 'פתח נושא'}
          title={excluded ? 'נושא מוסתר' : (effectiveOpen ? 'קפל' : 'פתח')}
        >
          <ChevronDown size={16} className={`${styles.chevron} ${effectiveOpen ? '' : styles.chevronCollapsed}`} />
        </button>

        {editingTitle ? (
          <input
            className={styles.titleInput}
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveTopicTitle(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); setTitleDraft(topic.name || ''); }
            }}
            onBlur={saveTopicTitle}
            aria-label="ערוך שם נושא"
          />
        ) : (
          <span className={styles.titleWrap}>
            <span
              className={styles.title}
              style={{ color: `hsl(${accentTri})`, opacity: excluded ? 0.5 : 1, cursor: excluded ? 'default' : 'pointer' }}
              role={excluded ? undefined : 'button'}
              aria-label={excluded ? undefined : (effectiveOpen ? 'קפל נושא' : 'פתח נושא')}
              onClick={excluded ? undefined : () => {
                // Defer the toggle so a following double-click (rename) can cancel it.
                if (titleClickTimerRef.current) clearTimeout(titleClickTimerRef.current);
                titleClickTimerRef.current = setTimeout(() => {
                  titleClickTimerRef.current = null;
                  onToggleOpen();
                }, 220);
              }}
              onDoubleClick={!excluded ? (e) => {
                e.preventDefault(); e.stopPropagation();
                if (titleClickTimerRef.current) { clearTimeout(titleClickTimerRef.current); titleClickTimerRef.current = null; }
                if (canEditTopic) { setTitleDraft(topic.name || ''); setEditingTitle(true); }
              } : undefined}
              title={topic.name}
            >
              {topic.name}
            </span>
          </span>
        )}

        {/* Eye toggle — hide/show the topic, placed at the right edge of the
            name. Single click toggles the not-for-discussion flag (replaces the
            old kebab \"הסתר/הצג\"). */}
        {canEditTopic && (
          <button
            type="button"
            className={styles.eyeBtn}
            onClick={(e) => { e.stopPropagation(); toggleTopicNotForDiscussion && toggleTopicNotForDiscussion(topic.id, !excluded); }}
            aria-label={excluded ? 'הצג נושא' : 'הסתר נושא'}
            title={excluded ? 'הצג נושא' : 'הסתר נושא'}
          >
            {excluded ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}

        {/* "discussed/total" chip sits right after the title (mockup). */}
        <span className={styles.count} title="נדונו מתוך סך הנקודות לדיון (ללא מוסתרות)">
          {discussedCount}/{total}
        </span>

        {/* Creator avatar — revealed only while hovering the topic's header. */}
        <span className={styles.headerAvatar}>
          <CreatorAvatar userId={topic.creatorId} usersById={usersById} />
        </span>

        <span className={styles.headerSpacer} />

        {priorityMapped && (hasPriorityLabel || canEditTopic) && (
          <PriorityPill
            value={topic.priority}
            options={priorityOptions}
            labelById={priorityLabelById}
            colorById={priorityColorById}
            canEdit={canEditTopic}
            onChange={(labelId) => updateTopicPriority && updateTopicPriority(topic.id, labelId)}
          />
        )}

        {topicFailed && onRetryCreate && (
          <button
            type="button"
            className={styles.topicRetryBtn}
            onClick={(e) => { e.stopPropagation(); onRetryCreate(topic.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            title="שמירת הנושא נכשלה — נסה שוב"
          >
            שמירה נכשלה · נסה שוב
          </button>
        )}
      </div>

      {effectiveOpen && (
        <div className={styles.sectionBody}>
          {/* Column header — SAME grid template as the point rows (shared via
              rowStyle). Owners get a ResizeHandle on each column's trailing edge
              (the cell becomes a positioning context for the absolute handle). */}
          <div className={styles.colHead} style={rowStyle}>
            {/* Leading cell — hosts the per-topic SELECT-ALL checkbox (relocated
                here from the group-title row), mirroring how TaskTable puts the
                group select-all in the table header's leading `.selectCell`. It
                selects/deselects every point of this topic; when the topic has no
                points (or selection is off) it's just the bare accent strip. */}
            <span className={`${styles.colHeadLead} ${styles.frozenLead}`}>
              {selectable && points.length > 0 && (
                <span
                  className={styles.colHeadSelect}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <TopicSelectAll
                    points={points}
                    selectedPointIds={selectedPointIds}
                    onToggleTopicPoints={onToggleTopicPoints}
                  />
                </span>
              )}
            </span>
            {/* Frozen name header — sticky (its own positioning context) so it
                pins during horizontal scroll AND hosts the resize handle, exactly
                like TaskTable's frozen `.taskFirst`. No inline `relative` here:
                the sticky class provides the absolute handle's containing block. */}
            <span className={`${styles.colHeadCell} ${styles.colHeadName}`}>
              {canResize && <ResizeHandle onMouseDown={(e) => startResize('name', e)} />}
            </span>
            <span className={`${styles.colHeadCell} ${styles.colHeadCenter}`} style={canResize ? { position: 'relative' } : undefined}>
              נידונה
              {canResize && <ResizeHandle onMouseDown={(e) => startResize('check', e)} />}
            </span>
            <span className={`${styles.colHeadCell} ${styles.colHeadCenter}`} style={canResize ? { position: 'relative' } : undefined}>
              החלטות
              {canResize && <ResizeHandle onMouseDown={(e) => startResize('decisions', e)} />}
            </span>
            <span className={`${styles.colHeadCell} ${styles.colHeadCenter}`} style={canResize ? { position: 'relative' } : undefined}>
              משימות
              {canResize && <ResizeHandle onMouseDown={(e) => startResize('tasks', e)} />}
            </span>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePointDragEnd}>
            <SortableContext items={points.map((p) => String(p.id))} strategy={verticalListSortingStrategy}>
              {points.map((point) => (
                <TopicPointRow
                  key={point.id}
                  point={point}
                  rowStyle={rowStyle}
                  onToggle={togglePoint}
                  onToggleNotForDiscussion={togglePointNotForDiscussion}
                  onRename={renamePoint}
                  onDelete={deletePoint}
                  onRetryCreate={onRetryCreate}
                  canEditPoint={canEditTopic}
                  canDelete={canDelete}
                  canCheck={canCheck}
                  decisionCount={decisionIdSet
                    ? (point.decisionIds || []).filter((id) => decisionIdSet.has(String(id))).length
                    : (point.decisionIds || []).length}
                  taskCount={taskIdSet
                    ? (point.taskIds || []).filter((id) => taskIdSet.has(String(id))).length
                    : (point.taskIds || []).length}
                  // Stamp the parent topic id onto the scoped point — the
                  // quick-create task flow links the new task to the topic too.
                  onCreateDecision={onCreatePointDecision ? () => onCreatePointDecision({ ...point, topicId: topic.id }) : undefined}
                  onCreateTask={onCreatePointTask ? () => onCreatePointTask({ ...point, topicId: topic.id }) : undefined}
                  onOpenDecisions={(p) => onOpenPointItems('decision', p)}
                  onOpenTasks={(p) => onOpenPointItems('task', p)}
                  selectable={selectable}
                  selected={selectable ? !!selectedPointIds?.has(String(point.id)) : false}
                  onToggleSelect={(p, checked) => onTogglePointSelect?.(p, checked)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {canAdd && (
            showAddPointInput ? (
              // Editing: a full-width row (same look as the add-task row) with an
              // inline, borderless text input — click already happened.
              <div className={styles.addPoint}>
                <Plus size={16} className={styles.addPointIcon} />
                <input
                  ref={addPointInputRef}
                  className={styles.addPointInput}
                  autoFocus
                  value={newPointText}
                  aria-label="הוסף נקודה"
                  placeholder="נקודה לדיון…"
                  onChange={(e) => setNewPointText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPointText.trim()) { e.preventDefault(); handleAddPoint(); }
                    if (e.key === 'Escape') { setNewPointText(''); setShowAddPointInput(false); e.currentTarget.blur(); }
                  }}
                  onBlur={() => { if (!newPointText.trim()) { setNewPointText(''); setShowAddPointInput(false); } }}
                />
              </div>
            ) : (
              // Rest state: the WHOLE row is the click target (like the add-task
              // row); shows only a "+", no label. Clicking anywhere opens editing.
              <button
                type="button"
                className={styles.addPoint}
                aria-label="הוסף נקודה"
                title="הוסף נקודה"
                onClick={() => {
                  setShowAddPointInput(true);
                  requestAnimationFrame(() => addPointInputRef.current?.focus());
                }}
              >
                <Plus size={16} className={styles.addPointIcon} />
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function TopicsTab({
  discussion, createTask, onNotify, onNotifyLoading, onDismissToast,
  // Granular discussion-tier caps. Each equals the legacy canEdit while the
  // permissions feature is off, so behavior is unchanged; Phase 3 lets a role
  // grant some and not others.
  addTopicOrPoint = true, editTopicOrPoint = true, deleteTopicOrPoint = true,
  checkPoint = true, editResponses = true, // editResponses kept for prop compat (התייחסויות column removed from display)
  // Owners (can('reorderColumns')) may drag-resize the topics columns; the
  // widths persist per-instance under the shared 'topics' tableId (all users).
  canReorderColumns = false,
  // Decisions redesign wiring (per the approved mockup):
  //   onCreateFromPoint(kind, point) — kind: 'decision' | 'task'; opens the
  //     parent's quick-create flow scoped to the point. The dashed "+" buttons
  //     render only when this is provided (parent gates by capability).
  //   decisionsItems / tasksItems — the discussion's ALREADY-LOADED decision /
  //     task lists (from useDecisions / useTasks in DiscussionCard); the counter
  //     popup resolves linked ids against them — NO new queries here.
  onCreateFromPoint,
  decisionsItems = [], tasksItems = [],
}) {
  const {
    items, loading, addTopic, addPoint, retryCreate, togglePoint, refetch,
    togglePointNotForDiscussion, toggleTopicNotForDiscussion, updateTopicPriority,
    renameTopic, deleteTopic, renamePoint, deletePoint, reorderTopics, reorderPoints,
  } = useTopics(discussion.id, { onSuccess: onNotify, onLoading: onNotifyLoading, onDismiss: onDismissToast });

  const priorityMapped = !!getColumns('topics')?.topicPriorityID?.id;
  const priorityOpts = useStatusOptions('topics', 'topicPriorityID');

  // Sets of the discussion's REAL, still-existing decision / task ids (from the
  // prefetched lists in DiscussionCard). The per-point החלטות/משימות counters
  // intersect the point's linked ids (pointDecisionsLinkID / pointTasksLinkID)
  // with these, so the count reflects decisions/tasks that ACTUALLY exist and
  // are linked to the point — deleted/stale linked ids no longer inflate it, and
  // when the subitem link column is unmapped the point simply has no linked ids
  // (count 0). This is what makes the Topics "החלטות" count show a real number
  // instead of a stale/blank value.
  const decisionIdSet = useMemo(
    () => new Set((decisionsItems || []).map((d) => String(d.id))),
    [decisionsItems]
  );
  const taskIdSet = useMemo(
    () => new Set((tasksItems || []).map((t) => String(t.id))),
    [tasksItems]
  );

  // ---- Multi-select of POINTS (Round 7) — a checkbox per point + a floating
  // bulk bar (delete / hide the selected points). Offered when the user can edit
  // or delete points; while permissions are off this equals the legacy gate. ----
  const canSelectPoints = !!(deleteTopicOrPoint || editTopicOrPoint);
  const [selectedPointIds, setSelectedPointIds] = useState(() => new Set());
  // Map of point id -> its point object (for resolving the selection to actions).
  const pointById = useMemo(() => {
    const m = new Map();
    items.forEach((t) => (t._subitems || []).forEach((p) => m.set(String(p.id), p)));
    return m;
  }, [items]);
  // Prune ids that no longer exist (after a delete / refetch).
  useEffect(() => {
    setSelectedPointIds((cur) => {
      if (cur.size === 0) return cur;
      const next = new Set();
      cur.forEach((id) => { if (pointById.has(String(id))) next.add(String(id)); });
      return next.size === cur.size ? cur : next;
    });
  }, [pointById]);
  const togglePointSelect = (point, checked) => setSelectedPointIds((prev) => {
    const n = new Set(prev); const id = String(point.id);
    if (checked) n.add(id); else n.delete(id); return n;
  });
  const toggleTopicPoints = (points, checked) => setSelectedPointIds((prev) => {
    const n = new Set(prev);
    (points || []).forEach((p) => { const id = String(p.id); if (checked) n.add(id); else n.delete(id); });
    return n;
  });
  const clearPointSelection = () => setSelectedPointIds(new Set());
  const selectedPoints = useMemo(
    () => [...selectedPointIds].map((id) => pointById.get(String(id))).filter(Boolean),
    [selectedPointIds, pointById]
  );
  // Batch edit (Round 13): toggling "נידונה" on a point that is part of a 2+
  // selection applies the SAME value to EVERY selected point (monday behavior) —
  // mirrors the Tasks/Decisions batch column edits. A toggle on a point that
  // isn't part of a multi-selection stays single-row (unchanged).
  const applyTogglePoint = (point, discussed) => {
    const originId = String(point.id);
    const targets = selectedPointIds.size > 1 && selectedPointIds.has(originId) ? selectedPoints : [point];
    targets.forEach((p) => togglePoint(p, discussed));
  };
  // Bulk delete — iterate the per-point optimistic delete (no batch endpoint).
  const deleteSelectedPoints = () => {
    if (!deleteTopicOrPoint || selectedPoints.length === 0) return;
    const pts = selectedPoints;
    clearPointSelection();
    pts.forEach((p) => deletePoint(p));
    onNotify?.(pts.length === 1 ? 'הנקודה נמחקה' : `${pts.length} נקודות נמחקו`, 'success');
  };
  // Bulk hide — set every selected point's "not for discussion" flag.
  const hideSelectedPoints = () => {
    if (!editTopicOrPoint || selectedPoints.length === 0) return;
    const pts = selectedPoints;
    clearPointSelection();
    pts.forEach((p) => { if (p.notForDiscussion !== true) togglePointNotForDiscussion(p, true); });
    onNotify?.(pts.length === 1 ? 'הנקודה הוסתרה' : `${pts.length} נקודות הוסתרו`, 'success');
  };

  // Resizable columns (shared 'topics' tableId → persisted per-instance for all
  // users). The leading 36px checkbox cell is fixed; name/check/decisions/tasks
  // resize within their clamps. useColumnWidths returns the grid-template string
  // for those four; we prepend the fixed lead track. Owners on a non-touch
  // viewport get the drag handles (canResize); everyone gets the stored widths.
  const { isMobile } = useViewport();
  const columnDefs = useMemo(
    () => TOPIC_COLUMN_KEYS.map((k) => ({ key: k, ...W[k] })),
    []
  );
  const { gridTemplate, startResize } = useColumnWidths('topics', columnDefs);
  const canResize = !!canReorderColumns && !isMobile;
  // Shared grid template for the column header + all point rows.
  const rowStyle = useMemo(
    () => ({ gridTemplateColumns: `${LEAD_TRACK} ${gridTemplate}` }),
    [gridTemplate]
  );

  // Counter popup state — { kind: 'decision'|'task', point } | null.
  const [popup, setPopup] = useState(null);

  // Resolve the popup's point against the LIVE items (a silent refetch replaces
  // the point objects, and the linked ids must stay fresh while the popup is open).
  const livePopupPoint = useMemo(() => {
    if (!popup?.point) return null;
    const sid = String(popup.point.id);
    for (const t of items) {
      for (const s of (t._subitems || [])) {
        if (String(s.id) === sid) return s;
      }
    }
    return popup.point;
  }, [popup, items]);

  // Popup rows = the point's linked ids matched against the discussion's
  // already-loaded decisions/tasks lists (props) — no new queries.
  const popupItems = useMemo(() => {
    if (!popup || !livePopupPoint) return [];
    const ids = popup.kind === 'decision'
      ? (livePopupPoint.decisionIds || [])
      : (livePopupPoint.taskIds || []);
    const source = popup.kind === 'decision' ? (decisionsItems || []) : (tasksItems || []);
    const byId = new Map(source.map((x) => [String(x.id), x]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean);
  }, [popup, livePopupPoint, decisionsItems, tasksItems]);

  // Refresh mechanism for the per-point link counters: when the parent's
  // decisions/tasks lists change (a create-from-point completed and the parent
  // refreshed its list), silently re-read the topics so the subitems' linked ids
  // (pointDecisionsLinkID / pointTasksLinkID) pick up the new link. Optimistic
  // temp ids are excluded so we only react to REAL board changes.
  const linkFingerprintRef = useRef(null);
  useEffect(() => {
    const fingerprint = [
      ...(decisionsItems || []).map((d) => String(d.id)),
      '|',
      ...(tasksItems || []).map((t) => String(t.id)),
    ].filter((id) => !id.startsWith('temp-')).join(',');
    if (linkFingerprintRef.current === null) { linkFingerprintRef.current = fingerprint; return; }
    if (linkFingerprintRef.current === fingerprint) return;
    linkFingerprintRef.current = fingerprint;
    refetch({ showLoader: false });
  }, [decisionsItems, tasksItems, refetch]);

  // Resolve every creator (topics + points) to a user object for the avatars.
  const creatorIds = useMemo(() => {
    const set = new Set();
    items.forEach((t) => {
      if (t.creatorId) set.add(String(t.creatorId));
      (t._subitems || []).forEach((p) => { if (p.creatorId) set.add(String(p.creatorId)); });
    });
    return Array.from(set);
  }, [items]);
  const { users } = useUsers(creatorIds);
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [String(u.id), u])), [users]);

  const [collapsed, setCollapsed] = useState({});
  const collapseInitRef = useRef(null);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicText, setNewTopicText] = useState('');
  const stableDiscussionSeedRef = useRef(topicColorStartIndex(`discussion:${discussion?.id || 'default'}`));
  const topicAccentMapRef = useRef({});
  const getAccentByTopicId = (topics) => {
    const seed = stableDiscussionSeedRef.current;
    const map = topicAccentMapRef.current;
    const liveIds = new Set(topics.map((topic) => String(topic.id)));
    Object.keys(map).forEach((topicId) => { if (!liveIds.has(topicId)) delete map[topicId]; });
    const used = new Set(
      Object.values(map).map((colorVar) => Number(String(colorVar).replace('--topic-color-', '')) - 1),
    );
    topics.forEach((topic, idx) => {
      const topicId = String(topic.id);
      if (map[topicId]) return;
      let colorIndex = topicColorStartIndex(topic.id, seed);
      let steps = 0;
      while (used.has(colorIndex) && steps < TOPIC_COLOR_COUNT) {
        colorIndex = (colorIndex + 1) % TOPIC_COLOR_COUNT;
        steps += 1;
      }
      if (used.has(colorIndex)) colorIndex = idx % TOPIC_COLOR_COUNT;
      used.add(colorIndex);
      map[topicId] = `--topic-color-${colorIndex + 1}`;
    });
    return map;
  };
  const accentByTopicId = getAccentByTopicId(items);

  // 8px activation distance (see SortableTopicSection) — a plain click on a
  // header control still works; a small press-move starts the group drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (loading) return;
    if (collapseInitRef.current === discussion?.id) return;
    collapseInitRef.current = discussion?.id;
    const c = {};
    items.forEach((t) => { c[t.id] = true; });
    setCollapsed(c);
  }, [loading, discussion?.id, items]);

  const isOpen = (id) => collapsed[id] !== true;
  const anyOpen = items.some((t) => t.notForDiscussion !== true && isOpen(t.id));
  const toggleAll = () => {
    if (anyOpen) { const c = {}; items.forEach((t) => { c[t.id] = true; }); setCollapsed(c); }
    else setCollapsed({});
  };

  const handleAddTopic = () => {
    if (!newTopicText.trim()) return;
    addTopic(newTopicText.trim());
    setNewTopicText('');
    setAddingTopic(false);
  };

  const handleTopicDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = items.map((t) => String(t.id));
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderTopics(arrayMove(ids, oldIndex, newIndex));
  };

  // Create-from-point callbacks — rendered only when the parent provided the
  // handler (the parent gates by the createDecision/createTask capabilities).
  const onCreatePointDecision = typeof onCreateFromPoint === 'function'
    ? (point) => onCreateFromPoint('decision', point)
    : undefined;
  const onCreatePointTask = typeof onCreateFromPoint === 'function'
    ? (point) => onCreateFromPoint('task', point)
    : undefined;
  const onOpenPointItems = (kind, point) => setPopup({ kind, point });

  if (loading) {
    return (
      <div className={styles.loading}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} type={"rectangle"} fullWidth height={TOPIC_SKELETON_H} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.wrap} dir="ltr">
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {addTopicOrPoint && (!addingTopic ? (
            <Button kind={"primary"} size={"small"} onClick={() => setAddingTopic(true)}>
              נושא חדש
            </Button>
          ) : (
            <div className={styles.addTopicRow}>
              <TextField
                autoFocus
                value={newTopicText}
                onChange={(v) => setNewTopicText(v)}
                placeholder="שם נושא"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddTopic(); }
                  if (e.key === 'Escape') { setAddingTopic(false); setNewTopicText(''); }
                }}
              />
              <Button kind={"primary"} size={"small"} onClick={handleAddTopic} disabled={!newTopicText.trim()}>
                הוסף
              </Button>
              <Button kind={"tertiary"} size={"small"} onClick={() => { setAddingTopic(false); setNewTopicText(''); }}>
                ביטול
              </Button>
            </div>
          ))}
          {addTopicOrPoint && !addingTopic && (
            <ApplyTemplateMenu
              discussionId={discussion.id}
              onApplied={() => refetch({ showLoader: false })}
            />
          )}
        </div>
        {items.length > 0 && (
          <CollapseAllButton collapsed={!anyOpen} onClick={toggleAll} />
        )}
      </div>

      {/* Floating bulk-action bar (Round 7) — appears when ≥1 point is selected.
          Same chrome as the Tasks/Decisions action bars: count · actions · close. */}
      {selectedPointIds.size > 0 && (
        <div className={styles.actionBar} role="region" aria-label="פעולות על נקודות נבחרות">
          <div className={styles.actionBarLeft}>
            <Text type={"text2"} element="span">{selectedPointIds.size} נבחרו</Text>
          </div>
          <div className={styles.actionBarCenter}>
            {editTopicOrPoint && (
              <Button kind={"secondary"} size={"small"} onClick={hideSelectedPoints}>הסתרה</Button>
            )}
            {deleteTopicOrPoint && (
              <Button kind={"secondary"} size={"small"} onClick={deleteSelectedPoints}>מחיקה</Button>
            )}
          </div>
          <div className={styles.actionBarRight}>
            <button type="button" className={styles.closeSelectionBtn} onClick={clearPointSelection} aria-label="בטל בחירה">
              <CloseSmall size={18} />
            </button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTopicDragEnd}>
        <SortableContext items={items.map((t) => String(t.id))} strategy={verticalListSortingStrategy}>
          {items.map((topic) => (
            <SortableTopicSection
              key={topic.id}
              topic={topic}
              accent={accentByTopicId[topic.id] || '--topic-color-1'}
              open={isOpen(topic.id)}
              onToggleOpen={() => setCollapsed((p) => ({ ...p, [topic.id]: !p[topic.id] }))}
              usersById={usersById}
              renameTopic={renameTopic}
              onRetryCreate={retryCreate}
              deleteTopic={deleteTopic}
              addPoint={addPoint}
              togglePoint={applyTogglePoint}
              togglePointNotForDiscussion={togglePointNotForDiscussion}
              toggleTopicNotForDiscussion={toggleTopicNotForDiscussion}
              renamePoint={renamePoint}
              deletePoint={deletePoint}
              reorderPoints={reorderPoints}
              rowStyle={rowStyle}
              canAdd={addTopicOrPoint}
              canEditTopic={editTopicOrPoint}
              canDelete={deleteTopicOrPoint}
              canCheck={checkPoint}
              priorityMapped={priorityMapped}
              priorityOptions={priorityOpts.options}
              priorityLabelById={priorityOpts.labelById}
              priorityColorById={priorityOpts.colorById}
              updateTopicPriority={updateTopicPriority}
              onCreatePointDecision={onCreatePointDecision}
              onCreatePointTask={onCreatePointTask}
              onOpenPointItems={onOpenPointItems}
              canResize={canResize}
              startResize={startResize}
              selectable={canSelectPoints}
              selectedPointIds={selectedPointIds}
              onTogglePointSelect={togglePointSelect}
              onToggleTopicPoints={toggleTopicPoints}
              decisionIdSet={decisionIdSet}
              taskIdSet={taskIdSet}
            />
          ))}
        </SortableContext>
      </DndContext>

      {items.length === 0 && !addingTopic && (
        <div className={styles.empty}>אין נושאים לדיון זה</div>
      )}

      <PointItemsPopup
        open={!!popup}
        kind={popup?.kind || 'decision'}
        point={livePopupPoint}
        items={popupItems}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}

export default TopicsTab;

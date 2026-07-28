import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton, Button, Dialog, DialogContentContainer, Text, Checkbox } from '@vibe/core';
import { CloseSmall, DropdownChevronDown, Edit } from '@vibe/icons';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { BrandLoader } from '@generated/components/BrandLoader';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import { useUsers } from '@generated/utils/mondayApi/hooks/use-users.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { Plus, EyeOff, Trash2, GripHorizontal } from 'lucide-react';
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
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useEscToClearSelection } from '@generated/hooks/useEscToClearSelection.js';
import { TopicPointRow, RowKebabMenu, CreatorAvatar } from '@generated/components/TopicPointRow';
import { EmptyState } from '@generated/components/EmptyState';
import { UpdatesTripleBox } from './UpdatesTripleBox.jsx';
import { computeRibbonDropTarget } from './ribbonDrop.js';
import {
  maxPos, readPos, writePos, computeEdges, computeThumb, posFromThumbDrag, stepFrom,
} from './ribbonScroll.js';
import { assignTopicAccents, topicColorStartIndex } from './topicAccents.js';
import { buildMentionRoster } from '@generated/utils/mention.js';
import { ApplyTemplateMenu } from '@generated/components/ApplyTemplateMenu';
import { PointItemsPopup } from '@generated/components/PointItemsPopup';
import { getPointItemIds } from '@generated/utils/pointItems.js';
import { loadLayout, saveLayout, DEFAULT_LAYOUT, ratioFromDrag, heightFromDrag, clampRatio } from '@generated/utils/discussionLayout.js';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import logger from '@generated/utils/logger.js';
import styles from './TopicsTab.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// round226 — the decisions+tasks columns merged into ONE 'outputs' (תוצרים)
// key (approved mockup): one quiet counter (sum) + one create "+". Stage B
// dropped the table grid entirely — these keys now only drive the Hide-columns
// control (a hidden key drops that element from every point row).
const TOPIC_COLUMN_KEYS = ['name', 'check', 'outputs'];

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
        zIndex={10000}
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


/* One topic = a CARD (round226 stage B — approved mockup): a colored accent bar
   on the inline-start edge (the topic's PRIORITY color when set, its stable
   palette color otherwise), a tinted header row (chevron + colored name +
   hover-revealed actions + priority pill), and the points as a CLEAN LIST
   inside the card body (no table grid / column headers) + an inline add-point
   row. The whole card is RTL (owner-approved). */
function SortableTopicSection({
  topic, accent, open, onToggleOpen, usersById,
  renameTopic,
  // Optimistic-create error affordance (topic OR its points): retry re-runs the
  // failed create. (A failed TOPIC can be removed via the header kebab; a failed
  // POINT via multi-select bulk delete — the per-point trash was removed.)
  onRetryCreate,
  deleteTopic, addPoint, togglePoint,
  toggleTopicNotForDiscussion,
  renamePoint, reorderPoints,
  // Visible column keys (round 47 Hide) — 'name' is always present; a hidden
  // check/outputs key drops that element from every point row.
  columns,
  // Granular discussion-tier caps (each equals the legacy canEdit while the
  // feature is off). add → add topic/point; edit → rename/priority/drag-reorder;
  // del → delete/hide; check → "נידונה" toggle.
  canAdd = true, canEditTopic = true, canHideTopic = true, canDelete = true, canCheck = true,
  priorityMapped = false, priorityOptions, priorityLabelById, priorityColorById, updateTopicPriority,
  // Decisions/tasks-from-point wiring (threaded from TopicsTab).
  onCreatePointDecision, onCreatePointTask, onOpenPointItems, onDeletePoint,
  // Multi-select (Round 7): when `selectable`, each point row reveals a checkbox
  // on hover (pinned visible while a selection is active); selection is tracked
  // by point id in the parent. The card header hosts a select-all-in-topic
  // checkbox with the same reveal behavior.
  selectable = false, selectedPointIds, onTogglePointSelect, onToggleTopicPoints, selectionActive = false,
  // Sets of the discussion's REAL decision/task ids — the per-point counters
  // intersect the point's STORED ids with these so the count is accurate.
  decisionIdSet, taskIdSet,
  // Per-point decision/task associations (pointItems store, keyed by the point's
  // REAL id) — the source of the per-point counters + names popup.
  pointItemsByPoint,
  // Round 52 — per-point create-from-point progress, keyed `${kind}:${pointId}`
  // ('decision:<id>' / 'task:<id>' → 'pending' | 'success' | 'error'). Drives the
  // inline CreateProgressBar on the matching תוצרים cluster.
  createStatusByPoint,
  // round235 (approved mockup) — the topics RIBBON owns the topic-level chrome
  // (name, rename, priority, hide, delete, drag), so the single ACTIVE section
  // renders HEADLESS: no card head, points always visible, no card frame.
  headless = false,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(topic.id) });
  const accentTri = `var(${accent})`;
  // round226 stage B — the card accent (bar + header tint + name color) is the
  // topic's PRIORITY color when one is set (approved mockup: the priority shows
  // as the card's color); topics without a priority keep their palette color.
  const prioColor = topic.priority != null ? priorityColorById?.[topic.priority] : null;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    '--topic-accent': prioColor || `hsl(${accentTri})`,
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
    // round229 (owner request) — after Enter, the add-point input stays open at
    // the bottom and RE-FOCUSES so the next point can be typed immediately (no
    // mouse click). rAF defers past the optimistic re-render that re-inserts the
    // list, which would otherwise drop focus from the remounted input.
    requestAnimationFrame(() => addPointInputRef.current?.focus());
  };

  const saveTopicTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== topic.name && renameTopic) renameTopic(topic.id, trimmed);
    setEditingTitle(false);
  };

  // Whole-header drag (native monday feel): the sortable listeners/attributes
  // ride on the card HEADER when the topic is editable — no six-dot grip. The
  // PointerSensor activation distance (TopicsTab, ~8px) keeps a plain click on
  // the header controls working; only a press-move starts a group drag.
  const headerDragProps = canEditTopic ? { ...attributes, ...listeners } : {};
  const stopEvt = (e) => e.stopPropagation();

  // Header "+" (נקודה חדשה): make sure the card is open, then focus the inline
  // add-point row at the bottom of the list.
  const openAddPointInput = () => {
    if (!effectiveOpen && !excluded) onToggleOpen();
    setShowAddPointInput(true);
    requestAnimationFrame(() => addPointInputRef.current?.focus());
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      dir="rtl"
      className={`${styles.section} ${excluded ? styles.sectionExcluded : ''} ${headless ? styles.sectionHeadless : ''}`}
    >
      {/* round235 — headless mode: the ribbon owns the topic chrome. A failed
          background create keeps its retry affordance as a slim banner, and a
          hidden topic shows a restore notice instead of its points. */}
      {headless && topicFailed && onRetryCreate && (
        <div className={styles.topicRetryBanner}>
          <button
            type="button"
            className={styles.topicRetryBtn}
            onClick={() => onRetryCreate(topic.id)}
            title="שמירת הנושא נכשלה — נסה שוב"
          >
            שמירה נכשלה · נסה שוב
          </button>
        </div>
      )}
      {headless && excluded && (
        <div className={styles.excludedNote}>
          <EyeOff size={14} />
          <span>הנושא מוסתר («לא לדיון»)</span>
          {canHideTopic && (
            <button
              type="button"
              className={styles.excludedShowBtn}
              onClick={() => toggleTopicNotForDiscussion && toggleTopicNotForDiscussion(topic.id, false)}
            >
              הצג נושא
            </button>
          )}
        </div>
      )}
      {/* Card header — the WHOLE tinted row toggles collapse (deferred so a
          double-click rename on the title can cancel it); controls stop
          propagation. Hover reveals the actions cluster (mockup .tActs). */}
      {!headless && (
      <div
        className={`${styles.cardHead} ${canEditTopic ? styles.sectionHeaderDraggable : ''}`}
        {...headerDragProps}
        onClick={excluded ? undefined : () => {
          if (titleClickTimerRef.current) clearTimeout(titleClickTimerRef.current);
          titleClickTimerRef.current = setTimeout(() => {
            titleClickTimerRef.current = null;
            onToggleOpen();
          }, 220);
        }}
      >
        {/* Select-all-in-topic — quiet at rest (hover / active-selection reveal),
            replacing the old column-header lead cell (the header row is gone). */}
        {selectable && points.length > 0 && (
          <span
            className={`${styles.headSelect} ${selectionActive ? styles.headSelectOn : ''}`}
            onClick={stopEvt}
            onPointerDown={stopEvt}
          >
            <TopicSelectAll
              points={points}
              selectedPointIds={selectedPointIds}
              onToggleTopicPoints={onToggleTopicPoints}
            />
          </span>
        )}
        <button
          type="button"
          className={styles.triangle}
          onClick={(e) => { e.stopPropagation(); if (!excluded) onToggleOpen(); }}
          disabled={excluded}
          aria-label={effectiveOpen ? 'קפל נושא' : 'פתח נושא'}
          title={excluded ? 'נושא מוסתר' : (effectiveOpen ? 'קפל' : 'פתח')}
        >
          <DropdownChevronDown
            className={`${styles.chevron} ${effectiveOpen ? '' : styles.chevronCollapsed}`}
          />
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
              style={{ opacity: excluded ? 0.5 : 1, cursor: excluded ? 'default' : 'pointer' }}
              role={excluded ? undefined : 'button'}
              aria-label={excluded ? undefined : (effectiveOpen ? 'קפל נושא' : 'פתח נושא')}
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

        {/* Hover-revealed header actions (mockup .tActs): נקודה חדשה, rename,
            hide(eye), delete (kebab with inline confirm), creator avatar. The
            eye stays visible on a HIDDEN topic so the restore is obvious. */}
        <span className={styles.headActs} onClick={stopEvt} onPointerDown={stopEvt}>
          {canAdd && !excluded && (
            <button
              type="button"
              className={styles.headActBtn}
              title="נקודה חדשה"
              aria-label="הוסף נקודה לנושא"
              onClick={openAddPointInput}
            >
              <Plus size={16} />
            </button>
          )}
          {canEditTopic && !excluded && !editingTitle && (
            <button
              type="button"
              className={styles.headActBtn}
              title="שינוי שם"
              aria-label="ערוך שם נושא"
              onClick={() => { setTitleDraft(topic.name || ''); setEditingTitle(true); }}
            >
              <Edit size={16} />
            </button>
          )}
          {/* round260 (owner request) — topic hide button removed. */}
          {canDelete && (
            <RowKebabMenu
              excluded={excluded}
              kind="נושא"
              className={styles.headerKebab}
              onDelete={() => deleteTopic(topic.id)}
            />
          )}
          <span className={styles.headerAvatar}>
            <CreatorAvatar userId={topic.creatorId} usersById={usersById} />
          </span>
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
      </div>
      )}

      {(headless ? !excluded : effectiveOpen) && (
        <div className={styles.cardBody}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePointDragEnd}>
            <SortableContext items={points.map((p) => String(p.id))} strategy={verticalListSortingStrategy}>
              {points.map((point) => (
                <TopicPointRow
                  key={point.id}
                  point={point}
                  usersById={usersById}
                  columns={columns}
                  onToggle={togglePoint}
                  onRename={renamePoint}
                  onDelete={canDelete ? onDeletePoint : undefined}
                  onRetryCreate={onRetryCreate}
                  canEditPoint={canEditTopic}
                  canCheck={canCheck}
                  decisionCount={getPointItemIds(pointItemsByPoint, point._realId || point.id, 'decision')
                    .filter((id) => decisionIdSet.has(String(id))).length}
                  taskCount={getPointItemIds(pointItemsByPoint, point._realId || point.id, 'task')
                    .filter((id) => taskIdSet.has(String(id))).length}
                  // Stamp the parent topic id onto the scoped point — the
                  // quick-create task flow links the new task to the topic too.
                  onCreateDecision={onCreatePointDecision ? (p, anchor) => onCreatePointDecision({ ...point, topicId: topic.id }, anchor) : undefined}
                  onCreateTask={onCreatePointTask ? (p, anchor) => onCreatePointTask({ ...point, topicId: topic.id }, anchor) : undefined}
                  onOpenTasks={(p) => onOpenPointItems('outputs', p)}
                  selectable={selectable}
                  selected={selectable ? !!selectedPointIds?.has(String(point.id)) : false}
                  onToggleSelect={(p, checked) => onTogglePointSelect?.(p, checked)}
                  selectionActive={selectionActive}
                  decisionCreateStatus={createStatusByPoint?.[`decision:${point.id}`]}
                  taskCreateStatus={createStatusByPoint?.[`task:${point.id}`]}
                />
              ))}
            </SortableContext>
          </DndContext>

          {canAdd && (
            showAddPointInput ? (
              // Editing: an inline list row with a borderless input (blue bottom
              // rule) — plain placeholder, no typing instructions (owner spec).
              <div className={`${styles.addPoint} ${styles.addPointEditing}`}>
                <input
                  ref={addPointInputRef}
                  className={styles.addPointInput}
                  autoFocus
                  value={newPointText}
                  aria-label="הוסף נקודה"
                  placeholder="נקודה חדשה…"
                  onChange={(e) => setNewPointText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPointText.trim()) { e.preventDefault(); handleAddPoint(); }
                    if (e.key === 'Escape') { setNewPointText(''); setShowAddPointInput(false); e.currentTarget.blur(); }
                  }}
                  onBlur={() => { if (!newPointText.trim()) { setNewPointText(''); setShowAddPointInput(false); } }}
                />
              </div>
            ) : (
              // Rest state (mockup .newRow): a quiet "＋ נקודה חדשה…" list row —
              // the WHOLE row is the click target and opens the inline input.
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
                <Plus size={14} className={styles.addPointIcon} />
                נקודה חדשה…
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
  // Hide/show a topic or point (item 10) — a FIXED rule (discussion lead /
  // coordinator / owner), computed by DiscussionCard, independent of
  // editTopicOrPoint. Defaults true for back-compat in tests/harnesses.
  canHide = true,
  // round212 — PER-PANE write gates for the triple box, resolved by the matrix
  // capabilities (writeBackground / writeReferences / editSummary) in
  // DiscussionCard. Everyone else sees the pane read-only. Default false
  // (read-only) on purpose.
  canEditBackground = false,
  canEditReferences = false,
  canEditSummary = false,
  // round270 — who may add documents in the triple box (creator/coord/lead/owner).
  canAttachDocuments = false,
  // round205 — owner-configurable component visibility (Settings → העדפות):
  // the topic tables and each triple-box pane can be hidden per instance.
  // round206 added showSummary (the summary moved into the triple box).
  showTopics = true, showBackground = true, showReferences = true, showSummary = true,
  // Column drag-resize was removed with the round226 card redesign (no table
  // grid anymore); the prop is kept for call-site compat.
  canReorderColumns = false, // eslint-disable-line no-unused-vars -- prop-contract compat

  // Board owner (round 47): gates the Hide-columns pill + its "Save to this view"
  // (mirrors the other tabs). Non-owners never see it and get the saved config.
  canManageSettings = false,
  // Decisions redesign wiring (per the approved mockup):
  //   onCreateFromPoint(kind, point) — kind: 'decision' | 'task'; opens the
  //     parent's quick-create flow scoped to the point. The dashed "+" buttons
  //     render only when this is provided (parent gates by capability).
  //   decisionsItems / tasksItems — the discussion's ALREADY-LOADED decision /
  //     task lists (from useDecisions / useTasks in DiscussionCard); the counter
  //     popup resolves linked ids against them — NO new queries here.
  onCreateFromPoint,
  decisionsItems = [], tasksItems = [],
  // Point → decisions/tasks associations from the pointItems store (owned by
  // DiscussionCard). Shape { [pointRealId]: { decisions: [], tasks: [] } }; the
  // per-point counter + names popup resolve against this INTERSECTED with the
  // loaded decisions/tasks. Replaces the old (never-populated) subitems
  // board_relation read — see utils/pointItems.js.
  pointItemsByPoint = {},
  // Round 52 — per-point create-from-point progress map, keyed `${kind}:${pointId}`
  // ('pending' | 'success' | 'error'). Owned by DiscussionCard's handleQuickCreate;
  // drives the inline CreateProgressBar on each point's decisions/tasks cell.
  createStatusByPoint = {},
  // round132 — reports useTopics' loading flag up to DiscussionCard, which
  // gates the deep-link splash (App) until the topics data is actually ready.
  onLoadingChange = null,
  // round230 — bumps on every produced-link activation: forces the ניהול-דיון
  // landing state — collapse ALL topics/points + open the רקע pane.
  resetViewNonce = 0,
}) {
  const {
    items, loading, addTopic, addPoint, retryCreate, togglePoint, refetch,
    togglePointNotForDiscussion, toggleTopicNotForDiscussion, updateTopicPriority,
    renameTopic, deleteTopic, softDeleteTopic, renamePoint, softDeletePoints, reorderTopics, reorderPoints,
  } = useTopics(discussion.id, {
    onSuccess: onNotify, onLoading: onNotifyLoading, onDismiss: onDismissToast,
    // round301 — refetch when a background creation stage adds more topics/points.
    reloadKey: discussion.__reloadStamp,
  });
  useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

  // round220 — the @-mention roster for the triple box: the discussion's people,
  // ordered lead → coordinator → participants and deduped by id (names only).
  const mentionPeople = useMemo(
    () => buildMentionRoster(discussion),
    [discussion?.discussionLeadID, discussion?.discussionCoordinatorID, discussion?.participantsID],
  );

  // round237 — search removed from the agenda header (owner request); the ribbon
  // shows every topic as a label (no scrolling to browse), so a filter is moot.
  const visibleTopics = items;

  const priorityMapped = !!getColumns('topics')?.topicPriorityID?.id;
  const priorityOpts = useStatusOptions('topics', 'topicPriorityID');

  // Sets of the discussion's REAL, still-existing decision / task ids (from the
  // prefetched lists in DiscussionCard). The per-point החלטות/משימות counters
  // intersect the point's STORED ids (pointItemsByPoint) with these, so the count
  // reflects decisions/tasks that ACTUALLY exist and were created FROM the point —
  // since-deleted ids no longer inflate it, and a point with no stored ids shows 0.
  // This is what makes the Topics "החלטות" count show a real, persistent number.
  const decisionIdSet = useMemo(
    () => new Set((decisionsItems || []).map((d) => String(d.id))),
    [decisionsItems]
  );
  const taskIdSet = useMemo(
    () => new Set((tasksItems || []).map((t) => String(t.id))),
    [tasksItems]
  );

  // ---- Multi-select of POINTS (Round 7) — was a per-point checkbox + a floating
  // bulk bar (delete / hide). round232 (owner request): the checkboxes are GONE —
  // deletion is a per-point trash button (left of the creator avatar) and hiding
  // is the per-point eye, so selection is DISABLED. The selection machinery below
  // stays inert (no checkbox ⇒ selectedPointIds never fills ⇒ the bulk bar never
  // shows) rather than being ripped out. ----
  const canSelectPoints = false;
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
  // ESC clears this tab's point multi-selection (shared hook — round135;
  // guards: visible view only, not while typing, not while an overlay is open).
  const rootRef = useRef(null);
  const hasPointSelection = selectedPointIds.size > 0;
  useEscToClearSelection(rootRef, hasPointSelection, () => setSelectedPointIds(new Set()));
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
    // Soft-delete with an undo window; GREEN (success) toast with a "בטל" (undo)
    // button rendered to the LEFT of the message (see Toast) that restores the
    // deleted points.
    const { undo, count } = softDeletePoints(pts);
    const msg = count === 1 ? 'הנקודה נמחקה' : `${count} נקודות נמחקו`;
    onNotify?.(msg, 'success', 6000, { label: 'בטל', onClick: undo });
  };
  // round232 (owner request) — per-point delete from the row's trash button:
  // one soft-delete + an undo toast (same restore window as the old bulk path).
  const deletePoint = (point) => {
    if (!deleteTopicOrPoint || !point) return;
    const { undo } = softDeletePoints([point]);
    onNotify?.('הנקודה נמחקה', 'success', 6000, { label: 'בטל', onClick: undo });
  };
  // round239 (owner request) — right-click "מחיקת נושא" deletes IMMEDIATELY with
  // an undo toast (like a point), no "?למחוק" confirmation step.
  const deleteTopicWithUndo = (topic) => {
    if (!deleteTopicOrPoint || !topic) return;
    if (activeTopicId != null && String(activeTopicId) === String(topic.id)) {
      const rest = items.filter((t) => String(t.id) !== String(topic.id));
      setActiveTopicId(rest[0] ? String(rest[0].id) : null);
    }
    const { undo } = softDeleteTopic(topic.id);
    onNotify?.('הנושא נמחק', 'success', 6000, { label: 'בטל', onClick: undo });
  };
  // Bulk hide — set every selected point's "not for discussion" flag.
  // Gated by canHide (lead/coordinator/owner only — item 10).
  const hideSelectedPoints = () => {
    if (!canHide || selectedPoints.length === 0) return;
    const pts = selectedPoints;
    clearPointSelection();
    pts.forEach((p) => { if (p.notForDiscussion !== true) togglePointNotForDiscussion(p, true); });
    onNotify?.(pts.length === 1 ? 'הנקודה הוסתרה' : `${pts.length} נקודות הוסתרו`, 'success');
  };

  // --- Hide columns (round 47) ------------------------------------------------
  // monday-style column show/hide, OWNER-gated (canManageSettings) at the render
  // site, persisted to the SHARED saved view
  // (settings.preferences.savedViews.topics.hiddenColumns) so an owner's "Save to
  // this view" applies for everyone. The primary "נקודה לדיון" (name) column is
  // never hideable. Applied at the render layer — a hidden column drops its
  // header cell, its per-row cell, AND its grid track (via columnDefs below);
  // widths persist per key, so a re-shown column returns at its stored width.
  // round235 — the HideColumnsControl UI left the toolbar (the ribbon owns that
  // band now; owner: "תעלים את הכפתורים... הסתר"), but a previously-SAVED
  // hidden-columns view still applies to every point row.
  const { view: savedView } = useSavedViews('topics', { canManageSettings });
  const [hiddenColumns] = useState(
    () => new Set(Array.isArray(savedView?.hiddenColumns) ? savedView.hiddenColumns : [])
  );
  // Visible column keys — 'name' always kept; the other three drop when hidden.
  const visibleKeys = useMemo(
    () => TOPIC_COLUMN_KEYS.filter((k) => k === 'name' || !hiddenColumns.has(k)),
    [hiddenColumns]
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

  // Popup rows = the point's STORED decision/task ids (pointItemsByPoint, keyed by
  // the point's REAL id) matched against the discussion's already-loaded lists
  // (props) — no new queries, names only. A silent refetch may replace the point
  // objects; the ids come from the store (parent-owned) so they stay correct.
  const popupItems = useMemo(() => {
    if (!popup || !livePopupPoint) return [];
    const realId = livePopupPoint._realId || livePopupPoint.id;
    // round226 — the unified תוצרים popup lists the point's TASKS then DECISIONS,
    // each tagged with its kind for the type chip.
    if (popup.kind === 'outputs') {
      const tBy = new Map((tasksItems || []).map((x) => [String(x.id), x]));
      const dBy = new Map((decisionsItems || []).map((x) => [String(x.id), x]));
      return [
        ...getPointItemIds(pointItemsByPoint, realId, 'task').map((id) => tBy.get(String(id))).filter(Boolean).map((x) => ({ ...x, _outKind: 'task' })),
        ...getPointItemIds(pointItemsByPoint, realId, 'decision').map((id) => dBy.get(String(id))).filter(Boolean).map((x) => ({ ...x, _outKind: 'decision' })),
      ];
    }
    const ids = getPointItemIds(pointItemsByPoint, realId, popup.kind);
    const source = popup.kind === 'decision' ? (decisionsItems || []) : (tasksItems || []);
    const byId = new Map(source.map((x) => [String(x.id), x]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean);
  }, [popup, livePopupPoint, decisionsItems, tasksItems, pointItemsByPoint]);

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

  // round235 (approved mockup) — ONE topic is ACTIVE at a time; the ribbon
  // selects it and its points render below. Replaces the collapse-all/stacked
  // sections model.
  const [activeTopicId, setActiveTopicId] = useState(null);
  const activeInitRef = useRef(null);
  const [renamingTopicId, setRenamingTopicId] = useState(null);
  const [topicMenu, setTopicMenu] = useState(null); // { topicId, x, y, confirm }
  const [draggingTopicId, setDraggingTopicId] = useState(null);
  const [gapBeforeId, setGapBeforeId] = useState(null); // round237 — the insertion gap marker
  const [addWhere, setAddWhere] = useState(null); // round237 — 'start' | 'end' | null
  const [newTopicText, setNewTopicText] = useState('');

  // round241 — per-discussion WIDGET LAYOUT of the split (owner-only writes).
  //   layout.ratio        → the אג'נדה box's share of the row width (the triple
  //                         box gets the rest, so growing one shrinks the other).
  //   layout.stacked      → the two boxes stack vertically instead of side-by-side.
  //   layout.boxHeight    → round269: ONE SHARED height (px) for BOTH boxes, so
  //                         they are always the same height (dragging either box's
  //                         handle/corner resizes both). WIDTH stays per-box (ratio).
  // editLayout reveals the 6-dot grips + the resize divider on BOTH boxes at
  // once (owner request: one pencil arms both). Everyone READS the saved layout;
  // only an owner (canManageSettings) persists changes.
  // round296 — the per-instance DEFAULT split (agenda's share) an unsaved
  // discussion opens at; a per-discussion drag override still wins (loadLayout).
  const { settings } = useSettings();
  const defaultLayoutRatio = settings?.preferences?.defaultLayoutRatio;
  const [layout, setLayout] = useState(() => ({
    ...DEFAULT_LAYOUT,
    ratio: clampRatio(defaultLayoutRatio != null ? defaultLayoutRatio : DEFAULT_LAYOUT.ratio),
  }));
  const [editLayout, setEditLayout] = useState(false);
  const layoutRef = useRef(layout);
  const splitRowRef = useRef(null);
  // round243 — the agenda box element, so a per-point "+" create can be confined
  // inside its bounds (round237 point 1).
  const agendaBoxRef = useRef(null);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => {
    let alive = true;
    loadLayout(discussion?.id, defaultLayoutRatio)
      .then((l) => { if (alive) setLayout(l); })
      .catch((err) => logger.warn('TopicsTab', 'טעינת פריסת הדיון נכשלה', err));
    return () => { alive = false; };
  }, [discussion?.id, defaultLayoutRatio]);
  // A non-owner never edits; if the gate flips off mid-session, drop edit mode.
  useEffect(() => { if (!canManageSettings) setEditLayout(false); }, [canManageSettings]);

  const applyLayout = (patch, persist = false) => {
    setLayout((cur) => {
      const next = { ...cur, ...patch };
      layoutRef.current = next;
      if (persist && canManageSettings) saveLayout(discussion?.id, next);
      return next;
    });
  };

  // Horizontal resize: drag the central divider → change the agenda's width
  // share; the pure ratioFromDrag maps the pointer delta to a clamped ratio.
  const onDividerPointerDown = (e) => {
    if (!editLayout || !canManageSettings || layoutRef.current.stacked) return;
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = layoutRef.current.ratio;
    const width = splitRowRef.current?.getBoundingClientRect().width || 0;
    const onMove = (ev) => applyLayout({ ratio: ratioFromDrag(startRatio, ev.clientX - startX, width) });
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      applyLayout({ ratio: ratioFromDrag(startRatio, ev.clientX - startX, width) }, true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // round242 — bottom resize handle: drag it to shrink/GROW the box card height.
  // round269 (owner request) — height is UNIFORM: both boxes share ONE height
  // (`boxHeight`), so dragging either box's handle resizes BOTH identically —
  // never a state where one is taller than the other. The start height is
  // measured from the dragged box so the drag tracks real pixels. `which` is
  // kept only to tag which handle fired. One persist on release.
  const onHeightPointerDown = (e /* , which */) => {
    if (!editLayout || !canManageSettings) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const box = e.currentTarget.parentElement;
    const startH = box ? box.getBoundingClientRect().height : (layoutRef.current.boxHeight || 520);
    const onMove = (ev) => applyLayout({ boxHeight: heightFromDrag(startH, ev.clientY - startY) });
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      applyLayout({ boxHeight: heightFromDrag(startH, ev.clientY - startY) }, true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // The bottom height-resize handle carried inside each box (owner + edit mode).
  const renderHeightHandle = (which) => (editLayout && canManageSettings) ? (
    <span
      className={styles.heightHandle}
      role="separator"
      aria-orientation="horizontal"
      aria-label="שינוי גובה התיבה"
      title="גרור לשינוי גובה התיבה"
      onPointerDown={(e) => onHeightPointerDown(e, which)}
    >
      <span className={styles.heightHandleGrip} aria-hidden="true" />
    </span>
  ) : null;

  // round248 (owner request) — a CORNER resize grip: grab a box's bottom-inner
  // corner and drag out/in to resize BOTH dimensions at once — horizontal moves
  // the split ratio (grow one, shrink the other), vertical moves the shared
  // height. Reuses the same pure ratioFromDrag / heightFromDrag math.
  const onCornerPointerDown = (e /* , which */) => {
    if (!editLayout || !canManageSettings) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRatio = layoutRef.current.ratio;
    const width = splitRowRef.current?.getBoundingClientRect().width || 0;
    const box = e.currentTarget.parentElement;
    const startH = box ? box.getBoundingClientRect().height : (layoutRef.current.boxHeight || 520);
    const commit = (ev, persist) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const patch = {
        // pointer moving physically RIGHT always grows the agenda's share (WIDTH,
        // per-box). round269 — vertical drag resizes the SHARED boxHeight (both).
        ratio: ratioFromDrag(startRatio, dx, width),
        boxHeight: heightFromDrag(startH, dy),
      };
      // round250 (owner request "can't drag left/right") — a horizontal corner
      // drag while STACKED brings the boxes back side-by-side so the width
      // actually changes (a stacked column can't show a width split).
      if (layoutRef.current.stacked && Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) {
        patch.stacked = false;
      }
      applyLayout(patch, persist);
    };
    const onMove = (ev) => commit(ev, false);
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      commit(ev, true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
  // The bottom-inner corner grip (edit mode). Shown in BOTH layouts: side-by-side
  // it resizes width+height; stacked, a horizontal drag also un-stacks (round250)
  // so width becomes adjustable again. `place` tags the box for CSS.
  const renderCornerHandle = (place) => (editLayout && canManageSettings) ? (
    <span
      className={`${styles.cornerHandle} ${place === 'agenda' ? styles.cornerAgenda : styles.cornerTriple}`}
      role="separator"
      aria-label="שינוי גודל התיבה (רוחב וגובה)"
      title="גרור את הפינה לשינוי רוחב וגובה"
      onPointerDown={(e) => onCornerPointerDown(e, place)}
    />
  ) : null;

  // 6-dot grip: drag DOWN past a threshold stacks the two boxes, drag UP
  // unstacks them ("like a dashboard widget"). One persist on release.
  const onGripPointerDown = (e) => {
    if (!editLayout || !canManageSettings) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    let decided = layoutRef.current.stacked;
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (dy > 60) decided = true;
      else if (dy < -60) decided = false;
      if (decided !== layoutRef.current.stacked) applyLayout({ stacked: decided });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      applyLayout({ stacked: decided }, true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // The shared edit-tools cluster rendered inside BOTH box headers (owner-only):
  // a pencil that toggles edit mode for both boxes at once, plus — while editing
  // — the 6-dot drag grip. `place` only tags it for per-box styling.
  const renderLayoutTools = (place) => {
    if (!canManageSettings) return null;
    return (
      <span className={styles.layoutTools} data-place={place} onPointerDown={(e) => e.stopPropagation()}>
        {editLayout && (
          <span
            className={styles.layoutGrip}
            role="button"
            tabIndex={-1}
            aria-label="הזז תיבה (גרור מטה לעימוד, מעלה לצד-לצד)"
            title="גרור מטה לעימוד התיבות, מעלה לצד-לצד"
            onPointerDown={onGripPointerDown}
          >
            <GripHorizontal size={16} />
          </span>
        )}
        <button
          type="button"
          className={`${styles.layoutPencilBtn} ${editLayout ? styles.layoutPencilOn : ''}`}
          aria-label={editLayout ? 'סיום עריכת פריסה' : 'עריכת פריסת התצוגה'}
          aria-pressed={editLayout}
          title={editLayout ? 'סיום עריכת פריסה' : 'עריכת מיקום וגודל התיבות'}
          onClick={() => setEditLayout((v) => !v)}
        >
          <Edit size={15} />
        </button>
      </span>
    );
  };
  const stableDiscussionSeedRef = useRef(topicColorStartIndex(`discussion:${discussion?.id || 'default'}`));
  const topicAccentMapRef = useRef({});
  // round295 — MORE variance between adjacent topics (owner request): the pure
  // assignTopicAccents walks the hue wheel by a coprime STRIDE so consecutive
  // topics land on opposite sides (was a +1-collision hash that clustered
  // look-alike hues). The per-id map is persisted in a ref so a topic keeps its
  // colour across re-renders.
  const getAccentByTopicId = (topics) => {
    const next = assignTopicAccents(topics, stableDiscussionSeedRef.current, topicAccentMapRef.current);
    topicAccentMapRef.current = next;
    return next;
  };
  const accentByTopicId = getAccentByTopicId(items);

  // 8px activation distance (see SortableTopicSection) — a plain click on a
  // header control still works; a small press-move starts the group drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // round235 — entering a discussion (or switching) lands on the FIRST topic.
  useEffect(() => {
    if (loading) return;
    if (activeInitRef.current === discussion?.id) return;
    activeInitRef.current = discussion?.id;
    setActiveTopicId(items[0] ? String(items[0].id) : null);
  }, [loading, discussion?.id, items]);

  // round230/235 — a produced-link activation (resetViewNonce bump) FORCES the
  // ניהול-דיון landing state: back to the FIRST topic, and signal the triple
  // box to open on the רקע pane (paneResetNonce). Guarded on >0 so it never
  // fires on a normal open.
  const [paneResetNonce, setPaneResetNonce] = useState(0);
  useEffect(() => {
    if (resetViewNonce <= 0) return;
    setActiveTopicId(items[0] ? String(items[0].id) : null);
    setPaneResetNonce((n) => n + 1);
    // items are read at fire time; keying on them would re-reset on every
    // optimistic change — the nonce is the intended, sole trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetViewNonce]);

  // round237 — the "+" exists at BOTH ends: 'start' (rightmost, beginning of the
  // discussion) prepends; 'end' (leftmost) appends. Activate the new topic once
  // the optimistic item lands in `items`.
  const pendingActivateWhereRef = useRef(null);
  const handleAddTopic = (where) => {
    const w = where || addWhere;
    if (!newTopicText.trim()) { setAddWhere(null); setNewTopicText(''); return; }
    pendingActivateWhereRef.current = w === 'start' ? 'start' : 'end';
    addTopic(newTopicText.trim(), w === 'start' ? {} : { position: 'bottom' });
    setNewTopicText('');
    setAddWhere(null);
  };
  useEffect(() => {
    const w = pendingActivateWhereRef.current;
    if (!w || items.length === 0) return;
    pendingActivateWhereRef.current = null;
    setActiveTopicId(String(w === 'start' ? items[0].id : items[items.length - 1].id));
  }, [items]);

  // The ACTIVE topic — falls back to the first visible one when the selected
  // id vanished (deleted / filtered out by search).
  const activeTopic = useMemo(() => {
    const found = visibleTopics.find((t) => String(t.id) === String(activeTopicId));
    return found || visibleTopics[0] || null;
  }, [visibleTopics, activeTopicId]);

  // ---- ribbon drag (long-press on the ⋮) ------------------------------------
  // Long-press (280ms, round255) on a label's ⋮ arms a horizontal drag; a short click
  // opens the topic menu. During the drag a local preview order renders; the
  // ONE reorderTopics persist happens on drop. Disabled while a search filter
  // is active (the ribbon then shows a partial list — reordering it would be
  // ambiguous).
  const ribbonTopics = visibleTopics;
  const ribbonElRef = useRef(null);

  // round302 (approved mockup) — the tiles scroll inside their own track so a long
  // agenda stays readable instead of crushing every name. Everything below is the
  // reachability layer: edge fades + round chevrons, a slim drag bar, the wheel,
  // the arrow keys, and auto-scroll while dragging a topic to reorder it.
  const trackRef = useRef(null);
  const sbarRef = useRef(null);
  const [ribbonScrollState, setRibbonScrollState] = useState({
    hasOverflow: false, atStart: true, atEnd: true, thumb: null,
  });
  const syncRibbonScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = maxPos(track);
    const pos = readPos(track);
    const edges = computeEdges(pos, max);
    const thumb = computeThumb({
      clientWidth: track.clientWidth,
      scrollWidth: track.scrollWidth,
      pos,
      barWidth: sbarRef.current?.clientWidth || 0,
    });
    setRibbonScrollState((prev) => (
      prev.hasOverflow === edges.hasOverflow
        && prev.atStart === edges.atStart
        && prev.atEnd === edges.atEnd
        && prev.thumb?.width === thumb?.width
        && prev.thumb?.offset === thumb?.offset
        ? prev
        : { ...edges, thumb }
    ));
  }, []);
  // Re-measure whenever the topic set or the pane's width changes.
  useEffect(() => {
    syncRibbonScroll();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(syncRibbonScroll);
    ro.observe(track);
    return () => ro.disconnect();
  }, [syncRibbonScroll, items]);
  const scrollRibbon = useCallback((dir) => {
    const track = trackRef.current;
    if (!track) return;
    const tileW = track.querySelector('[data-ribbon-topic]')?.offsetWidth || 0;
    writePos(track, stepFrom(readPos(track), tileW, dir));
    syncRibbonScroll();
  }, [syncRibbonScroll]);
  const onRibbonWheel = useCallback((e) => {
    const track = trackRef.current;
    if (!track || maxPos(track) <= 2) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    // A vertical wheel/trackpad gesture pans the strip — the expected feel for a
    // horizontal rail. preventDefault stops the card behind it from scrolling too.
    e.preventDefault();
    const previous = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    writePos(track, readPos(track) + delta);
    track.style.scrollBehavior = previous;
    syncRibbonScroll();
  }, [syncRibbonScroll]);
  const onSbarPointerDown = useCallback((e) => {
    const track = trackRef.current;
    const bar = sbarRef.current;
    if (!track || !bar) return;
    const max = maxPos(track);
    if (max <= 2) return;
    const thumbW = ribbonScrollState.thumb?.width || 0;
    const drag = { startX: e.clientX, startPos: readPos(track), max, span: bar.clientWidth - thumbW };
    bar.setPointerCapture?.(e.pointerId);
    const previous = track.style.scrollBehavior;
    track.style.scrollBehavior = 'auto';
    const onMove = (ev) => {
      writePos(track, posFromThumbDrag({ ...drag, x: ev.clientX }));
      syncRibbonScroll();
    };
    const onUp = () => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      track.style.scrollBehavior = previous;
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  }, [ribbonScrollState.thumb, syncRibbonScroll]);

  const canDragRibbon = editTopicOrPoint;
  const ghostRef = useRef(null);
  const clearGhost = () => { if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; } };

  // round237 — RIGHT-CLICK on a topic opens the edit/delete menu at the cursor.
  const handleTileContextMenu = (e, topic) => {
    e.preventDefault();
    if (!(editTopicOrPoint || deleteTopicOrPoint || canHide)) return;
    setTopicMenu({
      topicId: String(topic.id),
      x: Math.max(10, Math.min(e.clientX, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 180)),
      y: e.clientY + 4,
      confirm: false,
    });
  };

  // round237 — LEFT long-press (280ms, round255) starts a GHOST drag: a faded clone
  // follows the cursor and the ribbon opens a spacing GAP at the drop point;
  // the ONE reorderTopics persist happens on drop. Disabled while searching
  // (partial list ⇒ ambiguous order) or when editing is off.
  const handleTilePointerDown = (e, topic) => {
    if (e.button !== 0 || renamingTopicId === topic.id || !canDragRibbon) return;
    const topicId = String(topic.id);
    const startX = e.clientX, startY = e.clientY;
    const tileEl = e.currentTarget;
    let armed = false;
    let gapBefore = null;
    const timer = setTimeout(() => {
      armed = true;
      setTopicMenu(null);
      setDraggingTopicId(topicId);
      const g = document.createElement('div');
      g.className = styles.ribbonGhost;
      g.textContent = topic.name || '';
      g.style.background = getComputedStyle(tileEl).backgroundColor;
      g.style.left = startX + 'px';
      g.style.top = startY + 'px';
      document.body.appendChild(g);
      ghostRef.current = g;
      // round255 (owner request) — HALVE the long-press arm delay (560 → 280ms)
      // so a topic becomes draggable in half the time.
    }, 280);

    const onMove = (ev) => {
      if (!armed) return;
      if (ghostRef.current) { ghostRef.current.style.left = ev.clientX + 'px'; ghostRef.current.style.top = ev.clientY + 'px'; }
      // round302 — with a scrolling ribbon, a topic must be draggable to a position
      // that is currently off-screen: holding near an edge pans the strip under the
      // cursor. Without this, reordering could only reach the visible window.
      const track = trackRef.current;
      if (track && maxPos(track) > 2) {
        const r = track.getBoundingClientRect();
        const NEAR = 48;
        const previous = track.style.scrollBehavior;
        track.style.scrollBehavior = 'auto';
        if (ev.clientX < r.left + NEAR) writePos(track, readPos(track) + 14);
        else if (ev.clientX > r.right - NEAR) writePos(track, readPos(track) - 14);
        track.style.scrollBehavior = previous;
        syncRibbonScroll();
      }
      // round239 fix — DIRECTION-AGNOSTIC drop target. The old loop overwrote
      // its result and always ended on the last (rightmost) tile, so only the
      // right-edge gap ever opened. Instead: measure every OTHER tile's centre,
      // detect reading direction from the tiles themselves (DOM order == logical
      // order == visibleTopics), map x → a monotonic "reading key" (rtl ⇒ -x),
      // and the drop lands BEFORE the FIRST tile whose centre is past the cursor
      // in reading order. Works for any topic, not just the rightmost pair.
      const others = (ribbonElRef.current ? [...ribbonElRef.current.querySelectorAll('[data-ribbon-topic]')] : [])
        .map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-ribbon-topic'), mid: r.left + r.width / 2 }; })
        .filter((t) => t.id !== topicId);
      const before = computeRibbonDropTarget(others, ev.clientX);
      gapBefore = before;
      setGapBeforeId(before);
    };
    const onUp = () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (armed) {
        clearGhost();
        setDraggingTopicId(null);
        const order = visibleTopics.map((t) => String(t.id));
        const from = order.indexOf(topicId);
        if (from > -1) {
          order.splice(from, 1);
          const to = gapBefore != null ? order.indexOf(String(gapBefore)) : -1;
          if (to > -1) order.splice(to, 0, topicId); else order.push(topicId);
          reorderTopics(order);
        }
        setGapBeforeId(null);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // Create-from-point callbacks — rendered only when the parent provided the
  // handler (the parent gates by the createDecision/createTask capabilities).
  // `anchor` = the clicked "+" button's rect, so the create box opens under it.
  // round243 — attach the agenda box's bounds to the "+" rect so the quick-create
  // card opens confined INSIDE the topics card (round237 point 1). Copies the
  // rect fields into a plain object (DOMRect props aren't enumerable) + bounds.
  const withAgendaBounds = (anchor) => {
    if (!anchor) return anchor;
    const b = agendaBoxRef.current?.getBoundingClientRect();
    return {
      left: anchor.left, top: anchor.top, right: anchor.right,
      bottom: anchor.bottom, width: anchor.width, height: anchor.height,
      bounds: b
        ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }
        : null,
    };
  };
  const onCreatePointDecision = typeof onCreateFromPoint === 'function'
    ? (point, anchor) => onCreateFromPoint('decision', point, withAgendaBounds(anchor))
    : undefined;
  const onCreatePointTask = typeof onCreateFromPoint === 'function'
    ? (point, anchor) => onCreateFromPoint('task', point, withAgendaBounds(anchor))
    : undefined;
  const onOpenPointItems = (kind, point) => setPopup({ kind, point });

  // round302 — a freshly created discussion finishes building HERE: the create card
  // hands over after its topics exist, and their points are still being written.
  // Show the app's standard loading animation for that window rather than a
  // half-filled agenda; `__building` is cleared by the stage that completes it
  // (or by a failure, so this can never spin forever).
  if (discussion?.__building) {
    return (
      <div className={styles.building}>
        <BrandLoader />
        <span className={styles.buildingText}>בונה את סדר היום…</span>
      </div>
    );
  }

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
    <div ref={rootRef} className={styles.wrap} dir="ltr">

      {/* Floating bulk-action bar (Round 7) — appears when ≥1 point is selected.
          Same chrome as the Tasks/Decisions action bars: count · actions · close. */}
      {selectedPointIds.size > 0 && (
        <div className={styles.actionBar} role="region" aria-label="פעולות על נקודות נבחרות">
          <div className={styles.actionBarLeft}>
            <Text type={"text2"} element="span">{selectedPointIds.size} נבחרו</Text>
          </div>
          <div className={styles.actionBarCenter}>
            {canHide && (
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

      {/* round200 — the tab splits into two columns: the topic tables on the LEFT
          (ending at the tasks column instead of bleeding right) and the
          "התייחסויות" panel on the RIGHT. */}
      <div
        ref={splitRowRef}
        className={`${styles.splitRow} ${layout.stacked ? styles.splitRowStacked : ''} ${editLayout ? styles.splitRowEditing : ''}`}
      >
      {showTopics && (
      <div
        className={styles.topicsCol}
        style={{
          // round251 — height is PER-BOX: the agenda column carries its own var,
          // so resizing it never touches the triple box.
          ...(layout.boxHeight ? { '--split-card-h': `${layout.boxHeight}px` } : null),
          // round293 — width driven PURELY by the ratio (proportional grow,
          // basis 0) so dragging the divider tracks the pointer across the WHOLE
          // range. round292's percent-basis froze the drag over a sub-range: the
          // triple box's `.refPanel` max-width:720/min-width:360 (which the `flex`
          // shorthand does NOT override) clamped that percent basis, so the split
          // stopped moving. Those caps are neutralized inline on the triple box
          // below; here basis 0 + proportional grow keeps agenda = ratio × row.
          // A sole visible box (grow as the only child) still fills 100%.
          ...(layout.stacked ? { flex: '1 1 auto', width: '100%' } : { flex: `${layout.ratio} 1 0`, minWidth: 0 }),
        }}
      >
      {/* round218 (approved mockup) — the topics live in an "אג'נדה" CARD
          symmetric to the triple box: same width/border/radius, a gray header
          labeled אג'נדה, and a toolbar strip (נושא חדש · מתבנית · חיפוש · הסתר
          · כווץ) mirroring the triple box's formatting bar. */}
      <div className={styles.agendaBox} ref={agendaBoxRef}>
      {/* round237 — "אג'נדה" on the RIGHT (start); the search was removed; the
          templates control (with preview) sits on the LEFT (end). */}
      <div className={styles.agendaHead} dir="rtl">
        <span>אג'נדה</span>
        <span className={styles.headTools}>
          {addTopicOrPoint && (
            <ApplyTemplateMenu
              discussionId={discussion.id}
              onApplied={() => refetch({ showLoader: false })}
              existingTopicIds={items.map((t) => String(t.id))}
            />
          )}
          {renderLayoutTools('agenda')}
        </span>
      </div>
      {/* round235 (approved mockup v3, muted colors) — the TOPICS RIBBON fills
          the 48px band that used to hold נושא חדש/הסתר/כווץ: every topic is a
          full-height muted status-label with a gentle 9px arrow point toward
          the NEXT topic (left, RTL). Click = select; ⋮ = menu (rename /
          priority / hide / delete); LONG-PRESS the ⋮ = horizontal drag. */}
      <div className={`${styles.toolbar} ${styles.ribbon}`} ref={ribbonElRef}>
        {/* round237 — the "+" at the START (rightmost): a puzzle piece that
            completes the first topic's back edge; opens an inline editable box. */}
        {addTopicOrPoint && (addWhere === 'start' ? (
          <div className={styles.ribbonAddForm}>
            <input
              className={styles.ribbonAddInput}
              autoFocus
              value={newTopicText}
              placeholder="שם הנושא…"
              aria-label="שם הנושא החדש (בתחילת הדיון)"
              onChange={(e) => setNewTopicText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddTopic('start'); }
                if (e.key === 'Escape') { setAddWhere(null); setNewTopicText(''); }
              }}
              onBlur={() => handleAddTopic('start')}
            />
          </div>
        ) : (
          <button
            type="button"
            className={styles.ribbonAdd}
            title="נושא בתחילת הדיון"
            aria-label="נושא בתחילת הדיון"
            onClick={() => { setAddWhere('start'); setNewTopicText(''); }}
          >
            <Plus size={15} />
          </button>
        ))}
        {/* round302 — the tiles scroll in here; the two "+" pieces stay PINNED
            outside it, so they never scroll away and never move. */}
        <div
          className={styles.ribbonTrack}
          ref={trackRef}
          onScroll={syncRibbonScroll}
          onWheel={onRibbonWheel}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); scrollRibbon('end'); }
            if (e.key === 'ArrowRight') { e.preventDefault(); scrollRibbon('start'); }
          }}
          tabIndex={ribbonScrollState.hasOverflow ? 0 : -1}
          role="tablist"
          aria-label="נושאי הדיון"
        >
        {ribbonTopics.map((topic, i) => {
          const topicId = String(topic.id);
          const prioColor = topic.priority != null ? priorityOpts.colorById?.[topic.priority] : null;
          const accentVar = accentByTopicId[topic.id] || '--topic-color-1';
          const isActive = activeTopic && String(activeTopic.id) === topicId;
          const excluded = topic.notForDiscussion === true;
          const tileClass = [
            styles.ribbonTile,
            isActive ? styles.ribbonTileOn : '',
            excluded ? styles.ribbonTileExcluded : '',
            draggingTopicId === topicId ? styles.ribbonTileGhosted : '',
          ].filter(Boolean).join(' ');
          // round239 — during a drag, a visible SEPARATOR BAR opens between the
          // two neighbours where the drop will land (dropping there places the
          // topic exactly between them). Rendered before the hovered tile.
          const dropBar = draggingTopicId && gapBeforeId === topicId
            ? <span key={`drop-${topicId}`} className={styles.ribbonDropBar} aria-hidden="true" />
            : null;
          return (
            <React.Fragment key={topicId}>
            {dropBar}
            <div
              data-ribbon-topic={topicId}
              className={tileClass}
              style={{ '--tile-accent': prioColor || `hsl(var(${accentVar}))`, zIndex: ribbonTopics.length - i }}
              role="tab"
              aria-selected={!!isActive}
              tabIndex={0}
              onClick={() => { setActiveTopicId(topicId); setTopicMenu(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveTopicId(topicId); }}
              // round267 (owner request) — LEFT double-click on a topic tile opens
              // its inline rename (same editor the ⋮/right-click "עריכת שם" opens).
              onDoubleClick={(e) => {
                if (!editTopicOrPoint) return;
                e.preventDefault();
                e.stopPropagation();
                setTopicMenu(null);
                setRenamingTopicId(topicId);
              }}
              onContextMenu={(e) => handleTileContextMenu(e, topic)}
              onPointerDown={(e) => handleTilePointerDown(e, topic)}
              title={topic.name}
            >
              {renamingTopicId === topicId ? (
                <input
                  className={styles.ribbonRenameInput}
                  autoFocus
                  defaultValue={topic.name || ''}
                  aria-label="ערוך שם נושא"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = e.currentTarget.value.trim();
                      if (v && v !== topic.name && renameTopic) renameTopic(topic.id, v);
                      setRenamingTopicId(null);
                    }
                    if (e.key === 'Escape') { e.preventDefault(); setRenamingTopicId(null); }
                  }}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== topic.name && renameTopic) renameTopic(topic.id, v);
                    setRenamingTopicId(null);
                  }}
                />
              ) : (
                <span className={styles.ribbonName}>{topic.name}</span>
              )}
              {excluded && <EyeOff size={12} className={styles.ribbonEye} aria-label="נושא מוסתר" />}
            </div>
            </React.Fragment>
          );
        })}
        {/* round239 — dropping at the END shows the separator bar after the last
            topic (gapBeforeId null while dragging). */}
        {draggingTopicId && gapBeforeId == null && <span className={styles.ribbonDropBar} aria-hidden="true" />}
        </div>
        {/* round302 — reachability for what the track hides. The fades appear ONLY
            when there is something that way, so a short agenda stays clean; the
            chevrons are round, unlike the puzzle-shaped "+" beside them. */}
        <div
          className={`${styles.ribbonEdge} ${styles.ribbonEdgeStart} ${ribbonScrollState.hasOverflow && !ribbonScrollState.atStart ? styles.ribbonEdgeOn : ''}`}
          aria-hidden={ribbonScrollState.atStart}
        >
          <button
            type="button"
            className={styles.ribbonChev}
            title="לנושאים הקודמים"
            aria-label="לנושאים הקודמים"
            tabIndex={ribbonScrollState.hasOverflow && !ribbonScrollState.atStart ? 0 : -1}
            onClick={() => scrollRibbon('start')}
          >
            <DropdownChevronDown className={styles.ribbonChevIconStart} />
          </button>
        </div>
        <div
          className={`${styles.ribbonEdge} ${styles.ribbonEdgeEnd} ${ribbonScrollState.hasOverflow && !ribbonScrollState.atEnd ? styles.ribbonEdgeOn : ''}`}
          aria-hidden={ribbonScrollState.atEnd}
        >
          <button
            type="button"
            className={styles.ribbonChev}
            title="לנושאים הבאים"
            aria-label="לנושאים הבאים"
            tabIndex={ribbonScrollState.hasOverflow && !ribbonScrollState.atEnd ? 0 : -1}
            onClick={() => scrollRibbon('end')}
          >
            <DropdownChevronDown className={styles.ribbonChevIconEnd} />
          </button>
        </div>
        {/* The slim, draggable position indicator — on the strip's bottom rule, so
            it adds no height and the 48px contract holds. */}
        <div
          ref={sbarRef}
          className={`${styles.ribbonSbar} ${ribbonScrollState.thumb ? styles.ribbonSbarOn : ''}`}
          onPointerDown={onSbarPointerDown}
          aria-hidden="true"
        >
          {ribbonScrollState.thumb && (
            <div
              className={styles.ribbonThumb}
              style={{ width: `${ribbonScrollState.thumb.width}px`, insetInlineStart: `${ribbonScrollState.thumb.offset}px` }}
            />
          )}
        </div>
        {/* round237 — the "+" at the END (leftmost): completes the puzzle at the
            end of the discussion; opens an inline editable box. round250 (owner
            request) — when there are NO topics yet, show only the single START
            "+" (rightmost); the end "+" appears once at least one topic exists. */}
        {addTopicOrPoint && ribbonTopics.length > 0 && (addWhere === 'end' ? (
          <div className={`${styles.ribbonAddForm} ${styles.ribbonAddFormEnd}`}>
            <input
              className={styles.ribbonAddInput}
              autoFocus
              value={newTopicText}
              placeholder="שם הנושא…"
              aria-label="שם הנושא החדש (בסוף הדיון)"
              onChange={(e) => setNewTopicText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddTopic('end'); }
                if (e.key === 'Escape') { setAddWhere(null); setNewTopicText(''); }
              }}
              onBlur={() => handleAddTopic('end')}
            />
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.ribbonAdd} ${styles.ribbonAddEnd}`}
            title="נושא בסוף הדיון"
            aria-label="נושא בסוף הדיון"
            onClick={() => { setAddWhere('end'); setNewTopicText(''); }}
          >
            <Plus size={15} />
          </button>
        ))}
      </div>
      <div className={styles.agendaBody}>
      {activeTopic && (
      <DndContext sensors={sensors} collisionDetection={closestCenter}>
        <SortableContext items={[String(activeTopic.id)]} strategy={verticalListSortingStrategy}>
          {[activeTopic].map((topic) => (
            <SortableTopicSection
              key={topic.id}
              headless
              topic={topic}
              accent={accentByTopicId[topic.id] || '--topic-color-1'}
              open
              onToggleOpen={() => {}}
              usersById={usersById}
              renameTopic={renameTopic}
              onRetryCreate={retryCreate}
              deleteTopic={deleteTopic}
              addPoint={addPoint}
              togglePoint={applyTogglePoint}
              toggleTopicNotForDiscussion={toggleTopicNotForDiscussion}
              renamePoint={renamePoint}
              reorderPoints={reorderPoints}
              columns={visibleKeys}
              canAdd={addTopicOrPoint}
              canEditTopic={editTopicOrPoint}
              canHideTopic={canHide}
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
              onDeletePoint={deletePoint}
              selectable={canSelectPoints}
              selectedPointIds={selectedPointIds}
              onTogglePointSelect={togglePointSelect}
              onToggleTopicPoints={toggleTopicPoints}
              selectionActive={hasPointSelection}
              decisionIdSet={decisionIdSet}
              taskIdSet={taskIdSet}
              pointItemsByPoint={pointItemsByPoint}
              createStatusByPoint={createStatusByPoint}
            />
          ))}
        </SortableContext>
      </DndContext>
      )}

      {items.length === 0 && !addWhere && (
        <EmptyState>אין נושאים לדיון זה</EmptyState>
      )}
      </div>{/* .agendaBody */}
      </div>{/* .agendaBox */}
      {renderHeightHandle('agenda')}
      {renderCornerHandle('agenda')}
      </div>
      )}

      {/* round241 — owner-only resize divider between the two boxes (side-by-side
          + edit mode only). Dragging it re-shares the row width; growing one box
          shrinks the other. */}
      {editLayout && canManageSettings && !layout.stacked
        && showTopics && (showBackground || showReferences || showSummary) && (
        <div
          className={styles.splitDivider}
          role="separator"
          aria-orientation="vertical"
          aria-label="שינוי רוחב התיבות"
          title="גרור לשינוי רוחב התיבות"
          onPointerDown={onDividerPointerDown}
        >
          <span className={styles.splitDividerGrip} aria-hidden="true" />
        </div>
      )}

      {/* round206 (approved mockup) — the TRIPLE BOX on the physical RIGHT:
          one card, three header titles (רקע → התייחסויות → סיכום), each pane
          its own monday Update; owner-hidden panes drop their header. Same
          fixed edit rule (coordinator/creator/lead + owner) gates all three. */}
      {(showBackground || showReferences || showSummary) && (
      <div
        className={styles.refPanel}
        style={{
          // round251 — the triple box carries its OWN height var, independent of
          // the agenda box.
          ...(layout.boxHeight ? { '--split-card-h': `${layout.boxHeight}px` } : null),
          // round293 — see the agenda box: proportional grow (basis 0) + NEUTRALIZE
          // the `.refPanel` max-width:720/min-width:360 caps inline so the divider
          // drag tracks the pointer across the whole range AND the box fills 100%
          // (alone or paired). Without minWidth:0/maxWidth:none the stylesheet caps
          // fight the ratio and the split freezes (round292 regression).
          ...(layout.stacked ? { flex: '1 1 auto', width: '100%' } : { flex: `${1 - layout.ratio} 1 0`, minWidth: 0, maxWidth: 'none' }),
        }}
      >
        <UpdatesTripleBox
          discussionId={discussion?.id}
          canAttach={canAttachDocuments}
          canEditBackground={canEditBackground}
          canEditReferences={canEditReferences}
          canEditSummary={canEditSummary}
          showBackground={showBackground}
          showReferences={showReferences}
          showSummary={showSummary}
          mentionPeople={mentionPeople}
          resetPaneNonce={paneResetNonce}
        />
        {renderHeightHandle('triple')}
        {renderCornerHandle('triple')}
      </div>
      )}
      </div>

      {/* round235 — the ribbon ⋮ menu: rename / priority / hide / delete (with
          inline confirm). Fixed-position under the clicked ⋮; a transparent
          backdrop closes it. */}
      {topicMenu && (() => {
        const t = items.find((x) => String(x.id) === String(topicMenu.topicId));
        if (!t) return null;
        return (
          <>
            <div className={styles.topicMenuBackdrop} onClick={() => setTopicMenu(null)} />
            <div className={styles.topicMenu} style={{ left: topicMenu.x, top: topicMenu.y }} dir="rtl" role="menu">
              {/* round267 (owner request) — the topic CREATOR's avatar + name at
                  the top of the menu, above "עריכת שם". Shown only for a topic that
                  has a creator; topics generated from a template/duplicate/type
                  default carry no creator (see createTopicsFromTemplate), so no
                  avatar appears for them. */}
              {t.creatorId && (
                <div className={styles.topicMenuCreator}>
                  <CreatorAvatar userId={t.creatorId} usersById={usersById} size="small" />
                  <span className={styles.topicMenuCreatorName}>
                    {usersById[String(t.creatorId)]?.name || 'יוצר הנושא'}
                  </span>
                </div>
              )}
              {editTopicOrPoint && (
                <button
                  type="button"
                  className={styles.topicMenuItem}
                  onClick={() => { setRenamingTopicId(String(t.id)); setTopicMenu(null); }}
                >
                  <Edit size={15} /> עריכת שם
                </button>
              )}
              {/* round260 (owner request) — the "הסתר/הצג נושא" menu item was
                  removed; topic hiding is no longer offered in the UI. */}
              {priorityMapped && editTopicOrPoint && (priorityOpts.options || []).length > 0 && (
                <div className={styles.topicMenuPrio}>
                  <span className={styles.topicMenuPrioLabel}>עדיפות</span>
                  {(priorityOpts.options || []).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`${styles.topicMenuPrioOpt} ${t.priority === opt.id ? styles.topicMenuPrioOn : ''}`}
                      onClick={() => {
                        setTopicMenu(null);
                        updateTopicPriority && updateTopicPriority(t.id, t.priority === opt.id ? null : opt.id);
                      }}
                    >
                      <span className={styles.topicMenuPrioDot} style={{ background: opt.color }} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {deleteTopicOrPoint && (
                <button
                  type="button"
                  className={`${styles.topicMenuItem} ${styles.topicMenuDanger}`}
                  onClick={() => { setTopicMenu(null); deleteTopicWithUndo(t); }}
                >
                  <Trash2 size={15} /> מחיקת נושא
                </button>
              )}
            </div>
          </>
        );
      })()}

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

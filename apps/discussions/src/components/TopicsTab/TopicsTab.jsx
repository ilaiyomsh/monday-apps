import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton, Button, TextField, Dialog, DialogContentContainer } from '@vibe/core';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import { useUsers } from '@generated/utils/mondayApi/hooks/use-users.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { Plus, ChevronDown, GripVertical, Eye, EyeOff } from 'lucide-react';
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
import { useColumnOrder } from '@generated/hooks/useColumnOrder.js';
import { useColumnWidths } from '@generated/hooks/useColumnWidths.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '@generated/components/SortableColumnHeader';
import { TOPICS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import { TopicPointRow, RowKebabMenu, CreatorAvatar } from '@generated/components/TopicPointRow';
import { ApplyTemplateMenu } from '@generated/components/ApplyTemplateMenu';
import styles from './TopicsTab.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// One grid template shared by every topic's column header + point rows so they
// always line up (mirrors the My Tasks table pattern of one rowStyle for both):
//   [kebab/grip] | נקודה לדיון | נידונה | avatar
// Desktop widths are draggable + persisted per instance (useColumnWidths, ONE
// 'topics' setting for all topic groups); the order of the נידונה/avatar columns
// is drag-reorderable (useColumnOrder — lead + name stay pinned first). Mobile
// falls back to the original compact flexible template.
const TOPIC_COLUMN_KEYS = ['lead', 'name', 'check', 'avatar'];
const TOPIC_PINNED = ['lead', 'name'];
const MOBILE_TRACK = { lead: '40px', name: 'minmax(140px, 1fr)', check: '56px', avatar: '44px' };
// Ghost labels for the header drag overlay.
const COL_LABEL = { check: 'נידונה', avatar: 'יוצר' };

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

const TOPIC_SKELETON_H = 44;

/* 20-color monday LABEL palette (see theme-tokens.css --topic-color-1..20). */
const TOPIC_COLOR_COUNT = 20;
function topicColorStartIndex(id, seed = 0) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return (h + seed) % TOPIC_COLOR_COUNT;
}

/* One topic = a GROUP: a sortable header band (accent color, collapse caret, drag
   grip, name, creator avatar, discussed count, optional priority, hover kebab) +
   a column header row + the topic's point rows as a table. */
function SortableTopicSection({
  topic, accent, open, onToggleOpen, usersById, responsesMapped,
  renameTopic,
  deleteTopic, addPoint, togglePoint, updatePointResponses,
  togglePointNotForDiscussion, toggleTopicNotForDiscussion,
  renamePoint, deletePoint, reorderPoints,
  // Column layout — computed ONCE in TopicsTab (shared by all sections):
  // ordered keys, the grid template, and the owner-only resize/reorder actions.
  colOrder, rowStyle, canReorderCols = false, canResizeCols = false,
  startColResize, reorderCols,
  // Granular discussion-tier caps (each equals the legacy canEdit while the
  // feature is off). add → add topic/point; edit → rename/priority/drag-reorder;
  // del → delete/hide; check → "נידונה" toggle; responses → התייחסויות text.
  canAdd = true, canEditTopic = true, canDelete = true, canCheck = true, canEditResponses = true,
  priorityMapped = false, priorityOptions, priorityLabelById, priorityColorById, updateTopicPriority,
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

  const points = topic._subitems || [];
  const excluded = topic.notForDiscussion === true;
  const effectiveOpen = open && !excluded;

  const forDiscussion = points.filter((p) => p.notForDiscussion !== true);
  const discussedCount = forDiscussion.filter((p) => p.discussed === true).length;
  const total = forDiscussion.length;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.section} ${excluded ? styles.sectionExcluded : ''}`}
    >
      <div className={styles.sectionHeader}>
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

        {canEditTopic && (
          <button type="button" className={styles.grip} {...attributes} {...listeners} aria-label="גרור נושא">
            <GripVertical size={16} />
          </button>
        )}

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
              style={{ color: `hsl(${accentTri})`, opacity: excluded ? 0.5 : 1 }}
              onDoubleClick={canEditTopic && !excluded ? (e) => {
                e.preventDefault(); e.stopPropagation();
                setTitleDraft(topic.name || ''); setEditingTitle(true);
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

        {/* count badge sits right after the title; the creator avatar follows it
            (swapped from the previous title→avatar→count order). */}
        <span className={styles.count} title="נדונו מתוך סך הנקודות לדיון (ללא מוסתרות)">
          {discussedCount}/{total}
        </span>

        {/* Creator avatar — revealed only while hovering the topic's header. */}
        <span className={styles.headerAvatar}>
          <CreatorAvatar userId={topic.creatorId} usersById={usersById} />
        </span>

        <span className={styles.headerSpacer} />

        {priorityMapped && (
          <PriorityPill
            value={topic.priority}
            options={priorityOptions}
            labelById={priorityLabelById}
            colorById={priorityColorById}
            canEdit={canEditTopic}
            onChange={(labelId) => updateTopicPriority && updateTopicPriority(topic.id, labelId)}
          />
        )}

        {canDelete && (
          <RowKebabMenu
            excluded={excluded}
            kind="נושא"
            className={styles.headerKebab}
            onDelete={() => deleteTopic(topic.id)}
          />
        )}
      </div>

      {effectiveOpen && (
        <div className={styles.sectionBody}>
          {/* column header — cells follow the shared column ORDER; owners get a
              resize handle per column + drag-reorder on the movable ones. */}
          <div className={styles.colHead} style={rowStyle}>
            <ColumnHeaderDnd
              enabled={canReorderCols}
              ids={colOrder.filter((k) => !TOPIC_PINNED.includes(k))}
              labels={COL_LABEL}
              onReorder={reorderCols}
            >
              {colOrder.map((key) => {
                if (key === 'lead') return <span key="lead" className={styles.colHeadLead} />;
                const handle = canResizeCols
                  ? <ResizeHandle onMouseDown={(e) => startColResize(key, e)} />
                  : null;
                if (key === 'name') {
                  return (
                    <span key="name" className={styles.colHeadCell} style={canResizeCols ? { position: 'relative' } : undefined}>
                      {handle}
                    </span>
                  );
                }
                const center = key === 'check' ? ` ${styles.colHeadCenter}` : '';
                const label = key === 'check' ? '#' : '';
                const inner = (<>{label}{handle}</>);
                return canReorderCols ? (
                  <SortableHeaderCell key={key} id={key} className={`${styles.colHeadCell}${center}`}>
                    {inner}
                  </SortableHeaderCell>
                ) : (
                  <span
                    key={key}
                    className={`${styles.colHeadCell}${center}`}
                    style={canResizeCols ? { position: 'relative' } : undefined}
                    title={key === 'check' ? 'נידונה' : undefined}
                  >
                    {inner}
                  </span>
                );
              })}
            </ColumnHeaderDnd>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePointDragEnd}>
            <SortableContext items={points.map((p) => String(p.id))} strategy={verticalListSortingStrategy}>
              {points.map((point) => (
                <TopicPointRow
                  key={point.id}
                  point={point}
                  usersById={usersById}
                  rowStyle={rowStyle}
                  columns={colOrder}
                  responsesMapped={responsesMapped}
                  onToggle={togglePoint}
                  onUpdateResponses={updatePointResponses}
                  onToggleNotForDiscussion={togglePointNotForDiscussion}
                  onRename={renamePoint}
                  onDelete={deletePoint}
                  canEditPoint={canEditTopic}
                  canDelete={canDelete}
                  canCheck={canCheck}
                  canEditResponses={canEditResponses}
                />
              ))}
            </SortableContext>
          </DndContext>

          {points.length === 0 && (
            <div className={styles.noPoints}>אין נקודות לנושא זה</div>
          )}

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
  checkPoint = true, editResponses = true,
  // System-tier: column drag-reorder + width resize (owners/admins, from
  // `can('reorderColumns')` in DiscussionCard — same gate as the task tables).
  canReorderColumns = false,
}) {
  const {
    items, loading, addTopic, addPoint, togglePoint, updatePointResponses, refetch,
    togglePointNotForDiscussion, toggleTopicNotForDiscussion, updateTopicPriority,
    renameTopic, deleteTopic, renamePoint, deletePoint, reorderTopics, reorderPoints,
  } = useTopics(discussion.id, { onSuccess: onNotify, onLoading: onNotifyLoading, onDismiss: onDismissToast });

  const priorityMapped = !!getColumns('topics')?.topicPriorityID?.id;
  const responsesMapped = !!getColumns('topics')?.pointResponsesID?.id;
  const priorityOpts = useStatusOptions('topics', 'topicPriorityID');

  // Column layout — ONE persisted order + width set ('topics') shared by every
  // topic group. lead (kebab/grip) + name stay pinned; נידונה/avatar are movable.
  const { isMobile } = useViewport();
  const { order: colOrder, reorder: reorderCols } = useColumnOrder('topics', TOPIC_COLUMN_KEYS, TOPIC_PINNED);
  const colDefs = colOrder.map((k) => (k === 'lead' ? { key: 'lead', fixed: 40 } : { key: k, ...W[k] }));
  const { gridTemplate, startResize } = useColumnWidths('topics', colDefs);
  const mobileTemplate = colOrder.map((k) => MOBILE_TRACK[k]).filter(Boolean).join(' ');
  const rowStyle = { gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate };
  const canReorderCols = canReorderColumns && !isMobile;

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
              responsesMapped={responsesMapped}
              renameTopic={renameTopic}
              deleteTopic={deleteTopic}
              addPoint={addPoint}
              togglePoint={togglePoint}
              updatePointResponses={updatePointResponses}
              togglePointNotForDiscussion={togglePointNotForDiscussion}
              toggleTopicNotForDiscussion={toggleTopicNotForDiscussion}
              renamePoint={renamePoint}
              deletePoint={deletePoint}
              reorderPoints={reorderPoints}
              colOrder={colOrder}
              rowStyle={rowStyle}
              canReorderCols={canReorderCols}
              canResizeCols={canReorderCols}
              startColResize={startResize}
              reorderCols={reorderCols}
              canAdd={addTopicOrPoint}
              canEditTopic={editTopicOrPoint}
              canDelete={deleteTopicOrPoint}
              canCheck={checkPoint}
              canEditResponses={editResponses}
              priorityMapped={priorityMapped}
              priorityOptions={priorityOpts.options}
              priorityLabelById={priorityOpts.labelById}
              priorityColorById={priorityOpts.colorById}
              updateTopicPriority={updateTopicPriority}
            />
          ))}
        </SortableContext>
      </DndContext>

      {items.length === 0 && !addingTopic && (
        <div className={styles.empty}>אין נושאים לדיון זה</div>
      )}
    </div>
  );
}

export default TopicsTab;

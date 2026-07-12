import React, { useState } from 'react';
import { Avatar, Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { Update, Edit } from '@vibe/icons';
import { Trash2, EyeOff, Eye, MoreHorizontal, Check } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { CreateProgressBar } from '@generated/components/CreateProgressBar';
import styles from './TopicPointRow.module.css';

function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

// Open a point's item card on the Updates pane — identical to the Tasks name
// cell's updates affordance (kind:'updates' renders monday's side panel). A
// POINT is a subitem, so point.id is a real monday item id; guard the temp id
// of an optimistic (not-yet-saved) point so it never targets a bogus id.
// Open the point's item card via the shared helper. monday's SDK has no
// programmatic close (see utils/itemCard.js), so every click reliably (re)opens.
// A POINT is a subitem, so guard the temp id of an optimistic (not-yet-saved) point.
function openItemCard(itemId) {
  if (!itemId || String(itemId).startsWith('temp-')) return;
  openOrToggleItemCard(itemId);
}

/* Creator avatar (who created the topic / point). Resolves the user from the
   shared usersById map (populated by useUsers in TopicsTab); falls back to a
   neutral placeholder while the photo/name is still loading or unset. Still
   used by the topic GROUP HEADER (TopicsTab) — the per-point avatar column was
   removed from the table in the decisions redesign. */
export function CreatorAvatar({ userId, usersById, size = 'small' }) {
  if (!userId) return <span className={styles.avatarEmpty} aria-hidden="true" />;
  const user = usersById?.[String(userId)];
  const label = user?.name || 'יוצר';
  return (
    // Native-title name tooltip (round 33): browser-rendered, so it is never
    // clipped by an overflow ancestor and always paints above all app UI.
    <span title={label} style={{ display: 'inline-flex' }}>
      <Avatar
        size={size}
        src={user?.photo_thumb}
        text={initialsOf(user?.name)}
        type={user?.photo_thumb ? 'img' : 'text'}
        ariaLabel={label}
      />
    </span>
  );
}

/* Hover-revealed 3-dot menu (kebab) for a topic group header or a point row.
   Opens a small Dialog with "הסתר/הצג" (toggles the not-for-discussion board
   checkbox) and "מחק" (inline-confirm). Shared by the group header + point row so
   both behave identically. */
export function RowKebabMenu({ excluded, onToggleHide, onDelete, kind = 'נקודה', className = '' }) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const close = () => { setOpen(false); setConfirmDel(false); };
  return (
    <span className={`${styles.kebabWrap} ${className}`} onClick={(e) => e.stopPropagation()}>
      <Dialog
        open={open}
        showTrigger={[]}
        hideTrigger={['clickoutside', 'esc']}
        onDialogDidHide={close}
        position="bottom-start"
        zIndex={1000}
        content={() => (
          <DialogContentContainer>
            <div className={styles.menu}>
              {onToggleHide && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => { onToggleHide?.(); close(); }}
              >
                {excluded ? <Eye size={15} /> : <EyeOff size={15} />}
                {excluded ? 'הצג' : 'הסתר'}
              </button>
              )}
              {onDelete && (confirmDel ? (
                <div className={styles.menuConfirm}>
                  <span>{`למחוק ${kind}?`}</span>
                  <button type="button" className={`${styles.menuIcon} ${styles.menuDanger}`} onClick={() => { onDelete(); close(); }} aria-label="אישור מחיקה">
                    <Check size={15} />
                  </button>
                  <button type="button" className={styles.menuIcon} onClick={() => setConfirmDel(false)} aria-label="ביטול">
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.menuItem} ${styles.menuDanger}`}
                  onClick={() => setConfirmDel(true)}
                >
                  <Trash2 size={15} /> מחק
                </button>
              ))}
            </div>
          </DialogContentContainer>
        )}
      >
        <button
          type="button"
          className={styles.kebabBtn}
          aria-label="פעולות"
          title="פעולות"
          onClick={() => setOpen((o) => !o)}
        >
          <MoreHorizontal size={16} />
        </button>
      </Dialog>
    </span>
  );
}

/**
 * A discussion POINT = a subitem, rendered as a TABLE ROW (monday-style) aligned
 * to the group's column header via the shared `rowStyle` grid template
 * (decisions redesign — FIXED columns), aligned to a Tasks item row:
 *   [checkbox lead 36px] | נקודה לדיון (flex) | נידונה 66px | החלטות 168px | משימות 168px
 * "נידונה" (discussed) persists to the subitems board when pointCheckedID is
 * mapped (app-local storage fallback otherwise — handled in useTopics).
 * החלטות/משימות cells: a dashed "+" (create a decision/task FROM this point —
 * rendered only when the create callback is provided, so the parent gates it by
 * capability) and a round counter pill (filled when >0) that opens the
 * PointItemsPopup.
 *
 * ROW STRUCTURE (mirrors TaskTableRow): the LEADING cell is a clean selection
 * checkbox carrying the topic accent strip (inset 6px) — like Tasks' `.selectCell`.
 * The NAME cell is the start-aligned name with the "updates" chat-bubble icon
 * pinned to its trailing edge (like `.taskFirst` + `.updatesBtn`); the point's
 * hide(eye) action is hover-revealed there too. There is no per-row delete
 * (trash) affordance — points are deleted via the נושאים tab's bulk delete.
 *
 * DRAG-TO-REORDER: the WHOLE ROW is the drag handle (native monday board feel) —
 * the six-dot grip was removed. dnd-kit's PointerSensor activation distance (set
 * in TopicsTab, ~8px) means a small press-move starts a drag while a plain click
 * still edits the cell. Interactive cells call stopPropagation so their clicks
 * never bubble into a drag start.
 */
export function TopicPointRow({
  point, rowStyle,
  // Per-point creator avatar (round 58): the creator's avatar is revealed on row
  // hover just left of the updates bubble. Resolved from usersById (threaded by
  // TopicsTab, which collects topic + point creator ids) via point.creatorId.
  usersById,
  onToggle, onToggleNotForDiscussion, onRename,
  // Optimistic-create error affordance: retry re-runs a failed point create.
  // (Deletion is via the נושאים tab's multi-select bulk delete — the per-row
  // trash affordance was removed.)
  onRetryCreate,
  // Granular discussion-tier caps. Each equals the legacy canEdit while the
  // permissions feature is off, so behavior is unchanged. point edit (rename +
  // whole-row drag + hide), check ("נידונה" toggle).
  canEditPoint = true, canCheck = true,
  // Decisions/tasks link counters (linked ids length, from pointDecisionsLinkID /
  // pointTasksLinkID; 0 when the columns are unmapped).
  decisionCount = 0, taskCount = 0,
  // Create-from-point + open-counter-popup callbacks (threaded by TopicsTab).
  onCreateDecision, onCreateTask, onOpenDecisions, onOpenTasks,
  // Visible column keys (round 47 Hide) from TopicsTab — 'name' is always shown;
  // check/decisions/tasks render only when present, matching the shared grid
  // template (rowStyle). Undefined ⇒ every column shows (back-compat default).
  columns,
  // Multi-select (Round 7) — the leading checkbox cell when selectable.
  selectable = false, selected = false, onToggleSelect,
  // Round 52 — per-point create-from-point progress. Each is
  // 'pending' | 'success' | 'error' | undefined and drives the inline
  // CreateProgressBar overlay on the matching link cell (threaded from
  // DiscussionCard's handleQuickCreate through TopicsTab).
  decisionCreateStatus, taskCreateStatus,
}) {
  const discussed = point.discussed === true;
  const excluded = point.notForDiscussion === true;
  // Background create failed: keep the point + show a clear error + retry.
  const failed = point._createFailed === true;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(point.name || '');

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(point.id) });
  const style = {
    ...rowStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const savePointName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== point.name && onRename) onRename(point, trimmed);
    setEditingName(false);
  };
  const stop = (e) => e.stopPropagation();
  // Round 47 Hide: a data column renders only when it's in the visible set (the
  // name cell + leading track are never hideable). Undefined ⇒ show everything.
  const showCol = (k) => !columns || columns.includes(k);

  // Whole-row drag (native monday feel): the sortable listeners/attributes ride
  // on the ROW itself when the point is editable — no six-dot grip. The
  // PointerSensor's activation distance (TopicsTab) keeps a plain click editing
  // the cell; interactive cells stopPropagation so their clicks don't start a drag.
  const dragProps = canEditPoint ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.row} ${excluded ? styles.excluded : ''} ${failed ? styles.rowFailed : ''} ${canEditPoint ? styles.rowDraggable : ''}`}
      {...dragProps}
    >
      {/* LEADING CELL — a clean selection checkbox carrying the topic color strip
          (inset 6px), the frozen/leading element (mirrors TaskTable's `.selectCell`).
          Off selection mode it's just the bare accent strip. The hide/delete
          controls moved out to the name cell (hover), so this stays uncluttered. */}
      <div className={styles.lead} aria-hidden={selectable ? undefined : true}>
        {selectable && (
          <span className={styles.leadSelect} onClick={stop} onPointerDown={stop}>
            <Checkbox
              checked={selected}
              onChange={(e) => onToggleSelect?.(point, e.target.checked)}
              ariaLabel={`בחר נקודה ${point.name}`}
            />
          </span>
        )}
      </div>

      {/* נקודה לדיון — start-aligned name; hover-revealed hide(eye) + delete like
          the Tasks name cell; the "updates" chat-bubble icon pinned to the trailing
          edge (same size/placement as Tasks). */}
      <div className={styles.nameCell}>
        {editingName ? (
          <input
            className={styles.nameEditInput}
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onClick={stop}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); savePointName(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingName(false); setNameDraft(point.name || ''); }
            }}
            onBlur={savePointName}
            aria-label="ערוך שם נקודה"
          />
        ) : (
          <span
            className={styles.name}
            title={point.name}
            onDoubleClick={canEditPoint ? () => { setNameDraft(point.name || ''); setEditingName(true); } : undefined}
          >
            {point.name}
          </span>
        )}
        {/* Hover rename pencil — the same inline rename as double-clicking the
            name, made explicit + discoverable (mirrors the tasks pencil). */}
        {canEditPoint && !editingName && (
          <button
            type="button"
            className={styles.renameBtn}
            title="עריכת שם"
            aria-label={`ערוך שם נקודה: ${point.name}`}
            onClick={(e) => { e.stopPropagation(); setNameDraft(point.name || ''); setEditingName(true); }}
          >
            <Edit size={16} />
          </button>
        )}
        {failed && (
          <span className={styles.createFailedActions} onClick={stop} onPointerDown={stop}>
            <span className={styles.createFailedText}>שמירה נכשלה</span>
            {onRetryCreate && (
              <button
                type="button"
                className={styles.retryBtn}
                onClick={(e) => { e.stopPropagation(); onRetryCreate(point.id); }}
              >
                נסה שוב
              </button>
            )}
          </span>
        )}
        {/* Secondary controls revealed on ROW HOVER (mirrors the Tasks name cell's
            hover trash) — no longer a persistent kebab. hide(eye) toggles the
            not-for-discussion flag; delete uses an inline confirm. Both
            stopPropagation so a click never starts a whole-row drag. */}
        {canEditPoint && (
          <button
            type="button"
            className={styles.hideBtn}
            onClick={(e) => { e.stopPropagation(); onToggleNotForDiscussion?.(point, !excluded); }}
            aria-label={excluded ? 'הצג נקודה' : 'הסתר נקודה'}
            title={excluded ? 'הצג נקודה' : 'הסתר נקודה'}
          >
            {excluded ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}
        {/* monday "updates" speech-bubble icon at the trailing edge of the name
            cell — identical affordance to the Tasks name cell (opens the point's
            item card on the Updates pane). */}
        <button
          type="button"
          className={styles.updatesBtn}
          title="עדכונים"
          aria-label="פתח עדכונים"
          onClick={(e) => { e.stopPropagation(); openItemCard(point.id); }}
        >
          <Update size={18} />
        </button>
        {/* Creator avatar (round 58) — the point creator's avatar, revealed only
            on row hover and pinned just LEFT of the updates bubble (it's the last
            child, so leftmost in this RTL name cell). Rendered only when the point
            has a recorded creator (point.creatorId); points without one show
            nothing, at rest or on hover. */}
        {point.creatorId && (
          <span className={styles.creatorAvatar}>
            <CreatorAvatar userId={point.creatorId} usersById={usersById} size="small" />
          </span>
        )}
      </div>

      {/* האם נידונה — checkbox (round 47: hideable via the columns set) */}
      {showCol('check') && (
        <div className={styles.checkCell} onClick={stop}>
          <button
            type="button"
            className={`${styles.check} ${discussed ? styles.checkOn : ''}`}
            onClick={canCheck ? () => onToggle?.(point, !discussed) : undefined}
            aria-label={discussed ? 'נידונה' : 'לא נידונה'}
            aria-disabled={!canCheck}
            title={discussed ? 'נידונה' : 'סמן כנידונה'}
          >
            {discussed && <Check size={13} className={styles.checkMark} />}
          </button>
        </div>
      )}

      {/* החלטות — dashed create + counter pill (round 47: hideable) */}
      {showCol('decisions') && (
        <div className={`${styles.linkCell} ${styles.decisionsCell}`} onClick={stop}>
          {onCreateDecision && (
            <button
              type="button"
              className={`${styles.createBtn} ${styles.createDecision}`}
              title="החלטה חדשה"
              aria-label="החלטה חדשה מהנקודה"
              onClick={() => onCreateDecision(point)}
            >
              +
            </button>
          )}
          <button
            type="button"
            className={`${styles.counter} ${decisionCount > 0 ? styles.counterDecisionOn : ''}`}
            title="הצג החלטות"
            aria-label="הצג החלטות מהנקודה"
            onClick={() => onOpenDecisions?.(point)}
          >
            {decisionCount}
          </button>
          <CreateProgressBar status={decisionCreateStatus} variant="decision" />
        </div>
      )}

      {/* משימות — dashed create + counter pill (round 47: hideable) */}
      {showCol('tasks') && (
        <div className={`${styles.linkCell} ${styles.tasksCell}`} onClick={stop}>
          {onCreateTask && (
            <button
              type="button"
              className={`${styles.createBtn} ${styles.createTask}`}
              title="משימה חדשה"
              aria-label="משימה חדשה מהנקודה"
              onClick={() => onCreateTask(point)}
            >
              +
            </button>
          )}
          <button
            type="button"
            className={`${styles.counter} ${taskCount > 0 ? styles.counterTaskOn : ''}`}
            title="הצג משימות"
            aria-label="הצג משימות מהנקודה"
            onClick={() => onOpenTasks?.(point)}
          >
            {taskCount}
          </button>
          <CreateProgressBar status={taskCreateStatus} variant="task" />
        </div>
      )}
    </div>
  );
}

export default TopicPointRow;

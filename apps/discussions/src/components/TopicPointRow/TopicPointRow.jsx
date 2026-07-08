import React, { useState } from 'react';
import { Avatar, Dialog, DialogContentContainer } from '@vibe/core';
import { GripVertical, Trash2, EyeOff, Eye, MoreHorizontal, Check } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './TopicPointRow.module.css';

function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

/* Creator avatar (who created the topic / point). Resolves the user from the
   shared usersById map (populated by useUsers in TopicsTab); falls back to a
   neutral placeholder while the photo/name is still loading or unset. Still
   used by the topic GROUP HEADER (TopicsTab) — the per-point avatar column was
   removed from the table in the decisions redesign. */
export function CreatorAvatar({ userId, usersById, size = 'small' }) {
  if (!userId) return <span className={styles.avatarEmpty} aria-hidden="true" />;
  const user = usersById?.[String(userId)];
  return (
    <Avatar
      size={size}
      src={user?.photo_thumb}
      text={initialsOf(user?.name)}
      type={user?.photo_thumb ? 'img' : 'text'}
      ariaLabel={user?.name || 'יוצר'}
    />
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
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => { onToggleHide?.(); close(); }}
              >
                {excluded ? <Eye size={15} /> : <EyeOff size={15} />}
                {excluded ? 'הצג' : 'הסתר'}
              </button>
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
 * (decisions redesign — FIXED columns):
 *   [accent bar 28px] | נקודה לדיון (flex) | נידונה 66px | החלטות 168px | משימות 168px
 * "נידונה" (discussed) persists to the subitems board when pointCheckedID is
 * mapped (app-local storage fallback otherwise — handled in useTopics).
 * החלטות/משימות cells: a dashed "+" (create a decision/task FROM this point —
 * rendered only when the create callback is provided, so the parent gates it by
 * capability) and a round counter pill (filled when >0) that opens the
 * PointItemsPopup. The kebab (hide/delete) + drag grip moved INTO the name cell
 * (hover-revealed) — the lead column is now the bare accent bar per the mockup.
 */
export function TopicPointRow({
  point, rowStyle,
  // Kept for signature compatibility (the per-point creator avatar column was
  // removed from the table; the read/write path in useTopics stays intact).
  usersById, // eslint-disable-line no-unused-vars
  onToggle, onToggleNotForDiscussion, onRename, onDelete,
  // Granular discussion-tier caps. Each equals the legacy canEdit while the
  // permissions feature is off, so behavior is unchanged. point edit (rename +
  // drag), delete (kebab delete + hide), check ("נידונה" toggle).
  canEditPoint = true, canDelete = true, canCheck = true,
  // Decisions/tasks link counters (linked ids length, from pointDecisionsLinkID /
  // pointTasksLinkID; 0 when the columns are unmapped).
  decisionCount = 0, taskCount = 0,
  // Create-from-point + open-counter-popup callbacks (threaded by TopicsTab).
  onCreateDecision, onCreateTask, onOpenDecisions, onOpenTasks,
}) {
  const discussed = point.discussed === true;
  const excluded = point.notForDiscussion === true;
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

  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${excluded ? styles.excluded : ''}`}>
      {/* accent bar (28px lead column) */}
      <span className={styles.lead} aria-hidden="true" />

      {/* נקודה לדיון — hover controls (kebab + grip) + name (double-click to rename) */}
      <div className={styles.nameCell}>
        {(canEditPoint || canDelete) && (
          <span className={styles.rowControls} onClick={stop}>
            <RowKebabMenu
              excluded={excluded}
              kind="נקודה"
              onToggleHide={canEditPoint ? () => onToggleNotForDiscussion?.(point, !excluded) : undefined}
              onDelete={canDelete && onDelete ? () => onDelete(point) : undefined}
            />
            {canEditPoint && (
              <button type="button" className={styles.grip} {...attributes} {...listeners} aria-label="גרור לסידור">
                <GripVertical size={14} />
              </button>
            )}
          </span>
        )}
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
      </div>

      {/* האם נידונה — checkbox */}
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

      {/* החלטות — dashed create + counter pill (opens the popup) */}
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
      </div>

      {/* משימות — dashed create + counter pill (opens the popup) */}
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
      </div>
    </div>
  );
}

export default TopicPointRow;

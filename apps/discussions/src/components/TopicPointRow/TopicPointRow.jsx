import React, { useState } from 'react';
import { Avatar, Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { Trash2, EyeOff, Eye, MoreHorizontal, Check, GripVertical, Plus } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CreateProgressBar } from '@generated/components/CreateProgressBar';
import styles from './TopicPointRow.module.css';

function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

/* Creator avatar (who created the topic / point). Resolves the user from the
   shared usersById map (populated by useUsers in TopicsTab); falls back to a
   neutral placeholder while the photo/name is still loading or unset. Also
   used by the topic CARD HEADER (TopicsTab). */
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

/* Hover-revealed 3-dot menu (kebab) for a topic card header or a point row.
   Opens a small Dialog with "הסתר/הצג" (toggles the not-for-discussion board
   checkbox) and "מחק" (inline-confirm). Shared by the card header + point row so
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
        // round194 — anchor the popup by its END edge so the delete box lines up
        // with the title's edge below it instead of overhanging past it.
        position="bottom-end"
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
 * A discussion POINT = a subitem, rendered as a CLEAN LIST ROW inside its topic
 * card (round226 stage B — approved mockup): no table grid, no column header,
 * no cell borders. RTL row order (dir=rtl cascades from the topic card):
 *   [select ☐] [נידונה ✓] [name (flex)] [action cluster] [flex spacer]
 * round260 (owner request) — the action cluster sits in the MIDDLE of the row
 * (the trailing flex spacer balances the name's flex:1). Cluster order, right →
 * left: [+ create] [count] [creator] [delete]. The pencil (edit) and eye (hide)
 * buttons were removed — a single click on the name enters inline edit.
 *
 * "נידונה" (discussed) is a leading rounded-square check — green fill + white ✓
 * when checked, and the name gets a line-through (mockup .pt.done). It persists
 * to the subitems board when pointCheckedID is mapped (app-local storage
 * fallback otherwise — handled in useTopics).
 *
 * The תוצרים controls (unified, round226/260): a "+" that is ALWAYS visible and
 * opens the ONE create box, and a count pill (tasks+decisions, shown only when
 * >0) that opens the combined popup. Creator avatar + delete stay hover-revealed.
 *
 * DRAG-TO-REORDER: the WHOLE ROW is the drag handle (native monday board feel).
 * dnd-kit's PointerSensor activation distance (set in TopicsTab, ~8px) means a
 * small press-move starts a drag while a plain click still edits the cell.
 * Interactive controls call stopPropagation so their clicks never start a drag.
 */
export function TopicPointRow({
  point,
  // Per-point creator avatar (round 58): revealed on row hover inside the
  // actions cluster. Resolved from usersById via point.creatorId.
  usersById,
  onToggle, onRename,
  // round232 (owner request) — per-point DELETE: a hover trash button to the
  // LEFT of the creator avatar (replaces the multi-select-checkbox delete path).
  // Soft-delete with an undo toast lives in the parent; omitted ⇒ no trash.
  onDelete,
  // Optimistic-create error affordance: retry re-runs a failed point create.
  onRetryCreate,
  // Granular discussion-tier caps. Each equals the legacy canEdit while the
  // permissions feature is off, so behavior is unchanged. point edit (rename via
  // click-the-text + drag-grip reorder), check ("נידונה" toggle). round260 —
  // per-point hide was removed, so canHidePoint no longer exists.
  canEditPoint = true, canCheck = true,
  // Unified תוצרים counters (stored ids ∩ loaded items; 0 when unmapped).
  decisionCount = 0, taskCount = 0,
  // Create-from-point + open-counter-popup callbacks (threaded by TopicsTab).
  onCreateDecision, onCreateTask, onOpenDecisions, onOpenTasks,
  // Visible column keys (round 47 Hide) from TopicsTab — 'name' is always shown;
  // check/outputs render only when present. Undefined ⇒ everything shows.
  columns,
  // Multi-select (Round 7) — the selection checkbox is hover-revealed; it stays
  // visible while selected or while ANY selection is active (selectionActive).
  selectable = false, selected = false, onToggleSelect, selectionActive = false,
  // Round 52 — per-point create-from-point progress ('pending' | 'success' |
  // 'error' | undefined); drives the inline CreateProgressBar overlay on the
  // תוצרים cluster (threaded from DiscussionCard's handleQuickCreate).
  decisionCreateStatus, taskCreateStatus,
}) {
  const discussed = point.discussed === true;
  const excluded = point.notForDiscussion === true;
  // Item 11: a HIDDEN point is fully inert — no rename/drag/check/create/open —
  // so nothing can be done "through" a hidden row. The ONLY live controls are
  // the eye (to re-show it) and the selection checkbox (bulk actions).
  const inert = excluded;
  // Background create failed: keep the point + show a clear error + retry.
  const failed = point._createFailed === true;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(point.name || '');

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(point.id) });
  const style = {
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
  // Round 47 Hide: a column key renders only when it's in the visible set (the
  // name is never hideable). Undefined ⇒ show everything.
  const showCol = (k) => !columns || columns.includes(k);

  // round233 (owner request) — drag is initiated by an explicit SIX-DOT GRIP at
  // the row's leading (right, in RTL) edge, not the whole row. The sortable node
  // is still the row (setNodeRef); only the listeners/attributes move to the grip.
  const dragProps = canEditPoint && !inert ? { ...attributes, ...listeners } : {};

  const rowClass = [
    styles.row,
    discussed ? styles.rowDone : '',
    excluded ? styles.excluded : '',
    failed ? styles.rowFailed : '',
    selectionActive ? styles.rowSelecting : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={setNodeRef} style={style} className={rowClass}>
      {/* round233 — six-dot drag grip at the RIGHT (leading, rtl) edge; hold and
          drag to reorder the point up/down. Hover-revealed, grab cursor. */}
      {canEditPoint && !inert && (
        <span
          className={styles.dragGrip}
          title="גרירה לשינוי סדר"
          aria-label={`גרירה לשינוי סדר הנקודה: ${point.name}`}
          {...dragProps}
        >
          <GripVertical size={16} />
        </span>
      )}
      {/* Selection checkbox — hover-revealed (kept visible while selected /
          while a selection is active anywhere), so the clean list stays quiet
          at rest but multi-select keeps working exactly as before. */}
      {selectable && (
        <span
          className={`${styles.selCell} ${selected ? styles.selCellOn : ''}`}
          onClick={stop}
          onPointerDown={stop}
        >
          <Checkbox
            checked={selected}
            onChange={(e) => onToggleSelect?.(point, e.target.checked)}
            ariaLabel={`בחר נקודה ${point.name}`}
          />
        </span>
      )}

      {/* נידונה — leading rounded-square check (mockup .chk): empty bordered box
          at rest (faint ✓ hint on hover), green fill + white ✓ when discussed.
          Disabled on a hidden row (item 11) / without the cap. */}
      {showCol('check') && (
        <span className={styles.checkCell} onClick={stop} onPointerDown={stop}>
          <button
            type="button"
            className={`${styles.chk} ${discussed ? styles.chkOn : ''}`}
            onClick={canCheck && !inert ? () => onToggle?.(point, !discussed) : undefined}
            disabled={!canCheck || inert}
            aria-pressed={discussed}
            aria-label={discussed ? 'נידונה — בטל סימון' : 'סמן כנידונה'}
            title={discussed ? 'נידונה' : 'סמן כנידונה'}
          >
            <Check size={11} className={styles.chkGlyph} strokeWidth={3.5} />
          </button>
        </span>
      )}

      {/* Point name — fills the row; double-click (or the hover pencil) renames;
          line-through + dimmed when discussed (mockup .pt.done). */}
      <span className={styles.nameCell}>
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
            // round260 (owner request) — the pencil button was removed; a single
            // CLICK on the point text now enters edit mode ("no need for a pencil").
            role={canEditPoint && !inert ? 'button' : undefined}
            style={canEditPoint && !inert ? { cursor: 'text' } : undefined}
            onClick={canEditPoint && !inert ? (e) => { e.stopPropagation(); setNameDraft(point.name || ''); setEditingName(true); } : undefined}
          >
            {point.name}
          </span>
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
      </span>

      {/* round260/261 — a single centered cluster. RTL order (right → left):
          [+ create] [count] [creator] [delete]. round261 (owner request) — every
          slot has a FIXED reserved width so the "+" sits at the SAME position in
          every row whether or not a count/creator exists (symmetric). The "+" is
          always visible; the count shows only when >0 (inside its reserved slot);
          creator + delete stay hover-revealed. Icons are rounded-squares. A
          trailing flex spacer balances the name (flex:1) so the cluster sits in
          the MIDDLE of the row, close to the point text. */}
      <span className={styles.pointCluster} onClick={stop} onPointerDown={stop}>
        {(showCol('outputs') || showCol('decisions') || showCol('tasks')) && (
          <>
            {(onCreateTask || onCreateDecision) && (
              <button
                type="button"
                className={styles.outAdd}
                title="תוצר חדש (משימה או החלטה)"
                aria-label="תוצר חדש מהנקודה"
                disabled={inert}
                onClick={(e) => (onCreateTask || onCreateDecision)(point, e.currentTarget.getBoundingClientRect())}
              >
                <Plus size={17} strokeWidth={2.5} />
              </button>
            )}
            {/* count slot — ALWAYS reserved (empty when 0) so the + never shifts. */}
            <span className={styles.countSlot}>
              {(taskCount + decisionCount) > 0 && (
                <button
                  type="button"
                  className={styles.outCount}
                  title={`${taskCount} משימות · ${decisionCount} החלטות`}
                  aria-label="הצג תוצרים מהנקודה"
                  disabled={inert}
                  onClick={() => (onOpenTasks || onOpenDecisions)?.(point)}
                >
                  {taskCount + decisionCount}
                </button>
              )}
            </span>
          </>
        )}
        {/* creator slot — reserved width, hover-revealed (order: after the count). */}
        <span className={`${styles.creatorSlot} ${styles.hoverOnly}`}>
          {point.creatorId && (
            <span className={styles.creatorAvatar}>
              <CreatorAvatar userId={point.creatorId} usersById={usersById} size="small" />
            </span>
          )}
        </span>
        {/* delete slot — reserved width, leftmost. Soft-delete + undo lives in the
            parent. Inert on a hidden row. */}
        <span className={styles.deleteSlot}>
          {onDelete && !inert && (
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.deleteBtn} ${styles.hoverOnly}`}
              title="מחיקת נקודה"
              aria-label={`מחק נקודה: ${point.name}`}
              onClick={(e) => { e.stopPropagation(); onDelete(point); }}
            >
              <Trash2 size={17} />
            </button>
          )}
        </span>
        <CreateProgressBar status={taskCreateStatus || decisionCreateStatus} variant={taskCreateStatus ? 'task' : 'decision'} />
      </span>

      {/* round260 — flex spacer: balances .nameCell (flex:1) so the action
          cluster is centered between the row's two edges (approved mockup). */}
      <span className={styles.clusterSpacer} aria-hidden="true" />
    </div>
  );
}

export default TopicPointRow;

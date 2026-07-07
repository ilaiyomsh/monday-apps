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
   neutral placeholder while the photo/name is still loading or unset. */
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
 * to the group's column header via the shared `rowStyle` grid template:
 *   [kebab/grip] | נקודה לדיון | נידונה (checkbox) | התייחסויות (inline text) | avatar
 * "נידונה" (discussed) and "התייחסויות" persist to the subitems board (when their
 * columns are mapped). "הסתרה" toggles the not-for-discussion board flag (dims the
 * row + excludes it from the export). Drag grip reorders points within the topic.
 */
export function TopicPointRow({
  point, usersById, rowStyle,
  // Ordered column keys from TopicsTab's shared column order — cells render in
  // this order so drag-reordered headers and rows can never drift apart.
  columns = ['lead', 'name', 'check', 'avatar'],
  onToggle, onToggleNotForDiscussion, onRename, onDelete,
  // Granular discussion-tier caps. Each equals the legacy canEdit while the
  // permissions feature is off, so behavior is unchanged. point edit (rename +
  // drag), delete (kebab delete + hide), check ("נידונה" toggle).
  canEditPoint = true, canDelete = true, canCheck = true,
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

  // Cells keyed by column id, rendered in the shared `columns` order below.
  const CELLS = {
    // leading zone: hover kebab + drag grip
    lead: (
      <div key="lead" className={styles.lead} onClick={stop}>
        {(canEditPoint || canDelete) && (
          <RowKebabMenu
            excluded={excluded}
            kind="נקודה"
            onToggleHide={canEditPoint ? () => onToggleNotForDiscussion?.(point, !excluded) : undefined}
            onDelete={canDelete && onDelete ? () => onDelete(point) : undefined}
          />
        )}
        {canEditPoint && (
          <button type="button" className={styles.grip} {...attributes} {...listeners} aria-label="גרור לסידור">
            <GripVertical size={14} />
          </button>
        )}
      </div>
    ),
    // נקודה לדיון — name (double-click to rename)
    name: (
      <div key="name" className={styles.nameCell}>
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
    ),
    // האם נידונה — checkbox
    check: (
      <div key="check" className={styles.checkCell} onClick={stop}>
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
    ),
    // creator avatar
    avatar: (
      <div key="avatar" className={styles.avatarCell}>
        <CreatorAvatar userId={point.creatorId} usersById={usersById} />
      </div>
    ),
  };

  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${excluded ? styles.excluded : ''}`}>
      {columns.map((key) => CELLS[key] ?? null)}
    </div>
  );
}

export default TopicPointRow;

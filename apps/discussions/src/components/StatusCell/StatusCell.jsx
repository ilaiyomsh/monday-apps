import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer } from '@vibe/core';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { GRAY_DEFAULT_LABEL_ID } from '@generated/constants/statusConfig';
import styles from '../TaskTableRow/TaskTableRow.module.css';

/*
 * round373 — THE status cell, shared by the built-in status column, the priority
 * column and every owner-added custom status column.
 *
 * It exists because the custom status column shipped in round372 as its own
 * markup and immediately looked wrong: a rounded chip floating inside a padded
 * cell (white edges on all four sides) with a fixed 206px picker that opened
 * wider than the column it belonged to. The fix is not "copy the base styles
 * over" — that is exactly how the two drifted apart. One component renders all
 * three, so they cannot drift again.
 *
 * What "looks like monday" means here, concretely:
 *   - the fill is EDGE-TO-EDGE: the cell has no padding, the trigger stretches to
 *     100% of it, and the fill stretches to 100% of the trigger. Any of the three
 *     missing puts white back on that edge.
 *   - the picker's width is MEASURED off the trigger (+20 for the card's 10px
 *     side padding), never a constant — so the labels open exactly as wide as the
 *     column, at whatever width the owner dragged it to.
 *   - it flips above the trigger near the viewport bottom (computeFloatingPosition),
 *     rather than opening off-screen.
 *
 * A label id of 0 is a REAL label, so `value` is tested for null-ness, never for
 * truthiness — `isSet` is the single place that decision is made.
 *
 * There is deliberately NO "clear" TEXT row (round374, owner decision reversing
 * round373's addition). monday's own status column cannot be emptied from a cell
 * either: the gray DEFAULT label is what "not set yet" looks like, and the app
 * renders that same gray label for an empty value via `emptyLabel`. A row reading
 * "נקה" made the app's picker differ from every monday board the owner knows.
 *
 * round377 — instead, the picker always offers the gray default AS A LABEL, even
 * when it carries no text. EVERY status column in monday offers one (owner, and
 * monday's own picker: the gray swatch is how a cell goes back to unset), so this
 * picker must too — a column where it is missing is a bug in this app, not a
 * property of that column.
 *
 * The catch is that it is not always in the DATA. `settings.labels` serializes
 * only the labels someone defined; the gray unset state is implicit and is absent
 * from the payload whenever nobody wrote text on id 5 — this account's "בדיקה"
 * (ids 0/1/2/3) and "עדיפות" (7/10/109/110) both come back without it. Reading
 * the payload as the whole truth is what made this pill conditional in the first
 * place. So the app SUPPLIES the gray pill, and skips it only when id 5 is
 * already in `options` with text of its own — there the column's own gray label
 * IS the pill, at its own display position, and adding a second would show two.
 *
 * The app-supplied one writes NULL, never id 5: that label does not exist on the
 * column, so writing it would be rejected, and an empty value is already what the
 * cell renders as the gray face. What you pick is what the cell shows.
 */

const NEUTRAL = 'hsl(var(--status-default))';

export function StatusCell({
  value,
  options = [],
  labelById = {},
  colorById = {},
  emptyLabel = '',
  onChange,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom');
  const [menuWidth, setMenuWidth] = useState(206);
  const triggerRef = useRef(null);

  const isSet = value != null && value !== '' && labelById[value] != null;
  const label = isSet ? labelById[value] : null;
  const fill = isSet ? (colorById[value] || NEUTRAL) : null;

  const face = isSet
    ? <span className={styles.statusFill} style={{ background: fill }}>{label}</span>
    : <span className={styles.statusEmpty}>{emptyLabel}</span>;

  // The column's own gray default, if it has one — then the app adds none.
  const hasOwnGrayDefault = options.some((o) => o.id === GRAY_DEFAULT_LABEL_ID);

  if (!onChange) return face;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.round(rect.width);
    setMenuWidth(w);
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: w,
      popupHeight: Math.max(180, options.length * 40 + 28),
      offset: 4,
    });
    // Centered variant: keep only the vertical (bottom/top); @vibe centers it.
    if (next?.placement) setPosition(next.placement.startsWith('top') ? 'top' : 'bottom');
  };

  return (
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
          <div className={styles.statusMenu} style={{ width: menuWidth + 20 }}>
            {options.length === 0 && <div className={styles.relEmpty}>אין תוויות בעמודה זו</div>}
            {!hasOwnGrayDefault && (
              <button
                type="button"
                className={styles.statusOption}
                style={{ background: 'hsl(var(--status-default, 0 0% 77%))' }}
                aria-label={emptyLabel || 'ללא סטאטוס'}
                title={emptyLabel || 'ללא סטאטוס'}
                onClick={() => { onChange(null); setOpen(false); }}
              >
                {emptyLabel}
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.statusOption}
                style={{ background: opt.color || NEUTRAL }}
                onClick={() => { onChange(opt.id); setOpen(false); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.statusTrigger}
        onMouseDown={updatePosition}
        aria-label={ariaLabel}
      >
        {face}
      </button>
    </Dialog>
  );
}

export default StatusCell;

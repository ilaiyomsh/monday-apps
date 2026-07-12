import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContentContainer, DatePicker, Button } from '@vibe/core';
import { Calendar } from '@vibe/icons';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './DatePickerPopover.module.css';

// Parse a manually-typed date (round 47 top-of-popover input). Primary format is
// DD/MM/YYYY (matches the cells' toLocaleDateString('en-GB')), but we're lenient:
// any of / . - or whitespace separate the parts, a 2-digit year maps into
// 2000–2069 / 1970–1999, and a missing year defaults to the current year. Returns
// a local Date at midnight, or null when the input can't be parsed to a REAL
// calendar date (e.g. 31/02 is rejected — no silent JS Date overflow).
// Exported for unit tests.
export function parseTypedDate(str) {
  if (str == null) return null;
  const parts = String(str).trim().split(/[\s./-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  let year;
  if (parts.length === 3) {
    year = Number(parts[2]);
    if (!Number.isInteger(year)) return null;
    if (parts[2].length <= 2) year += year < 70 ? 2000 : 1900;
  } else {
    year = new Date().getFullYear();
  }
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Reject impossible dates that JS would silently roll over (e.g. 31/02 → Mar 3).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/*
 * Shared date picker (the @vibe DatePicker in an anchored Dialog) used by the
 * task tables AND the create modals, so the calendar looks identical everywhere.
 * Footer = two actions: היום (today) + ניקוי (clear).
 *
 * variant:
 *   'cell'  (default) — borderless trigger for table cells: date text, or a
 *                       lone calendar icon when empty.
 *   'field' — a bordered 40px form-field trigger (date text or `placeholder`
 *             + a trailing calendar icon) for use inside modals.
 *   'inline' — a bare text trigger that inherits the surrounding typography
 *              (no overdue coloring, no icon) — used by the discussion header.
 *
 * formatDate — optional Date→string formatter for the trigger text (defaults
 *              to DD/MM/YYYY). triggerClassName lets the consumer style the
 *              trigger. allowClear=false hides the ניקוי footer action (for
 *              required fields like the discussion date).
 */
export function DatePickerPopover({ value, onChange, variant = 'cell', placeholder = 'בחר תאריך', zIndex = 10000, formatDate, triggerClassName = '', allowClear = true }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom-start');
  // Manual date-entry field at the TOP of the popover (round 47): `typed` is its
  // controlled text; `invalid` flags an unparseable commit (subtle red border).
  const [typed, setTyped] = useState('');
  const [invalid, setInvalid] = useState(false);
  const triggerRef = useRef(null);
  const isField = variant === 'field';
  const isInline = variant === 'inline';
  // Defense-in-depth: tolerate a non-Date `value`. A real Date passes through
  // UNTOUCHED (its `hasTime` flag stays intact for other consumers); a string /
  // number (e.g. a date that reached us as an ISO string) is revived; anything
  // unparseable becomes null and renders as empty. The primary fix reconstructs
  // Dates in the view cache — this just guarantees the SHARED picker (used by
  // every date cell + modal) can never throw ".toLocaleDateString is not a
  // function" on a stray value.
  const safeValue = value == null
    ? null
    : value instanceof Date
      ? value
      : (() => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; })();
  const fmt = formatDate || ((d) => d.toLocaleDateString('en-GB') /* DD/MM/YYYY */);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: 320,
      // Includes the round-47 manual-entry row (~42px) on top of the calendar so
      // placement/flip still clears the viewport edge (keeps the round-31 fix).
      popupHeight: 430,
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  const handleSelect = (date) => {
    onChange(date || null);
    setOpen(false);
  };
  const selectToday = () => {
    const n = new Date();
    handleSelect(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
  };
  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  // Keep the manual-entry field in sync with the committed value: reset it to the
  // canonical DD/MM/YYYY whenever the popover OPENS or the committed date changes
  // (e.g. after a calendar pick), and clear any stale invalid flag. Keyed on the
  // value's TIME (not the Date object) so ordinary re-renders never clobber what
  // the user is typing.
  const valueTime = safeValue ? safeValue.getTime() : null;
  useEffect(() => {
    if (!open) return;
    setTyped(safeValue ? safeValue.toLocaleDateString('en-GB') : '');
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, valueTime]);

  // Commit the typed text. Enter commits via the calendar's OWN path (handleSelect
  // → set + close); blur commits WITHOUT closing (focus may be moving into the
  // calendar) and only when the value actually changed, so it never fires a
  // redundant write. An empty field is a no-op (normalized back to the current
  // value); unparseable input flags the subtle invalid state and never commits.
  // Esc is handled by the Dialog (hideTrigger 'esc'), which cancels + closes.
  const commitTyped = ({ close }) => {
    const raw = typed.trim();
    if (!raw) {
      setTyped(safeValue ? safeValue.toLocaleDateString('en-GB') : '');
      setInvalid(false);
      return;
    }
    const parsed = parseTypedDate(raw);
    if (!parsed) { setInvalid(true); return; }
    setInvalid(false);
    if (close) {
      handleSelect(parsed);
    } else if (!safeValue || parsed.getTime() !== safeValue.getTime()) {
      onChange(parsed);
    }
  };

  const isOverdue = safeValue && safeValue < new Date();
  const triggerClass = isInline
    ? `${styles.trigger} ${styles.inlineTrigger} ${triggerClassName}`
    : isField
      ? `${styles.trigger} ${styles.fieldTrigger} ${safeValue ? styles.set : styles.empty} ${triggerClassName}`
      : `${styles.trigger} ${safeValue ? (isOverdue ? styles.overdue : styles.set) : styles.empty} ${triggerClassName}`;

  return (
    <Dialog
      // Fully control visibility from `open` via useDerivedStateFromProps +
      // isOpen. Vibe's Dialog computes "shown" as (internalState || openProp),
      // so the plain `open` prop can only force-OPEN — setting it false never
      // closed the dialog once a trigger click had set the internal state true.
      // That's why the picker lingered after choosing a date (handleSelect set
      // open=false but the internal state stayed true). Deriving from isOpen
      // makes `open`/false actually close it. We deliberately do NOT add
      // 'onContentClick' to hideTrigger: that would also close on the month
      // nav-arrow clicks inside the calendar. Instead handleSelect/clear/today
      // set open=false, closing right after the selection commits — for ALL
      // date pickers, since this is the shared component.
      isOpen={open}
      useDerivedStateFromProps
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }}
      onDialogDidHide={() => setOpen(false)}
      position={position}
      zIndex={zIndex}
      content={() => (
        <DialogContentContainer>
          {/* Manual date entry (round 47) — a typeable DD/MM/YYYY field at the TOP
              of the popover (monday-style), above the calendar. LTR so the numeric
              date reads naturally in the RTL app. Enter/blur commit a valid parse
              (the calendar below reflects it); Esc cancels via the Dialog. */}
          <div className={styles.typeRow}>
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              className={`${styles.typeInput}${invalid ? ` ${styles.typeInvalid}` : ''}`}
              value={typed}
              placeholder="DD/MM/YYYY"
              aria-label="הקלדת תאריך"
              aria-invalid={invalid || undefined}
              onChange={(e) => { setTyped(e.target.value); if (invalid) setInvalid(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTyped({ close: true }); } }}
              onBlur={() => commitTyped({ close: false })}
            />
          </div>
          <DatePicker mode="single" date={safeValue || undefined} onDateChange={handleSelect} />
          <div className={styles.actions}>
            <Button kind="tertiary" size="small" onClick={selectToday}>היום</Button>
            {allowClear && <Button kind="tertiary" size="small" onClick={clear}>ניקוי</Button>}
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-label={safeValue ? undefined : placeholder}
        onMouseDown={updatePosition}
      >
        {isField ? (
          <>
            <span className={styles.fieldText}>
              {safeValue ? fmt(safeValue) : placeholder}
            </span>
            <Calendar size={16} />
          </>
        ) : isInline ? (
          <span>{safeValue ? fmt(safeValue) : placeholder}</span>
        ) : safeValue ? (
          <span>{fmt(safeValue)}</span>
        ) : (
          <Calendar size={16} />
        )}
      </button>
    </Dialog>
  );
}

export default DatePickerPopover;

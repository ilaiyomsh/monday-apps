import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContentContainer, DatePicker, Button } from '@vibe/core';
import { AddSmall, Calendar } from '@vibe/icons';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { acceptSegmentInput, segmentsToTyped, dateToSegments } from './dateSegments.js';
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
  // Manual date-entry (round 47, segmented since round 71): three DD/MM/YY
  // digit boxes with the slashes ALWAYS visible between them; `invalid` flags
  // an unparseable commit (subtle red border on the group).
  const [segs, setSegs] = useState({ dd: '', mm: '', yy: '' });
  const [invalid, setInvalid] = useState(false);
  const triggerRef = useRef(null);
  const ddRef = useRef(null);
  const mmRef = useRef(null);
  const yyRef = useRef(null);
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
      // round132 compact popover (smaller day cells + tighter paddings): the
      // estimates must track .pickerBox or the flip logic misjudges the edges.
      popupWidth: 280,
      // Includes the round-47 manual-entry row (~40px) on top of the calendar so
      // placement/flip still clears the viewport edge (keeps the round-31 fix).
      popupHeight: 360,
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

  // Keep the segment boxes in sync with the committed value: reset them to the
  // canonical DD/MM/YY whenever the popover OPENS or the committed date changes
  // (e.g. after a calendar pick), and clear any stale invalid flag. Keyed on the
  // value's TIME (not the Date object) so ordinary re-renders never clobber what
  // the user is typing.
  const valueTime = safeValue ? safeValue.getTime() : null;
  useEffect(() => {
    if (!open) return;
    setSegs(dateToSegments(safeValue));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, valueTime]);

  // Commit the segment values. Enter commits via the calendar's OWN path
  // (handleSelect → set + close); blur/auto-fill commit WITHOUT closing (focus
  // may be moving into the calendar) and only when the value actually changed,
  // so it never fires a redundant write. Empty day+month is a no-op (normalized
  // back to the current value); an unparseable combination flags the subtle
  // invalid state and never commits. A missing year defaults to the current
  // year (parseTypedDate). Esc is handled by the Dialog (hideTrigger 'esc').
  const commitSegs = (s, { close }) => {
    const raw = segmentsToTyped(s);
    if (!raw) {
      setSegs(dateToSegments(safeValue));
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

  // Segment plumbing: typing digits fills the focused box; a full (or
  // unambiguous zero-padded) box auto-advances to the next; filling the year
  // commits immediately (without closing, so the calendar reflects it).
  // Backspace on an empty box hops back; '/' skips forward (the slashes are
  // static text — typing one just moves to the next box, monday-style).
  const SEG_ORDER = ['dd', 'mm', 'yy'];
  const segRefs = { dd: ddRef, mm: mmRef, yy: yyRef };
  const focusSeg = (kind) => {
    const el = segRefs[kind]?.current;
    if (el) { el.focus(); el.select(); }
  };
  const handleSegChange = (kind) => (e) => {
    const { value, advance } = acceptSegmentInput(kind, e.target.value);
    const next = { ...segs, [kind]: value };
    setSegs(next);
    if (invalid) setInvalid(false);
    if (!advance) return;
    const ni = SEG_ORDER.indexOf(kind) + 1;
    if (ni < SEG_ORDER.length) focusSeg(SEG_ORDER[ni]);
    else commitSegs(next, { close: false });
  };
  const handleSegKeyDown = (kind) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSegs(segs, { close: true });
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      const ni = SEG_ORDER.indexOf(kind) + 1;
      if (ni < SEG_ORDER.length) focusSeg(SEG_ORDER[ni]);
      return;
    }
    if (e.key === 'Backspace' && !segs[kind]) {
      const pi = SEG_ORDER.indexOf(kind) - 1;
      if (pi >= 0) { e.preventDefault(); focusSeg(SEG_ORDER[pi]); }
    }
  };
  // Commit only when focus leaves the WHOLE group (moving between boxes or to
  // the static slashes is still "editing").
  const handleGroupBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    commitSegs(segs, { close: false });
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
        <DialogContentContainer className={styles.pickerBox}>
          {/* Manual date entry (round 47; segmented round 71) — a DD/MM/YY mask
              at the TOP of the popover: the two slashes are ALWAYS visible and
              each digit pair lives in its own box, so typed digits land straight
              in the right segment. LTR so the numeric date reads naturally in
              the RTL app. Enter commits+closes; leaving the group commits;
              filling the year auto-commits; Esc cancels via the Dialog. */}
          <div className={styles.typeRow}>
            <div
              role="group"
              dir="ltr"
              className={`${styles.segGroup}${invalid ? ` ${styles.typeInvalid}` : ''}`}
              aria-label="הקלדת תאריך"
              aria-invalid={invalid || undefined}
              onBlur={handleGroupBlur}
            >
              <input
                ref={ddRef}
                type="text"
                inputMode="numeric"
                className={styles.segInput}
                value={segs.dd}
                placeholder="DD"
                aria-label="יום"
                onFocus={(e) => e.target.select()}
                onChange={handleSegChange('dd')}
                onKeyDown={handleSegKeyDown('dd')}
              />
              <span className={styles.segSlash} aria-hidden="true">/</span>
              <input
                ref={mmRef}
                type="text"
                inputMode="numeric"
                className={styles.segInput}
                value={segs.mm}
                placeholder="MM"
                aria-label="חודש"
                onFocus={(e) => e.target.select()}
                onChange={handleSegChange('mm')}
                onKeyDown={handleSegKeyDown('mm')}
              />
              <span className={styles.segSlash} aria-hidden="true">/</span>
              <input
                ref={yyRef}
                type="text"
                inputMode="numeric"
                className={styles.segInput}
                value={segs.yy}
                placeholder="YY"
                aria-label="שנה"
                onFocus={(e) => e.target.select()}
                onChange={handleSegChange('yy')}
                onKeyDown={handleSegKeyDown('yy')}
              />
            </div>
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
          // round132 — an empty date CELL is completely blank at rest (monday
          // native); hovering the cell reveals the "+ calendar" add hint.
          <span className={styles.addDateHint} aria-hidden="true">
            <AddSmall size={14} />
            <Calendar size={16} />
          </span>
        )}
      </button>
    </Dialog>
  );
}

export default DatePickerPopover;

import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer, DatePicker, Button } from '@vibe/core';
import { Calendar } from '@vibe/icons';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './DatePickerPopover.module.css';

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
export function DatePickerPopover({ value, onChange, variant = 'cell', placeholder = 'בחר תאריך', zIndex = 1000, formatDate, triggerClassName = '', allowClear = true }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom-start');
  const triggerRef = useRef(null);
  const isField = variant === 'field';
  const isInline = variant === 'inline';
  const fmt = formatDate || ((d) => d.toLocaleDateString('en-GB') /* DD/MM/YYYY */);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: 320,
      popupHeight: 380,
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

  const isOverdue = value && value < new Date();
  const triggerClass = isInline
    ? `${styles.trigger} ${styles.inlineTrigger} ${triggerClassName}`
    : isField
      ? `${styles.trigger} ${styles.fieldTrigger} ${value ? styles.set : styles.empty} ${triggerClassName}`
      : `${styles.trigger} ${value ? (isOverdue ? styles.overdue : styles.set) : styles.empty} ${triggerClassName}`;

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
          <DatePicker mode="single" date={value || undefined} onDateChange={handleSelect} />
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
        aria-label={value ? undefined : placeholder}
        onMouseDown={updatePosition}
      >
        {isField ? (
          <>
            <span className={styles.fieldText}>
              {value ? fmt(value) : placeholder}
            </span>
            <Calendar size={16} />
          </>
        ) : isInline ? (
          <span>{value ? fmt(value) : placeholder}</span>
        ) : value ? (
          <span>{fmt(value)}</span>
        ) : (
          <Calendar size={16} />
        )}
      </button>
    </Dialog>
  );
}

export default DatePickerPopover;

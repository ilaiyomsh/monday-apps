/**
 * DateFieldControl — monday-style date field: a field-looking trigger that opens a
 * popover holding "היום", a clock toggle, a typed date input, and the month grid.
 *
 * The HOUR is set INSIDE this popover (owner request), not in a second input beside
 * the date, and it stays OPTIONAL: a date with no hour is a complete answer, so
 * skipping the time can never fail a status transition.
 *
 * Calendar math lives in domain/monthGrid.js — this file only renders it.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Calendar, Time } from '@vibe/icons';
import { buildMonthGrid, isoToday, shiftMonth } from '../../domain/monthGrid';
import { Popover } from '../shared/Popover';

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/** Trigger text: the day, plus the hour only when one is set. */
function formatTrigger(value) {
  const date = typeof value?.date === 'string' ? value.date : '';
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const shown = `${day}.${month}.${year}`;
  return value?.time ? `${shown} · ${value.time}` : shown;
}

function monthOf(value) {
  const date = typeof value?.date === 'string' && value.date ? value.date : isoToday();
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

function DateFieldControl({
  value, onChange, disabled, controlId,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value));
  // The time row appears once the field HAS an hour, or once the user asks for one
  // with the clock button — mirroring monday's picker, where the clock reveals it.
  const [showTime, setShowTime] = useState(Boolean(value?.time));
  const triggerRef = useRef(null);

  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view]);
  const today = isoToday();
  const selected = typeof value?.date === 'string' ? value.date : '';
  const trigger = formatTrigger(value);

  const setDate = (iso) => onChange({ ...value, date: iso });

  /**
   * Pick a day and, when no hour is being entered, close — choosing a day IS the whole
   * answer for a date-only field. With the clock on the popover stays open, because the
   * time input is the rest of the answer.
   *
   * Both day sources go through here: the month grid and the "היום" shortcut. The
   * shortcut used to set the date and leave the popover sitting there, which made the
   * same action behave two different ways.
   *
   * The typed <input type="date"> deliberately does NOT close: it fires on every
   * keystroke, so closing on change would slam the popover shut mid-entry.
   */
  const commitDate = (iso) => {
    setDate(iso);
    if (!showTime) setOpen(false);
  };

  const openPopover = () => {
    if (disabled) return;
    setView(monthOf(value));
    setShowTime(Boolean(value?.time));
    setOpen(true);
  };

  return (
    <>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className={`twyst-date-trigger${trigger ? '' : ' is-empty'}`}
        disabled={disabled}
        onClick={openPopover}
      >
        <span>{trigger || 'בחרו תאריך'}</span>
        <Calendar aria-hidden="true" />
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        preferred="bottom-start"
        width={300}
        height={380}
      >
        <div className="twyst-datepicker" dir="rtl">
          <div className="twyst-datepicker-head">
            <button
              type="button"
              className="twyst-datepicker-today"
              onClick={() => commitDate(today)}
            >
              היום
            </button>
            <button
              type="button"
              className={`twyst-datepicker-clock${showTime ? ' is-on' : ''}`}
              aria-pressed={showTime}
              aria-label="הוספת שעה"
              title="הוספת שעה"
              onClick={() => {
                // Turning the clock off clears the hour, so the field falls back to
                // a date-only write rather than keeping a hidden time.
                if (showTime) onChange({ ...value, time: '' });
                setShowTime(!showTime);
              }}
            >
              <Time aria-hidden="true" />
            </button>
          </div>

          <input
            type="date"
            className="twyst-datepicker-input"
            aria-label="תאריך"
            value={selected}
            onChange={(event) => setDate(event.target.value)}
          />

          {showTime && (
            <input
              type="time"
              className="twyst-datepicker-input"
              aria-label="שעה"
              value={value?.time ?? ''}
              onChange={(event) => onChange({ ...value, time: event.target.value })}
            />
          )}

          <div className="twyst-datepicker-nav">
            <button
              type="button"
              aria-label="החודש הקודם"
              onClick={() => setView(shiftMonth(view.year, view.month, -1))}
            >
              ‹
            </button>
            <span>
              {MONTHS[view.month - 1]}
              {' '}
              {view.year}
            </span>
            <button
              type="button"
              aria-label="החודש הבא"
              onClick={() => setView(shiftMonth(view.year, view.month, 1))}
            >
              ›
            </button>
          </div>

          <div className="twyst-datepicker-grid" role="grid">
            {WEEKDAYS.map((weekday) => (
              <span className="twyst-datepicker-weekday" key={weekday}>{weekday}</span>
            ))}
            {grid.flat().map((cell) => (
              <button
                key={cell.iso}
                type="button"
                role="gridcell"
                aria-selected={cell.iso === selected}
                className={[
                  'twyst-datepicker-day',
                  cell.inMonth ? '' : 'is-outside',
                  cell.iso === selected ? 'is-selected' : '',
                  cell.iso === today ? 'is-today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => commitDate(cell.iso)}
              >
                {cell.day}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}

export default DateFieldControl;

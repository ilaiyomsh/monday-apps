import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@vibe/core';
import {
  monthGridDays, sameDay, dayKey, WEEKDAYS_HE, WEEKDAYS_HE_LONG,
} from '@generated/utils/calendarDates.js';
import { MONTHS_HE } from '@generated/utils/dateTime.js';
import { EventChip } from './EventChip.jsx';
import styles from './MonthGrid.module.css';

/* How many chips fit a day cell: measured row height minus the day-number row,
   divided by chip height (+gap). Re-measured on resize (the sidebar is
   drag-resizable). */
const CELL_HEADER_PX = 26;
const CHIP_PX = 21;

/* One month-view day cell. div[role=button] rather than <button> — it CONTAINS
   chip buttons, and nested buttons are invalid HTML. Clicking the cell (number
   or empty area) navigates to the WEEK view of that day; chips stop
   propagation and open the discussion. */
function DayCell({ day, inMonth, isToday, events, maxChips, selectedId, accentFor, actionsFor, onDayClick, onChipClick, onChipContextMenu, loading, showSkeleton }) {
  const visible = events.slice(0, maxChips);
  const overflow = events.length - visible.length;
  const label = `יום ${WEEKDAYS_HE_LONG[day.getDay()]}, ${day.getDate()} ב${MONTHS_HE[day.getMonth()]} — מעבר לשבוע עבודה`;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.calMCell} ${inMonth ? '' : styles.calMCellOut}`}
      aria-label={label}
      onClick={() => onDayClick(day)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDayClick(day);
        }
      }}
    >
      <span className={`${styles.calMDayNum} ${isToday ? styles.calMDayNumToday : ''}`}>
        {day.getDate()}
      </span>
      <div className={styles.calMChips}>
        {loading ? (
          showSkeleton && <Skeleton type={"rectangle"} fullWidth height={16} />
        ) : (
          <>
            {visible.map((item) => (
              <EventChip
                key={item.id}
                item={item}
                accent={accentFor(item)}
                selected={selectedId === item.id}
                onClick={onChipClick}
                onContextMenu={onChipContextMenu}
                variant="month"
                actions={actionsFor(item)}
              />
            ))}
            {overflow > 0 && <span className={styles.calMMore}>+{overflow} עוד</span>}
          </>
        )}
      </div>
    </div>
  );
}

export function MonthGrid({ anchor, eventsByDay, selectedId, accentFor, actionsFor = () => null, onDayClick, onChipClick, onChipContextMenu = null, loading }) {
  const weeks = useMemo(() => monthGridDays(anchor), [anchor]);
  const gridRef = useRef(null);
  const [maxChips, setMaxChips] = useState(3);
  const today = new Date();

  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const rowH = el.clientHeight / weeks.length;
      setMaxChips(Math.max(1, Math.floor((rowH - CELL_HEADER_PX - 4) / CHIP_PX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  return (
    <div className={styles.calMRoot}>
      <div className={styles.calMWeekdays} aria-hidden="true">
        {WEEKDAYS_HE.map((w) => (
          <span key={w} className={styles.calMWeekday}>{w}</span>
        ))}
      </div>
      <div ref={gridRef} className={styles.calMGrid}>
        {weeks.flat().map((day, i) => (
          <DayCell
            key={dayKey(day)}
            day={day}
            inMonth={day.getMonth() === anchor.getMonth()}
            isToday={sameDay(day, today)}
            events={eventsByDay.get(dayKey(day)) || []}
            maxChips={maxChips}
            selectedId={selectedId}
            accentFor={accentFor}
            actionsFor={actionsFor}
            onDayClick={onDayClick}
            onChipClick={onChipClick}
            onChipContextMenu={onChipContextMenu}
            loading={loading}
            showSkeleton={i % 3 === 0}
          />
        ))}
      </div>
    </div>
  );
}

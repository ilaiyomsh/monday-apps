import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  workWeekDays, sameDay, dayKey, fmtHour, itemHasTime, layoutDayEvents,
  WEEKDAYS_HE, WEEKDAYS_HE_LONG,
} from '@generated/utils/calendarDates.js';
import { MONTHS_HE } from '@generated/utils/dateTime.js';
import { EventChip } from './EventChip.jsx';
import styles from './WeekGrid.module.css';

export const HOUR_PX = 48;
// Visible day window: hour lines from 06:00 through 23:00 (inclusive).
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
const DAY_START_MIN = DAY_START_HOUR * 60;
// Open with 07:00 at the top, nudged up a touch so its label sits fully visible.
const SCROLL_TO_HOUR = 7;

/* Y offset (px) for a minute-of-day within the 06:00-anchored grid. */
function topForMinute(min) {
  return ((min - DAY_START_MIN) / 60) * HOUR_PX;
}

/* Red "now" line across today's column, repositioned every minute. */
function NowLine() {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={styles.calWkNow} style={{ top: topForMinute(minutes) }} aria-hidden="true">
      <span className={styles.calWkNowDot} />
    </div>
  );
}

/* One day column: 24 clickable hour slots (create-discussion affordance) with
   the day's timed chips absolutely positioned as SIBLINGS of the slots (chips
   are buttons; nesting them inside the slot buttons would be invalid HTML). */
function DayColumn({ day, isToday, timedEvents, selectedId, accentFor, actionsFor, onChipClick, onChipContextMenu, onSlotClick }) {
  const laidOut = useMemo(() => layoutDayEvents(timedEvents), [timedEvents]);
  const dayLabel = `יום ${WEEKDAYS_HE_LONG[day.getDay()]} ${day.getDate()} ב${MONTHS_HE[day.getMonth()]}`;
  return (
    <div className={`${styles.calWkDayCol} ${isToday ? styles.calWkDayColToday : ''}`}>
      {HOURS.map((h) => (
        <button
          key={h}
          type="button"
          className={styles.calWkSlot}
          style={{ top: topForMinute(h * 60) }}
          aria-label={`צור דיון חדש — ${dayLabel} בשעה ${fmtHour(h)}`}
          onClick={() => onSlotClick({ date: dayKey(day), time: fmtHour(h) })}
        />
      ))}
      {laidOut.map(({ item, startMin, lane, laneCount }) => (
        <EventChip
          key={item.id}
          item={item}
          accent={accentFor(item)}
          selected={selectedId === item.id}
          onClick={onChipClick}
          onContextMenu={onChipContextMenu}
          variant="timed"
          actions={actionsFor(item)}
          style={{
            top: topForMinute(startMin) + 1,
            height: HOUR_PX - 3,
            width: `calc((100% - 6px) / ${laneCount})`,
            insetInlineStart: `calc(3px + ((100% - 6px) / ${laneCount}) * ${lane})`,
          }}
        />
      ))}
      {isToday && <NowLine />}
    </div>
  );
}

export function WeekGrid({ anchor, eventsByDay, selectedId, accentFor, actionsFor = () => null, onChipClick, onChipContextMenu = null, onSlotClick, loading }) {
  const days = useMemo(() => workWeekDays(anchor), [anchor]);
  const scrollRef = useRef(null);
  const today = new Date();

  // Open with 07:00 as the first visible hour (nudged up so its label shows in
  // full); the rest of the 06:00-23:00 window stays reachable by scroll.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = topForMinute(SCROLL_TO_HOUR * 60) - 10;
  }, [anchor]);

  const byDay = useMemo(() => days.map((day) => {
    const events = eventsByDay.get(dayKey(day)) || [];
    return {
      day,
      timed: events.filter((e) => itemHasTime(e)),
    };
  }), [days, eventsByDay]);

  return (
    <div ref={scrollRef} className={`${styles.calWkScroll} ${loading ? styles.calWkLoading : ''}`}>
      {/* Sticky chrome + body share one grid template so columns always align. */}
      <div className={styles.calWkDayHeader}>
        <span className={styles.calWkGutterCorner} />
        {days.map((day) => (
          <span key={dayKey(day)} className={`${styles.calWkDayHead} ${sameDay(day, today) ? styles.calWkDayHeadToday : ''}`}>
            <span className={styles.calWkDayHeadName}>{WEEKDAYS_HE[day.getDay()]}</span>
            <span className={`${styles.calWkDayHeadNum} ${sameDay(day, today) ? styles.calWkDayHeadNumToday : ''}`}>
              {day.getDate()}
            </span>
          </span>
        ))}
      </div>

      <div className={styles.calWkBody}>
        <div className={styles.calWkGutter}>
          {HOURS.map((h) => (
            <span key={h} className={styles.calWkGutterLabel} style={{ top: topForMinute(h * 60) }}>
              {fmtHour(h)}
            </span>
          ))}
        </div>
        {byDay.map(({ day, timed }) => (
          <DayColumn
            key={dayKey(day)}
            day={day}
            isToday={sameDay(day, today)}
            timedEvents={timed}
            selectedId={selectedId}
            accentFor={accentFor}
            actionsFor={actionsFor}
            onChipClick={onChipClick}
            onChipContextMenu={onChipContextMenu}
            onSlotClick={onSlotClick}
          />
        ))}
      </div>
    </div>
  );
}

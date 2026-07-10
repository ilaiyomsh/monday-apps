import React, { useMemo } from 'react';
import { Button, IconButton } from '@vibe/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfDay, addDays, addMonths, groupItemsByDay, fmtMonthTitle, fmtWeekRangeTitle,
} from '@generated/utils/calendarDates.js';
import { discussionAccentColor } from '@generated/constants/discussionColors.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { MonthGrid } from './MonthGrid.jsx';
import { WeekGrid } from './WeekGrid.jsx';
import styles from './DiscussionCalendar.module.css';

/* Calendar body for the discussions sidebar. Hebrew RTL calendar: the root
   sets dir="rtl" (the app root stays ltr), so Sunday is the RIGHTMOST column
   and "previous" points right / "next" points left — the Hebrew-calendar
   convention. Nav state (anchor + month/week mode) lives in App so it
   survives the refreshKey remount of DiscussionList. */
export function DiscussionCalendar({
  items, loading, refetching, selectedId,
  anchor, mode, onNavigate, onSelect, onCreateAt,
  // {onEdit, onDuplicate, onExport, onDelete, exportingId} — the standard row
  // actions, surfaced on chip hover.
  rowActions = null,
  // (item, event) => void — opens the shared right-click context menu at the
  // cursor for a chip (round 33). Wired on each EventChip's onContextMenu.
  onItemContextMenu = null,
}) {
  const eventsByDay = useMemo(() => groupItemsByDay(items), [items]);
  const { typeColor } = useTemplates();
  const accentFor = (item) => discussionAccentColor(item, typeColor);
  const actionsFor = (item) => (rowActions ? { ...rowActions, exporting: rowActions.exportingId === item.id } : null);
  const isWeek = mode === 'week';

  const goPrev = () => onNavigate({ mode, anchor: isWeek ? addDays(anchor, -7) : addMonths(anchor, -1) });
  const goNext = () => onNavigate({ mode, anchor: isWeek ? addDays(anchor, 7) : addMonths(anchor, 1) });
  const goToday = () => onNavigate({ mode, anchor: startOfDay(new Date()) });

  return (
    <div className={styles.calRoot} dir="rtl">
      <div className={styles.calHeader}>
        <div className={styles.calHeaderRow}>
          <span className={styles.calTitle}>
            {isWeek ? fmtWeekRangeTitle(anchor) : fmtMonthTitle(anchor)}
          </span>
          <div className={styles.calNav}>
            {/* RTL time axis: back-in-time points RIGHT, forward points LEFT. */}
            <IconButton
              icon={ChevronRight}
              size={"small"}
              kind={"tertiary"}
              ariaLabel={isWeek ? 'שבוע העבודה הקודם' : 'החודש הקודם'}
              onClick={goPrev}
            />
            <Button kind={"tertiary"} size={"small"} onClick={goToday}>
              היום
            </Button>
            <IconButton
              icon={ChevronLeft}
              size={"small"}
              kind={"tertiary"}
              ariaLabel={isWeek ? 'שבוע העבודה הבא' : 'החודש הבא'}
              onClick={goNext}
            />
          </div>
          <div className={styles.calModeToggle} role="group" aria-label="תצוגת לוח שנה">
            <button
              type="button"
              className={`${styles.calModeBtn} ${!isWeek ? styles.calModeBtnActive : ''}`}
              aria-pressed={!isWeek}
              onClick={() => onNavigate({ anchor, mode: 'month' })}
            >
              חודשי
            </button>
            <button
              type="button"
              className={`${styles.calModeBtn} ${isWeek ? styles.calModeBtnActive : ''}`}
              aria-pressed={isWeek}
              onClick={() => onNavigate({ anchor, mode: 'week' })}
            >
              שבוע עבודה
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.calBody} ${refetching ? styles.calRefetching : ''}`}>
        {isWeek ? (
          <WeekGrid
            anchor={anchor}
            eventsByDay={eventsByDay}
            selectedId={selectedId}
            accentFor={accentFor}
            actionsFor={actionsFor}
            onChipClick={onSelect}
            onChipContextMenu={onItemContextMenu}
            onSlotClick={onCreateAt}
            loading={loading}
          />
        ) : (
          <MonthGrid
            anchor={anchor}
            eventsByDay={eventsByDay}
            selectedId={selectedId}
            accentFor={accentFor}
            actionsFor={actionsFor}
            onDayClick={(day) => onNavigate({ anchor: day, mode: 'week' })}
            onChipClick={onSelect}
            onChipContextMenu={onItemContextMenu}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

import { type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useL10n } from '../../domain/useL10n';
import { buildMonthMatrix, toKey, isWeekend, todayKey } from '../../domain/dates';
import type { DayKey, Employee } from '../../domain/types';
import { Icon } from './Icon';

export type CalChipKind = 'absence' | 'holiday';

export interface CalChip {
  key: string;
  kind: CalChipKind;
  label: string;
  color: string;
  /** Event span (day-keys). Multi-day events render as one continuous bar. */
  start?: DayKey;
  end?: DayKey;
  emp?: Employee;
  pending?: boolean;
  mandatory?: boolean;
  data?: unknown;
}

interface MonthCalendarProps {
  monthDate: Date;
  chipsFor: (dateKey: string) => CalChip[] | undefined;
  onAddDay?: (dateKey: string) => void;
  onChipClick?: (chip: CalChip) => void;
  /** Mobile: compact grid (short rows, tiny colour-only bars) so the whole month fits. */
  compact?: boolean;
}

// Layout constants (kept in sync with .cal-week-events in app.css).
const HEADER_H = 32; // date-number strip height + 2px gap before the bars
const LANE_H = 30; // one bar lane (tall enough for a 2-line label)
const LANE_GAP = 4;
const MIN_CELL_H = 112;

interface WeekEvent {
  chip: CalChip;
  startCol: number; // 0..6 within the week
  endCol: number;
  lane: number;
  contStart: boolean; // continues before this week (flatten inline-start)
  contEnd: boolean; // continues after this week (flatten inline-end)
}

/**
 * Resolve the events overlapping a single week into positioned, lane-packed bars.
 * Each event is clipped to the week and assigned the first free lane so bars never
 * overlap. Returns bars + the lane count (for sizing the row).
 */
function layoutWeek(week: Date[], chipsFor: (k: string) => CalChip[] | undefined): { bars: WeekEvent[]; lanes: number } {
  const wStart = toKey(week[0]);
  const wEnd = toKey(week[6]);
  const keys = week.map(toKey);

  // Unique chips overlapping the week (dedupe by key; first day seen is a span fallback).
  const seen = new Map<string, { chip: CalChip; firstDay: DayKey }>();
  week.forEach((d) => {
    const k = toKey(d);
    (chipsFor(k) ?? []).forEach((c) => {
      if (!seen.has(c.key)) seen.set(c.key, { chip: c, firstDay: k });
    });
  });

  const bars: WeekEvent[] = [];
  seen.forEach(({ chip, firstDay }) => {
    const s = chip.start ?? firstDay;
    const e = chip.end ?? firstDay;
    const startCol = s <= wStart ? 0 : Math.max(0, keys.indexOf(s));
    const endIdx = keys.indexOf(e);
    const endCol = e >= wEnd ? 6 : endIdx === -1 ? 6 : endIdx;
    if (startCol > endCol) return;
    bars.push({ chip, startCol, endCol, lane: 0, contStart: s < wStart, contEnd: e > wEnd });
  });

  // Longest/earliest first, then greedy lane packing.
  bars.sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));
  const laneEnds: number[] = []; // last occupied col per lane
  bars.forEach((b) => {
    let lane = laneEnds.findIndex((end) => end < b.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endCol);
    } else {
      laneEnds[lane] = b.endCol;
    }
    b.lane = lane;
  });

  return { bars, lanes: laneEnds.length };
}

export function MonthCalendar({ monthDate, chipsFor, onAddDay, onChipClick, compact = false }: MonthCalendarProps) {
  const { t } = useTranslation();
  // Mobile: a compact grid (short rows, tiny colour-only bars) so the WHOLE month
  // fits at once. Values mirror the .is-mobile .cal-week-events rules in app.css.
  const headerH = compact ? 30 : HEADER_H;
  const laneH = compact ? 15 : LANE_H;
  const laneGap = compact ? 2 : LANE_GAP;
  const minCellH = compact ? 54 : MIN_CELL_H;
  const { daysShort } = useL10n().names;
  const weeks = buildMonthMatrix(monthDate);
  const today = todayKey();
  const mo = monthDate.getMonth();

  return (
    <div className="calendar">
      <div className="cal-weekdays">
        {daysShort.map((d, i) => (
          <div key={d} className={`cal-weekday ${i >= 5 ? 'weekend' : ''}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {weeks.map((week, wi) => {
          const { bars, lanes } = layoutWeek(week, chipsFor);
          const rowH = lanes > 0 ? Math.max(minCellH, headerH + lanes * laneH + (lanes - 1) * laneGap + 8) : minCellH;
          return (
            <div className="cal-week" key={wi}>
              <div className="cal-week-days" style={{ minHeight: rowH }}>
                {week.map((date) => {
                  const key = toKey(date);
                  const dayChips = chipsFor(key) ?? [];
                  return (
                    <div
                      key={key}
                      className={`cal-cell ${date.getMonth() !== mo ? 'muted' : ''} ${isWeekend(date) ? 'weekend' : ''} ${
                        key === today ? 'today' : ''
                      } ${dayChips.some((c) => c.kind === 'holiday') ? 'is-holiday' : ''}`}
                      onClick={() => onAddDay && onAddDay(key)}
                    >
                      <div className="cell-head">
                        <span className="cell-num">{date.getDate()}</span>
                        {onAddDay && (
                          <button
                            className="cell-add"
                            title={t('calendar.addTitle')}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddDay(key);
                            }}
                          >
                            <Icon name="plus" size={13} strokeWidth={2.2} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="cal-week-events">
                {bars.map((b) => (
                  <CalBar
                    key={b.chip.key}
                    ev={b}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChipClick?.(b.chip);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface CalBarProps {
  ev: WeekEvent;
  onClick: (e: MouseEvent) => void;
}

/** One positioned bar within a week row (spans startCol..endCol on its lane). */
function CalBar({ ev, onClick }: CalBarProps) {
  const { t } = useTranslation();
  const { chip } = ev;
  const place: CSSProperties = {
    gridColumn: `${ev.startCol + 1} / span ${ev.endCol - ev.startCol + 1}`,
    gridRow: ev.lane + 1,
  };
  const cont = `${ev.contStart ? ' cont-start' : ''}${ev.contEnd ? ' cont-end' : ''}`;

  if (chip.kind === 'holiday') {
    return (
      <div
        className={`cal-bar holiday-chip ${chip.mandatory ? '' : 'optional'}${cont}`}
        style={place}
        onClick={onClick}
        title={t('calendar.holidayTitle', { name: chip.label })}
      >
        <Icon name="square" size={10} fill={chip.mandatory ? 'currentColor' : 'none'} />
        <span className="cal-bar-label">{chip.label}</span>
      </div>
    );
  }

  if (chip.pending) {
    return (
      <div
        className={`cal-bar evt-pending${cont}`}
        style={{ ...place, '--c': chip.color } as CSSProperties}
        onClick={onClick}
        title={`${chip.label} · ${t('status.pending')}`}
      >
        {chip.emp ? <span className="evt-av">{chip.emp.initials}</span> : <span className="evt-dot" style={{ background: chip.color }} />}
        <span className="cal-bar-label">{chip.label}</span>
      </div>
    );
  }

  return (
    <div
      className={`cal-bar evt-approved${cont}`}
      style={{ ...place, '--c': chip.color } as CSSProperties}
      onClick={onClick}
      title={`${chip.label} · ${t('status.approved')}`}
    >
      {chip.emp && <span className="evt-av">{chip.emp.initials}</span>}
      <span className="cal-bar-label">{chip.label}</span>
    </div>
  );
}

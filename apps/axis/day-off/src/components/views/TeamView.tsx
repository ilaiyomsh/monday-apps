/**
 * TeamView — team timeline grid (who's off when across the visible month).
 * Ported from the prototype's TeamView + teamRuns + absenceForCell.
 * Data comes from useDayOffData(); dates/labels via useL10n().
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useViewTracking } from '@axis/app-core';
import { logger } from '../../core';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { useL10n } from '../../domain/useL10n';
import { absenceTypeMeta, TYPE_ORDER } from '../../domain/absence';
import { isWeekend, toKey, todayKey } from '../../domain/dates';
import type { CompanyDay, DayOffRequest } from '../../domain/types';
import { Tooltip } from '@vibe/core';
import { Avatar, CalToolbar } from '../ui';
import { useIsMobile } from '../../hooks/useIsMobile';

interface TeamViewProps {
  onOpenRequest: (request: DayOffRequest) => void;
}

interface TeamBarRun {
  request: DayOffRequest;
  type: ReturnType<typeof absenceTypeMeta>;
  pending: boolean;
  startCol: number;
  colSpan: number;
}

const NAME_COL_W = 190;
const CELL_SIZE = 40; // max day-column width
const BAR_MEASURE_PAD = 22;

/** Gantt bar — label is shown only when the full text fits; otherwise color only. */
function TeamBar({
  run,
  label,
  empName,
  onOpen,
}: {
  run: TeamBarRun;
  label: string;
  empName: string;
  onOpen: () => void;
}) {
  const { t } = useL10n();
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [showLabel, setShowLabel] = useState(false);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;

    const update = () => {
      const paddingX = BAR_MEASURE_PAD;
      const gap = run.pending ? 14 : 0;
      const available = bar.clientWidth - paddingX - gap;
      setShowLabel(available > 0 && measure.scrollWidth <= available);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [label, run.pending]);

  return (
    <Tooltip
      showDelay={0}
      // Portal to body + high z-index so the tooltip is never clipped behind a bar in an adjacent row.
      getContainer={() => document.body}
      zIndex={2200}
      content={t('views.team.barTitle', {
        name: empName,
        type: label,
        status: run.pending ? t('status.pending') : t('status.approved'),
      })}
    >
      <div
        ref={barRef}
        className={`team-bar ${run.pending ? 'pending' : 'approved'}${showLabel ? '' : ' team-bar--no-label'}`}
        style={
          {
            gridColumn: `${run.startCol} / span ${run.colSpan}`,
            gridRow: 1,
            '--c': run.type.color,
          } as CSSProperties
        }
        onClick={onOpen}
      >
        {run.pending && <span className="tb-dot" style={{ background: run.type.color }} />}
        <span ref={measureRef} className="tb-label-measure" aria-hidden="true">
          {label}
        </span>
        {showLabel && <span className="tb-label">{label}</span>}
      </div>
    </Tooltip>
  );
}

export function TeamView({ onOpenRequest }: TeamViewProps) {
  useViewTracking(logger, 'team');
  const { monthDate, nav, requests, teamIds, myTeams, empById, holidaysOnKey } = useDayOffData();
  const { t, dayShort } = useL10n();
  // Group the Gantt by team only when the user belongs to more than one team.
  const grouped = myTeams.length > 1;

  const year = monthDate.getFullYear();
  const mo = monthDate.getMonth();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();

  const boardRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // Mobile Gantt: once the board is scrolled horizontally, collapse the sticky
  // name column to avatars only (frees room for the day grid).
  const [namesCollapsed, setNamesCollapsed] = useState(false);

  // Always show exactly the current month — never spill into next month's days
  // (a board spanning two months reads as confusing).
  const days: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, mo, d));
  }

  const dayKeys = days.map((dt) => toKey(dt));
  const rangeStart = dayKeys[0];
  const rangeEnd = dayKeys[dayKeys.length - 1];

  /* Continuous absence segments within the visible day range (month + trailing days). */
  const teamRuns = (empId: string) =>
    requests
      .filter(
        (r) => r.employeeId === empId && r.status !== 'rejected' && r.start <= rangeEnd && r.end >= rangeStart,
      )
      .map((r) => {
        const s = r.start < rangeStart ? rangeStart : r.start;
        const e = r.end > rangeEnd ? rangeEnd : r.end;
        const startIdx = dayKeys.indexOf(s);
        const endIdx = dayKeys.indexOf(e);
        if (startIdx < 0 || endIdx < 0) return null;
        return {
          request: r,
          type: absenceTypeMeta(r.type),
          pending: r.status === 'pending',
          startCol: startIdx + 2,
          colSpan: endIdx - startIdx + 1,
        };
      })
      .filter((run): run is TeamBarRun => run !== null);

  const tKey = todayKey();
  const holidayByKey: Record<string, CompanyDay> = {};
  days.forEach((dt) => {
    const k = toKey(dt);
    const hits = holidaysOnKey(k);
    if (hits.length) holidayByKey[k] = hits[0];
  });

  // Day columns expand to fill available width (min 40px) — never below 40px, so the
  // board only scrolls when the month genuinely doesn't fit, not to over-expand.
  // Mobile collapses the name column to an avatars-only strip once the board is
  // scrolled horizontally (driven in JS so it beats the per-row inline grid style).
  const nameW = !isMobile ? NAME_COL_W : namesCollapsed ? 44 : 132;
  const gridCols = `${nameW}px repeat(${days.length}, minmax(${CELL_SIZE}px, 1fr))`;
  const teamLayoutStyle = {
    '--team-cell': `${CELL_SIZE}px`,
    '--team-bar-h': '26px',
    '--team-bar-pad-x': '11px',
    '--team-bar-margin': '3px',
    '--team-bar-font': '12px',
    '--team-bar-dot': '9px',
    '--team-today-badge': '24px',
  } as CSSProperties;

  // One employee row. `groupId` disambiguates keys when a member appears in
  // more than one team group.
  const renderRow = (id: string, groupId?: string) => {
    const emp = empById(id);
    const runs = teamRuns(id);
    return (
      <div key={groupId ? `${groupId}:${id}` : id} className="team-row" style={{ gridTemplateColumns: gridCols }}>
        <div className="team-name" style={{ gridColumn: 1, gridRow: 1 }}>
          <Avatar emp={emp} size="sm" />
          <span className="tn-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp?.name}</span>
        </div>
        {days.map((dt, i) => {
          const k = toKey(dt);
          const we = isWeekend(dt);
          const hol = holidayByKey[k];
          const otherMonth = dt.getMonth() !== mo;
          return (
            <div
              key={k}
              className={`team-cell ${we ? 'weekend' : ''} ${hol ? 'holiday' : ''} ${otherMonth ? 'other-month' : ''}`}
              style={{ gridColumn: i + 2, gridRow: 1 }}
            />
          );
        })}
        {runs.map((run) => (
          <TeamBar
            key={run.request.id}
            run={run}
            label={t(run.type.labelKey)}
            empName={emp?.name ?? ''}
            onOpen={() => onOpenRequest(run.request)}
          />
        ))}
      </div>
    );
  };

  // auto-scroll to center TODAY when the board opens / month changes.
  // scrollIntoView is direction-agnostic, so it centers correctly under RTL too
  // (where scrollLeft/offsetLeft arithmetic differs across browsers).
  useEffect(() => {
    const board = boardRef.current;
    if (!board || isMobile) return; // mobile rests at month start so name-collapse-on-scroll reads naturally
    const todayEl = board.querySelector<HTMLElement>('.team-dayhead.today');
    if (todayEl) {
      todayEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    } else {
      board.scrollLeft = 0;
    }
  }, [monthDate, isMobile]);

  return (
    <div className="page team-page">
      <CalToolbar
        {...nav}
        monthDate={monthDate}
        right={
          <div className="team-legend">
            {TYPE_ORDER.map((tid) => (
              <span className="legend-item" key={tid}>
                <span className="legend-swatch" style={{ background: absenceTypeMeta(tid).color }} />
                {t(absenceTypeMeta(tid).labelKey)}
              </span>
            ))}
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: 'var(--color-event-holiday)' }} />
              {t('views.dashboard.legendCompany')}
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--pending" />
              {t('status.pending')}
            </span>
          </div>
        }
      />

      <div
        className="card team-board"
        ref={boardRef}
        onScroll={(e) => {
          if (isMobile) setNamesCollapsed(Math.abs(e.currentTarget.scrollLeft) > 8);
        }}
      >
        <div className={`team-grid${isMobile && namesCollapsed ? ' names-collapsed' : ''}`} style={teamLayoutStyle}>
          {/* header */}
          <div className="team-head-row" style={{ gridTemplateColumns: gridCols }}>
            <div className="team-corner" />
            {days.map((dt) => {
              const k = toKey(dt);
              const we = isWeekend(dt);
              const today = k === tKey;
              const hol = holidayByKey[k];
              const otherMonth = dt.getMonth() !== mo;
              return (
                <div
                  key={k}
                  className={`team-dayhead ${we ? 'weekend' : ''} ${today ? 'today' : ''} ${hol ? 'holiday' : ''} ${otherMonth ? 'other-month' : ''}`}
                  title={hol ? t('calendar.holidayTitle', { name: hol.name }) : ''}
                >
                  <div>{dayShort(dt.getDay())}</div>
                  <div className="dnum">{dt.getDate()}</div>
                  {hol && (
                    <div className="tdh-hol">
                      <span className="tdh-hol-name">{t('views.team.companyShort')}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* rows */}
          {grouped
            ? myTeams.map((tm, i) => (
                <Fragment key={tm.id}>
                  <div className="team-group-head">
                    <span className="tgh-label">
                      {tm.name || t('settings.team.namePlaceholder', { n: i + 1 })}
                    </span>
                  </div>
                  {[...new Set([...tm.managers, ...tm.employees])].map((id) => renderRow(id, tm.id))}
                </Fragment>
              ))
            : teamIds.map((id) => renderRow(id))}
        </div>
      </div>
    </div>
  );
}

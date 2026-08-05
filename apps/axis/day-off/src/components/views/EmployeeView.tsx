/* ============================================================
   Day Off — Employee view ("My absences"). Layout: month calendar on the
   right (top-aligned); left column holds per-type absence-day stats (aligned
   with the calendar) and the date-sorted request list below (pending first).
   Data via useDayOffData(); dates via useL10n().
   ============================================================ */
import { useState, type CSSProperties } from 'react';
import { useViewTracking } from '@axis/app-core';
import { logger } from '../../core';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { useL10n } from '../../domain/useL10n';
import { absenceTypeMeta, TYPE_ORDER, reqWorkdayKeysInYear } from '../../domain/absence';
import { useIsMobile } from '../../hooks/useIsMobile';
import { workdaysBetween } from '../../domain/dates';
import type { AbsenceType, CompanyDay, DayOffRequest } from '../../domain/types';
import {
  Avatar,
  CalToolbar,
  Icon,
  MonthCalendar,
  Rng,
  Seg,
  StatusBadge,
  TypeLegend,
  YearSelect,
  type CalChip,
} from '../ui';

/* requests of an employee that cover a given day, for calendar chips */
function myChipsFor(
  requests: DayOffRequest[],
  holidaysOnKey: (dateKey: string) => CompanyDay[],
  typeLabel: (type: AbsenceType) => string,
  empId: string,
  dateKey: string,
  { includeHolidays = true }: { includeHolidays?: boolean } = {},
): CalChip[] {
  const chips: CalChip[] = [];
  if (includeHolidays) {
    holidaysOnKey(dateKey).forEach((h) => {
      chips.push({ key: 'h' + h.id, kind: 'holiday', label: h.name, color: '', start: h.start, end: h.end, mandatory: h.mandatory, data: h });
    });
  }
  requests
    .filter((r) => r.employeeId === empId && r.status !== 'rejected' && dateKey >= r.start && dateKey <= r.end)
    .forEach((r) => {
      const meta = absenceTypeMeta(r.type);
      chips.push({
        key: r.id,
        kind: 'absence',
        label: typeLabel(r.type),
        color: meta.color,
        start: r.start,
        end: r.end,
        pending: r.status === 'pending',
        data: r,
      });
    });
  return chips;
}

type StatScope = 'month' | 'year';

interface StatCardProps {
  empId: string;
  type: AbsenceType;
  year: number;
  monthDate: Date;
  scope: StatScope;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}

/** Compact per-type absence-day counter — one number for the selected scope (no quota). */
function StatCard({ empId, type, year, monthDate, scope, selected, dimmed, onSelect }: StatCardProps) {
  const { t } = useL10n();
  const { requests, pendingDaysFor } = useDayOffData();
  const meta = absenceTypeMeta(type);
  const monthPrefix = `${year}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

  let days = 0;
  for (const r of requests) {
    if (r.employeeId !== empId || r.type !== type || r.status === 'rejected') continue;
    const keys = reqWorkdayKeysInYear(r, year);
    days += scope === 'month' ? keys.filter((k) => k.startsWith(monthPrefix)).length : keys.length;
  }
  const pending = pendingDaysFor(empId, type, year);

  return (
    <button
      type="button"
      className={`stat-card${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
      style={{ '--accent': meta.color } as CSSProperties}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {pending > 0 && <span className="stat-pending-dot" title={t('stats.pending', { count: pending })} />}
      <span className="stat-num">{days}</span>
      <span className="stat-top">
        <span className="stat-title">{t(meta.labelKey)}</span>
      </span>
    </button>
  );
}

export interface RequestRowProps {
  request: DayOffRequest;
  onClick: (request: DayOffRequest) => void;
  showEmp?: boolean;
}

export function RequestRow({ request, onClick, showEmp }: RequestRowProps) {
  const { t } = useL10n();
  const { empById, canAttachDocuments } = useDayOffData();
  const emp = empById(request.employeeId);
  const meta = absenceTypeMeta(request.type);
  const days = workdaysBetween(request.start, request.end);
  // Employee's own approved request with no document yet → offer to attach one.
  // (Not shown in manager contexts, which pass showEmp.)
  const showAttachCta = !showEmp && canAttachDocuments && request.status === 'approved' && !request.attachment;
  return (
    <div className="list-row" style={{ cursor: 'pointer' }} onClick={() => onClick(request)}>
      {/* approved = full type colour, pending = same colour faded (CSS), rejected = neutral grey (CSS) */}
      <span
        className="row-bar"
        style={request.status === 'rejected' ? undefined : { background: meta.color }}
        data-status={request.status}
      />
      {showEmp && <Avatar emp={emp} size="sm" />}
      <div className="row-main">
        <div className="row-title">
          {showEmp ? emp?.name : t(meta.labelKey)}
          {showEmp && (
            <span className="type-chip" style={{ fontSize: 12 }}>
              <span className="dot" style={{ background: meta.color }} />
              {t(meta.labelKey)}
            </span>
          )}
        </div>
        <div className="row-meta">
          <Rng start={request.start} end={request.end} />
          <span className="row-dot" />
          <span>{t('common.workdays', { count: days })}</span>
          {request.note && (
            <>
              <span className="row-dot" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {request.note}
              </span>
            </>
          )}
          {request.attachment && (
            <span className="row-attach" title={t('common.attachedDocument')}>
              <Icon name="paperclip" size={13} />
            </span>
          )}
          {showAttachCta && (
            <>
              <span className="row-dot" />
              <span className="row-attach-cta">{t('detail.attachDocument')}</span>
            </>
          )}
        </div>
      </div>
      <StatusBadge status={request.status} />
      <Icon name="chevron-right" size={18} className="rtl-flip" style={{ color: 'var(--color-text-disabled)' }} />
    </div>
  );
}

interface EmployeeViewProps {
  onNewRequest: () => void;
  onOpenRequest: (request: DayOffRequest) => void;
  onAddOnDay: (dateKey: string) => void;
}

export function EmployeeView({ onNewRequest, onOpenRequest, onAddOnDay }: EmployeeViewProps) {
  useViewTracking(logger, 'mine');
  const { t } = useL10n();
  const { currentUser, monthDate, nav, year, years, onYearChange, requests, holidaysOnKey, loading } = useDayOffData();
  const [scope, setScope] = useState<StatScope>('month');
  // Clicking a summary card filters the list to that one type (click again clears).
  const [typeFilter, setTypeFilter] = useState<AbsenceType | null>(null);

  const mo = monthDate.getMonth();
  const mine = requests.filter((r) => r.employeeId === currentUser.id);

  // Scope window: the whole year, or the calendar's current month within it.
  const monthStart = `${year}-${String(mo + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(mo + 1).padStart(2, '0')}-${String(new Date(year, mo + 1, 0).getDate()).padStart(2, '0')}`;
  const inScope = mine.filter((r) =>
    scope === 'year'
      ? Number(r.start.slice(0, 4)) === year || Number(r.end.slice(0, 4)) === year
      : r.end >= monthStart && r.start <= monthEnd,
  );
  const visible = typeFilter ? inScope.filter((r) => r.type === typeFilter) : inScope;

  // Open (pending) requests first — soonest start first — then the rest, newest first.
  const pending = visible.filter((r) => r.status === 'pending').slice().sort((a, b) => a.start.localeCompare(b.start));
  const settled = visible.filter((r) => r.status !== 'pending').slice().sort((a, b) => b.start.localeCompare(a.start));
  const ordered = [...pending, ...settled];

  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'calendar' | 'list'>('calendar');

  // Shared building blocks — composed as a grid on desktop, but on mobile as:
  // cards on top → a calendar/list toggle → ONE view (so there's no long scroll
  // through both the calendar and the list).
  const statsScope = (
    <div className="stats-scope" role="tablist">
      <button type="button" role="tab" aria-selected={scope === 'month'} className={scope === 'month' ? 'active' : ''} onClick={() => setScope('month')}>
        {t('stats.thisMonth')}
      </button>
      <button type="button" role="tab" aria-selected={scope === 'year'} className={scope === 'year' ? 'active' : ''} onClick={() => setScope('year')}>
        {t('stats.thisYear')}
      </button>
    </div>
  );
  const newRequestBtn = (
    <button className="btn btn-primary" onClick={() => onNewRequest()}>
      {t('views.mine.newRequest')}
    </button>
  );
  const toolbar = (
    <div className="emp-toolbar-slot">
      <CalToolbar {...nav} monthDate={monthDate} />
      <YearSelect year={year} years={years} onChange={onYearChange} />
    </div>
  );
  const statCards = (
    <div className="stats-row">
      {loading
        ? TYPE_ORDER.map((type) => <div key={type} className="skel skel-card" aria-busy="true" />)
        : TYPE_ORDER.map((type) => (
            <StatCard
              key={type}
              empId={currentUser.id}
              type={type}
              year={year}
              monthDate={monthDate}
              scope={scope}
              selected={typeFilter === type}
              dimmed={typeFilter !== null && typeFilter !== type}
              onSelect={() => setTypeFilter((prev) => (prev === type ? null : type))}
            />
          ))}
    </div>
  );
  const calendarBlock = (
    <div className="emp-cal-slot">
      {loading ? (
        <div className="skel skel-cal" aria-busy="true" />
      ) : (
        <MonthCalendar
          monthDate={monthDate}
          compact={isMobile}
          chipsFor={(k) => myChipsFor(requests, holidaysOnKey, (type) => t(absenceTypeMeta(type).labelKey), currentUser.id, k)}
          onAddDay={(k) => onAddOnDay(k)}
          onChipClick={(c) => {
            if (c.kind === 'absence') onOpenRequest(c.data as DayOffRequest);
          }}
        />
      )}
      {/* mobile: calendar bars show colour only — this legend explains them */}
      <div className="cal-legend-m"><TypeLegend /></div>
    </div>
  );
  const requestsList = (
    <>
      <div className="section-head-row">
        <h3 className="block-title">{t('views.mine.requests')}</h3>
      </div>
      {loading ? (
        <div className="card list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skel skel-row" aria-busy="true" />
          ))}
        </div>
      ) : ordered.length ? (
        <div className="card list">
          {ordered.map((r) => (
            <RequestRow key={r.id} request={r} onClick={onOpenRequest} />
          ))}
        </div>
      ) : (
        <div className="card list">
          <div className="list-empty">{t('views.mine.emptyAbsences')}</div>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="page emp-page">
        {/* top row: month nav (no "today") + month/year scope toggle */}
        <CalToolbar {...nav} monthDate={monthDate} right={statsScope} />
        <div className="emp-m-toggle">
          <Seg
            value={mobileTab}
            options={[
              { value: 'calendar', label: t('views.mine.viewCalendar') },
              { value: 'list', label: t('views.mine.viewList') },
            ]}
            onChange={setMobileTab}
          />
        </div>
        {statCards}
        {/* calendar mode: tap a day to create (no button). list mode: keep the button (no day to tap). */}
        {mobileTab === 'calendar' ? (
          calendarBlock
        ) : (
          <div className="emp-side">
            <div className="emp-m-newreq">{newRequestBtn}</div>
            {requestsList}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page emp-page">
      <div className="emp-layout">
        {/* above the calendar: today + month nav (right) ↔ year dropdown (left) */}
        {toolbar}
        {/* above the cards: month/year toggle (right of cards) ↔ new request (left) */}
        <div className="emp-stats-head-slot">
          {statsScope}
          {newRequestBtn}
        </div>
        {calendarBlock}
        <aside className="emp-side emp-side-slot">
          {statCards}
          {requestsList}
        </aside>
      </div>
    </div>
  );
}

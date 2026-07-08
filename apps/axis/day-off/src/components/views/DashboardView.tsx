/**
 * DashboardView — manager dashboard. Breakdown by time (months/quarters) and by
 * employee, with KPI cards scoped by fixed year/month dropdowns.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { ABSENCE_TYPES, TYPE_ORDER } from '../../domain/absence';
import { eachDay, fromKey, isWeekend, toKey } from '../../domain/dates';
import { useL10n } from '../../domain/useL10n';
import type { AbsenceType, DayOffRequest } from '../../domain/types';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { Avatar, ChartLegend, DropdownSelect, EmpFilter, EmptyState, KpiCard, Seg } from '../ui';
import { useIsMobile } from '../../hooks/useIsMobile';

/** Payload handed to the drill-down modal: the requests behind a clicked number. */
export interface DrillPayload {
  title: string;
  sub: string;
  requests: DayOffRequest[];
}

interface DashboardViewProps {
  year: number;
  onYearChange: (year: number) => void;
  onOpenDrill: (payload: DrillPayload) => void;
}

/* ---------- analytics helpers ---------- */
// Workday date-keys of a request that fall inside `year`.
function reqWorkdaysInYear(r: Pick<DayOffRequest, 'start' | 'end'>, year: number): string[] {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (r.end < yStart || r.start > yEnd) return [];
  const s = r.start < yStart ? yStart : r.start;
  const e = r.end > yEnd ? yEnd : r.end;
  return eachDay(s, e).filter((k) => !isWeekend(fromKey(k)));
}

interface Cell {
  a: number;
  p: number;
}
type Cells = Record<string, Cell>;

function emptyCells(order: string[]): Cells {
  const out: Cells = {};
  for (const id of order) out[id] = { a: 0, p: 0 };
  return out;
}
function cellsTotal(c: Cells, order: string[]): number {
  return order.reduce((s, t) => s + (c[t]?.a ?? 0) + (c[t]?.p ?? 0), 0);
}
function mergeCells(list: Cells[], order: string[]): Cells {
  const out = emptyCells(order);
  list.forEach((c) =>
    order.forEach((t) => {
      out[t].a += c[t]?.a ?? 0;
      out[t].p += c[t]?.p ?? 0;
    }),
  );
  return out;
}
function niceCeil(v: number): number {
  if (v <= 0) return 4;
  const step = v <= 8 ? 2 : v <= 20 ? 5 : 10;
  return Math.ceil(v / step) * step;
}

const DASHBOARD_YEAR_START = 2025;
const DASHBOARD_YEAR_END = 2040;

type TypeFilter = 'all' | string;
type KpiMonthFilter = 'all' | `${number}`;

function reqWorkdaysInRange(r: Pick<DayOffRequest, 'start' | 'end'>, start: string, end: string): string[] {
  if (r.end < start || r.start > end) return [];
  const s = r.start < start ? start : r.start;
  const e = r.end > end ? end : r.end;
  return eachDay(s, e).filter((k) => !isWeekend(fromKey(k)));
}

function rangeEndOfMonth(year: number, month: number): string {
  return toKey(new Date(year, month + 1, 0));
}

/* ============================================================
   Dashboard view
   ============================================================ */
export function DashboardView({ year, onYearChange, onOpenDrill }: DashboardViewProps) {
  const { t, monthShort, monthName } = useL10n();
  const { requests, companyDays, teamIds, myTeams, empById } = useDayOffData();
  const order = TYPE_ORDER;
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [empFilter, setEmpFilter] = useState<string>('all');
  const [kpiMonthFilter, setKpiMonthFilter] = useState<KpiMonthFilter>('all');
  const isMobile = useIsMobile();

  // The member-id universe the dashboard considers: all visible members, a
  // single team (`team:<id>`), or one employee.
  const universe = useMemo<string[]>(() => {
    if (empFilter === 'all') return teamIds;
    if (empFilter.startsWith('team:')) {
      const tm = myTeams.find((x) => x.id === empFilter.slice(5));
      return tm ? [...new Set([...tm.managers, ...tm.employees])] : teamIds;
    }
    return [empFilter];
  }, [empFilter, teamIds, myTeams]);

  // base set: members in scope, approved + pending, year, type filter
  const filteredReqs = requests.filter((r) =>
    universe.includes(r.employeeId) &&
    (r.status === 'approved' || r.status === 'pending') &&
    (typeFilter === 'all' || r.type === typeFilter) &&
    reqWorkdaysInYear(r, year).length > 0
  );

  // aggregate into month + employee cells
  const monthCells = Array.from({ length: 12 }, () => emptyCells(order));
  filteredReqs.forEach((r) => {
    reqWorkdaysInYear(r, year).forEach((k) => {
      const m = fromKey(k).getMonth();
      const st: 'a' | 'p' = r.status === 'pending' ? 'p' : 'a';
      if (!monthCells[m][r.type]) monthCells[m][r.type] = { a: 0, p: 0 };
      monthCells[m][r.type][st] += 1;
    });
  });

  const yearTotal = mergeCells(monthCells, order);
  const chartTotalDays = cellsTotal(yearTotal, order);
  const kpiMonth = kpiMonthFilter === 'all' ? null : Number(kpiMonthFilter);
  const kpiStart = kpiMonth === null ? `${year}-01-01` : `${year}-${String(kpiMonth + 1).padStart(2, '0')}-01`;
  const kpiEnd = kpiMonth === null ? `${year}-12-31` : rangeEndOfMonth(year, kpiMonth);
  // KPI scope: year OR a selected month of that year.
  const periodReqs = requests.filter((r) =>
    universe.includes(r.employeeId) &&
    (r.status === 'approved' || r.status === 'pending') &&
    (typeFilter === 'all' || r.type === typeFilter) &&
    reqWorkdaysInRange(r, kpiStart, kpiEnd).length > 0
  );
  const totalDays = periodReqs.reduce((s, r) => s + reqWorkdaysInRange(r, kpiStart, kpiEnd).length, 0);
  const pendingReqs = periodReqs.filter((r) => r.status === 'pending');
  const companyDaysTotal = companyDays.reduce((s, d) => s + reqWorkdaysInRange({ start: d.start, end: d.end }, kpiStart, kpiEnd).length, 0);

  // company-day workdays per month of `year` (separate bar in the by-time chart)
  const monthCompanyDays = Array.from({ length: 12 }, (_, m) => {
    const start = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const end = rangeEndOfMonth(year, m);
    return companyDays.reduce((s, d) => s + reqWorkdaysInRange({ start: d.start, end: d.end }, start, end).length, 0);
  });

  // chart buckets
  const buckets = monthCells.map((c, m) => ({ label: monthShort(m), cells: c, months: [m], company: monthCompanyDays[m] }));
  const maxBucket = Math.max(1, ...buckets.map((b) => Math.max(cellsTotal(b.cells, order), b.company)));
  const niceMax = niceCeil(maxBucket);
  const PLOT = 200;
  const scale = PLOT / niceMax;

  // employee rows
  const periodEmpCells: Record<string, Cells> = {};
  periodReqs.forEach((r) => {
    reqWorkdaysInRange(r, kpiStart, kpiEnd).forEach(() => {
      const st: 'a' | 'p' = r.status === 'pending' ? 'p' : 'a';
      const cells = periodEmpCells[r.employeeId] || (periodEmpCells[r.employeeId] = emptyCells(order));
      if (!cells[r.type]) cells[r.type] = { a: 0, p: 0 };
      cells[r.type][st] += 1;
    });
  });
  const empRows = universe
    .map((id) => {
      const cells = periodEmpCells[id] || emptyCells(order);
      return { id, cells, total: cellsTotal(cells, order) };
    })
    .sort((a, b) => b.total - a.total);
  const maxEmp = Math.max(1, ...empRows.map((r) => r.total));

  // ---- drill helpers ----
  function drillMonths(months: number[], label: string) {
    const set = new Set(months);
    const reqs = filteredReqs
      .filter((r) => reqWorkdaysInYear(r, year).some((k) => set.has(fromKey(k).getMonth())))
      .slice().sort((a, b) => a.start.localeCompare(b.start));
    onOpenDrill({ title: `${label} · ${year}`, sub: t('drill.requestsCount', { count: reqs.length }), requests: reqs });
  }
  function drillEmp(id: string) {
    const e = empById(id);
    const reqs = periodReqs.filter((r) => r.employeeId === id).slice().sort((a, b) => a.start.localeCompare(b.start));
    onOpenDrill({ title: `${e?.name} · ${year}`, sub: t('drill.requestsCount', { count: reqs.length }), requests: reqs });
  }

  const typeOptions = [
    { value: 'all' as const, label: t('common.all') },
    ...order.map((type) => {
      const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
      return { value: type, label: t(meta.labelKey), color: meta.color };
    }),
  ];
  const yearOptions = Array.from(
    { length: DASHBOARD_YEAR_END - DASHBOARD_YEAR_START + 1 },
    (_, i) => DASHBOARD_YEAR_START + i,
  )
    .map((y) => ({ value: y, label: String(y) }));
  const monthOptions = [
    { value: 'all' as const, label: t('views.dashboard.allYear') },
    ...Array.from({ length: 12 }, (_, idx) => ({ value: String(idx) as KpiMonthFilter, label: monthName(idx) })),
  ];

  return (
    <div className="page">
      {/* filters */}
      <div className="dash-filters dash-filters-main">
        <div className="dash-filters-side dash-filters-side--right">
          <span className="filter-label">{t('views.dashboard.filterType')}</span>
          <Seg value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
        </div>
        <div className="dash-filters-side dash-filters-side--left">
          <span className="filter-label">{t('views.dashboard.filterYear')}</span>
          <DropdownSelect
            value={year}
            options={yearOptions}
            onChange={onYearChange}
            icon="calendar"
            scrollSelectedToTopOnOpen
          />
          <span className="filter-label">{t('views.dashboard.filterMonth')}</span>
          <DropdownSelect value={kpiMonthFilter} options={monthOptions} onChange={setKpiMonthFilter} icon="calendar" />
          <EmpFilter value={empFilter} onChange={setEmpFilter} />
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <KpiCard
          label={t('views.dashboard.kpiTotal')} accent="var(--color-primary)"
          value={totalDays} unit={t('views.dashboard.kpiTotalUnit')}
        />
        <KpiCard
          label={t('views.dashboard.kpiPendingApproval')} accent="var(--color-warning)"
          value={pendingReqs.length}
        />
        <KpiCard
          label={t('views.dashboard.kpiCompanyDays')} accent="var(--color-event-holiday)"
          value={companyDaysTotal} unit={t('views.dashboard.kpiTotalUnit')}
        />
      </div>

      {/* by time */}
      <div className="card dash-card" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <div className="dash-card-head">
          <div>
            <h3>{t('views.dashboard.byTimeTitle')}</h3>
          </div>
          <ChartLegend />
        </div>
        {chartTotalDays === 0 ? (
          <EmptyState icon="chart" title={t('views.dashboard.byTimeEmptyTitle')} sub={t('views.dashboard.byTimeEmptySub')} />
        ) : isMobile ? (
          /* mobile: vertical chart — one row per bucket, horizontal normalised bar (no h-scroll) */
          <div className="bars-v">
            {buckets.map((b, i) => {
              const tot = cellsTotal(b.cells, order);
              const cd = b.company;
              const segs = order.flatMap((type) => {
                const c = b.cells[type] ?? { a: 0, p: 0 };
                const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
                const out: { k: string; w: number; color: string; pending: boolean }[] = [];
                if (c.a > 0) out.push({ k: type + 'a', w: (c.a / maxBucket) * 100, color: meta.color, pending: false });
                if (c.p > 0) out.push({ k: type + 'p', w: (c.p / maxBucket) * 100, color: meta.color, pending: true });
                return out;
              });
              const title = `${t('views.dashboard.barTitleTotal', { label: b.label, count: tot })}\n` + order.map((type) => {
                const c = b.cells[type] ?? { a: 0, p: 0 };
                const n = c.a + c.p;
                if (!n) return null;
                const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
                const label = t(meta.labelKey);
                return c.p
                  ? t('views.dashboard.barTypePending', { type: label, count: n, pending: c.p })
                  : t('views.dashboard.barTypeLine', { type: label, count: n });
              }).filter(Boolean).join(' · ');
              return (
                <button key={i} type="button" className="bar-row bar-clickable" title={title} onClick={() => drillMonths(b.months, b.label)}>
                  <span className="bar-row-label">{b.label}</span>
                  <div className="bar-row-track">
                    {segs.map((s) => (
                      <span key={s.k} className={`bar-row-seg ${s.pending ? 'pending' : ''}`} style={{ width: `${s.w}%`, background: s.color }} />
                    ))}
                  </div>
                  <span className={`bar-row-val ${tot === 0 ? 'empty' : ''}`}>{tot > 0 ? tot : ''}</span>
                  {cd > 0 && (
                    <span className="bar-row-company" title={`${t('views.dashboard.legendCompany')} · ${t('common.days', { count: cd })}`}>
                      <span className="bar-row-company-dot" />
                      {cd}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="bars">
              {buckets.map((b, i) => {
                const tot = cellsTotal(b.cells, order);
                const segs = order.flatMap((type) => {
                  const c = b.cells[type] ?? { a: 0, p: 0 };
                  const out: { k: string; h: number; color: string; pending: boolean; type: AbsenceType; count: number }[] = [];
                  const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
                  const col = meta.color;
                  if (c.a > 0) out.push({ k: type + 'a', h: c.a * scale, color: col, pending: false, type, count: c.a });
                  if (c.p > 0) out.push({ k: type + 'p', h: c.p * scale, color: col, pending: true, type, count: c.p });
                  return out;
                });
                const title = `${t('views.dashboard.barTitleTotal', { label: b.label, count: tot })}\n` + order.map((type) => {
                  const c = b.cells[type] ?? { a: 0, p: 0 };
                  const n = c.a + c.p;
                  if (!n) return null;
                  const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
                  const label = t(meta.labelKey);
                  return c.p
                    ? t('views.dashboard.barTypePending', { type: label, count: n, pending: c.p })
                    : t('views.dashboard.barTypeLine', { type: label, count: n });
                }).filter(Boolean).join(' · ');
                const cd = b.company;
                return (
                  <div key={i} className="bar-col">
                    <div className="bar-pair">
                      <button
                        type="button"
                        className="bar-one bar-clickable"
                        title={title}
                        onClick={() => drillMonths(b.months, b.label)}
                      >
                        <span className={`bar-val ${tot === 0 ? 'empty' : ''}`}>{tot > 0 ? tot : ''}</span>
                        <div className="bar-track" style={{ height: Math.max(2, tot * scale) }}>
                          {segs.map((s) => (
                            <div
                              key={s.k}
                              className={`bar-seg ${s.pending ? 'pending' : ''}`}
                              title={t('views.dashboard.barSegTooltip', {
                                type: t((ABSENCE_TYPES[s.type] ?? { labelKey: s.type }).labelKey),
                                count: s.count,
                              })}
                              style={{ height: Math.max(2, s.h), background: s.color }}
                            />
                          ))}
                        </div>
                      </button>
                      <div
                        className="bar-one"
                        title={`${t('views.dashboard.legendCompany')} · ${t('common.days', { count: cd })}`}
                      >
                        <span className={`bar-val ${cd === 0 ? 'empty' : ''}`}>{cd > 0 ? cd : ''}</span>
                        <div className="bar-track" style={{ height: Math.max(2, cd * scale) }}>
                          <div className="bar-seg" style={{ height: Math.max(2, cd * scale), background: 'var(--color-event-holiday)' }} />
                        </div>
                      </div>
                    </div>
                    <span className="bar-x">{b.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="bars-baseline" />
          </>
        )}
      </div>

      {/* by employee */}
      <div className="dash-2col">
        <div className="card dash-card">
          <div className="dash-card-head">
            <div>
              <h3>{t('views.dashboard.byEmpTitle')}</h3>
            </div>
          </div>
          {empRows.some((r) => r.total > 0) ? (
            <div className="emp-bars">
              {empRows.map((row) => {
                const e = empById(row.id);
                return (
                  <div key={row.id} className="emp-row" onClick={() => drillEmp(row.id)}>
                    <div className="emp-name"><Avatar emp={e} size="sm" /><span>{e?.name}</span></div>
                    <div className="emp-bar">
                      {order.flatMap((type) => {
                        const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
                        const c = row.cells[type], col = meta.color, label = t(meta.labelKey), out: ReactElement[] = [];
                        const segTitle = `${label} | ${t('common.days', { count: c.a + c.p })}`
                          + (c.p > 0 ? ` | ${t('views.dashboard.barPendingCount', { count: c.p })}` : '');
                        if (c.a > 0) out.push(<div key={type + 'a'} className="emp-seg" title={segTitle} style={{ width: (c.a / maxEmp * 100) + '%', background: col }} />);
                        if (c.p > 0) out.push(<div key={type + 'p'} className="emp-seg pending" title={segTitle} style={{ width: (c.p / maxEmp * 100) + '%', background: col }} />);
                        return out;
                      })}
                    </div>
                    <div className="emp-total"><b>{row.total}</b> {t('balance.miniDays')}</div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState icon="users" title={t('views.dashboard.byEmpEmptyTitle')} sub={t('views.dashboard.byEmpEmptySub')} />}
        </div>
      </div>
    </div>
  );
}

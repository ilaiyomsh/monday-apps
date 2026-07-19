// Pure aggregation for the discussions dashboard (round152; period model +
// drill-down lists added round154). All of the dashboard's business logic lives
// here — the time-period model, dimension filtering, the metrics, the
// sum/avg/median toggle, and the per-bucket / per-type discussion lists that
// drive click-to-drill-down — so it is unit-testable independently of recharts.
//
// Data shapes (produced by useDashboardData, kept parse-close to the boards):
//   discussion: { id, name, date: Date|null, type: string|null,
//                 lead: [{id,name}], participants: [{id,name}] }
//   task:       { id, discussionId: string|null, statusID: number|null, deadlineID: Date|null }
//   decision:   { id, discussionId: string|null }
// `doneStatusIds` is the Set<number> of task-status label ids that count as done.

import { isDelayed, startOfToday } from '../EffectivenessTab/effectiveness.js';

export const RANGE_PRESETS = ['day', 'week', 'month', 'quarter', 'year', 'custom'];
export const AGG_MODES = ['sum', 'avg', 'median'];

const MONTHS_HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

// The time-pill picks BOTH the bar-chart granularity AND how many trailing
// buckets are shown (owner spec round154: week→weeks, month→months, …; the
// dashboard opens on 'day' since round158). Custom buckets by month across the
// chosen range.
export const PERIOD_CONFIG = {
  day: { unit: 'day', count: 7, axis: 'לפי יום' },
  week: { unit: 'week', count: 8, axis: 'לפי שבוע' },
  month: { unit: 'month', count: 12, axis: 'לפי חודש' },
  quarter: { unit: 'quarter', count: 8, axis: 'לפי רבעון' },
  year: { unit: 'year', count: 5, axis: 'לפי שנה' },
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
const pad = (n) => String(n).padStart(2, '0');

// Start of the unit containing `d` (local). Week starts Sunday (he-IL).
function startOfUnit(d, unit) {
  const x = startOfDay(d);
  if (unit === 'week') { x.setDate(x.getDate() - x.getDay()); return x; }
  if (unit === 'month') return new Date(x.getFullYear(), x.getMonth(), 1);
  if (unit === 'quarter') return new Date(x.getFullYear(), Math.floor(x.getMonth() / 3) * 3, 1);
  if (unit === 'year') return new Date(x.getFullYear(), 0, 1);
  return x;
}
function addUnits(d, unit, n) {
  const x = new Date(d);
  if (unit === 'day') x.setDate(x.getDate() + n);
  else if (unit === 'week') x.setDate(x.getDate() + n * 7);
  else if (unit === 'month') x.setMonth(x.getMonth() + n);
  else if (unit === 'quarter') x.setMonth(x.getMonth() + n * 3);
  else if (unit === 'year') x.setFullYear(x.getFullYear() + n);
  return x;
}
function keyOf(d, unit) {
  const s = startOfUnit(d, unit);
  if (unit === 'day' || unit === 'week') return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  if (unit === 'month') return `${s.getFullYear()}-${pad(s.getMonth() + 1)}`;
  if (unit === 'quarter') return `${s.getFullYear()}-Q${Math.floor(s.getMonth() / 3) + 1}`;
  return `${s.getFullYear()}`;
}
function labelOf(start, unit) {
  const yy = String(start.getFullYear()).slice(2);
  if (unit === 'day' || unit === 'week') return `${pad(start.getDate())}/${pad(start.getMonth() + 1)}`;
  if (unit === 'month') return `${MONTHS_HE[start.getMonth()]} ${yy}`;
  if (unit === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1}/${yy}`;
  return `${start.getFullYear()}`;
}

/**
 * The period model for a preset: { from, to, unit, buckets }. Each bucket is
 * { key, label, start }. week/month/quarter/year show a trailing run of buckets
 * (PERIOD_CONFIG.count) ending with the one containing `now`; 'custom' buckets by
 * month across [custom.from, custom.to] (falling back to the trailing year).
 */
export function buildPeriods(preset, now = new Date(), custom = null) {
  if (preset === 'custom') {
    const from = custom?.from ? startOfUnit(custom.from, 'month') : startOfUnit(addUnits(now, 'year', -1), 'month');
    const toDate = custom?.to ? custom.to : now;
    const buckets = [];
    let cur = from;
    const lastStart = startOfUnit(toDate, 'month');
    while (cur <= lastStart) {
      buckets.push({ key: keyOf(cur, 'month'), label: labelOf(cur, 'month'), start: cur });
      cur = addUnits(cur, 'month', 1);
    }
    return { from, to: endOfDay(toDate), unit: 'month', buckets };
  }
  const { unit, count } = PERIOD_CONFIG[preset] || PERIOD_CONFIG.month;
  const anchor = startOfUnit(now, unit);
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addUnits(anchor, unit, -i);
    buckets.push({ key: keyOf(start, unit), label: labelOf(start, unit), start });
  }
  return { from: buckets[0].start, to: endOfDay(now), unit, buckets };
}

/** sum / mean(1dp) / median of a numeric array, per the toggle. Empty → 0. */
export function summarize(values, mode) {
  if (!values.length) return 0;
  if (mode === 'avg') {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.round(mean * 10) / 10;
  }
  if (mode === 'median') {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return Math.round(m * 10) / 10;
  }
  return values.reduce((a, b) => a + b, 0); // sum (default)
}

function hasPerson(arr, id) {
  return Array.isArray(arr) && arr.some((p) => String(p?.id) === String(id));
}

// A light discussion projection for the drill-down lists.
const proj = (d) => ({ id: String(d.id), name: d.name, date: d.date });

/**
 * The dashboard model. Filters discussions by period + lead + type + participant,
 * scopes tasks/decisions to the surviving discussions, and returns every metric,
 * chart series, AND the discussion list behind each period bucket / type slice.
 */
export function aggregateDashboard(raw = {}, opts = {}) {
  const { discussions = [], tasks = [], decisions = [], doneStatusIds = new Set() } = raw;
  const {
    preset = 'day', now = new Date(), custom = null,
    leadId = null, typeValue = null, participantId = null, mode = 'sum',
  } = opts;

  const { from, to, unit, buckets } = buildPeriods(preset, now, custom);
  const inRange = (d) => d instanceof Date && !Number.isNaN(d.getTime()) && d >= from && d <= to;

  const scoped = discussions.filter((d) =>
    inRange(d.date)
    && (leadId == null || hasPerson(d.lead, leadId))
    && (typeValue == null || d.type === typeValue)
    && (participantId == null || hasPerson(d.participants, participantId))
  );
  const idSet = new Set(scoped.map((d) => String(d.id)));

  const scopedTasks = tasks.filter((t) => t.discussionId != null && idSet.has(String(t.discussionId)));
  const scopedDecisions = decisions.filter((d) => d.discussionId != null && idSet.has(String(d.discussionId)));

  // Per-discussion counts (drive the sum/avg/median metrics).
  const decByDisc = {};
  scopedDecisions.forEach((d) => { const k = String(d.discussionId); decByDisc[k] = (decByDisc[k] || 0) + 1; });
  const taskByDisc = {};
  scopedTasks.forEach((t) => { const k = String(t.discussionId); taskByDisc[k] = (taskByDisc[k] || 0) + 1; });

  const decCounts = scoped.map((d) => decByDisc[String(d.id)] || 0);
  const taskCounts = scoped.map((d) => taskByDisc[String(d.id)] || 0);
  const partCounts = scoped.map((d) => (Array.isArray(d.participants) ? d.participants.length : 0));

  // Effectiveness (deadline-based, reusing the tested EffectivenessTab logic).
  const today = startOfToday(now);
  const done = scopedTasks.filter((t) => t.statusID != null && doneStatusIds.has(Number(t.statusID))).length;
  const delayed = scopedTasks.filter((t) => isDelayed(t, doneStatusIds, today)).length;
  const totalTasks = scopedTasks.length;
  const effectivenessPct = totalTasks ? Math.round((done / totalTasks) * 100) : 0;

  // Bar chart — discussions per period bucket, continuous & zero-filled, each
  // carrying the discussion list that composes it (drill-down).
  const bucketByKey = Object.fromEntries(buckets.map((b) => [b.key, { key: b.key, label: b.label, count: 0, items: [] }]));
  scoped.forEach((d) => {
    const b = bucketByKey[keyOf(d.date, unit)];
    if (b) { b.count += 1; b.items.push(proj(d)); }
  });
  const byPeriod = buckets.map((b) => bucketByKey[b.key]);

  // Donut — discussions per type, each carrying its discussion list (drill-down).
  const typeMap = {};
  scoped.forEach((d) => {
    const k = d.type || 'ללא סוג';
    if (!typeMap[k]) typeMap[k] = { label: k, count: 0, items: [] };
    typeMap[k].count += 1;
    typeMap[k].items.push(proj(d));
  });
  const byType = Object.values(typeMap).sort((a, b) => b.count - a.count);

  // Top participants — people by number of discussions attended (top 5).
  const partMap = {};
  scoped.forEach((d) => (Array.isArray(d.participants) ? d.participants : []).forEach((p) => {
    const k = String(p.id);
    if (!partMap[k]) partMap[k] = { id: k, name: p.name || k, count: 0 };
    partMap[k].count += 1;
  }));
  const byParticipant = Object.values(partMap).sort((a, b) => b.count - a.count).slice(0, 5);

  return {
    range: { from, to },
    unit,
    axisLabel: (PERIOD_CONFIG[preset] || {}).axis || 'לפי חודש',
    mode,
    totalDiscussions: scoped.length,
    decisionsPerDiscussion: summarize(decCounts, mode),
    tasksPerDiscussion: summarize(taskCounts, mode),
    participations: summarize(partCounts, mode),
    effectiveness: { pct: effectivenessPct, done, delayed, total: totalTasks },
    byPeriod,
    byType,
    byParticipant,
  };
}

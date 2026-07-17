// Pure aggregation for the discussions dashboard (round152). All of the
// dashboard's business logic lives here — time-range bounds, dimension
// filtering, the seven metrics, and the sum/avg/median toggle — so it is
// unit-testable independently of recharts/React.
//
// Data shapes (produced by useDashboardData, kept parse-close to the boards):
//   discussion: { id, name, date: Date|null, type: string|null,
//                 lead: [{id,name}], participants: [{id,name}] }
//   task:       { id, discussionId: string|null, statusID: number|null, deadlineID: Date|null }
//   decision:   { id, discussionId: string|null }
// `doneStatusIds` is the Set<number> of task-status label ids that count as done
// (same definition the EffectivenessTab uses).

import { isDelayed, startOfToday } from '../EffectivenessTab/effectiveness.js';

export const RANGE_PRESETS = ['week', 'month', 'quarter', 'year', 'custom'];
export const AGG_MODES = ['sum', 'avg', 'median'];

const MONTHS_HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/**
 * Trailing-window bounds for a range preset, anchored to `now`. week = last 7
 * days (inclusive); month/quarter/year subtract 1/3/12 months. `custom` wins
 * when preset==='custom' and both ends are present. Returns { from, to } as
 * local Date bounds (from at 00:00, to at 23:59:59).
 */
export function rangeBounds(preset, now = new Date(), custom = null) {
  const to = endOfDay(now);
  if (preset === 'custom') {
    if (custom?.from && custom?.to) return { from: startOfDay(custom.from), to: endOfDay(custom.to) };
    // no valid custom range yet → fall back to the trailing month
    preset = 'month';
  }
  const from = startOfDay(now);
  if (preset === 'week') {
    from.setDate(from.getDate() - 6);
  } else if (preset === 'month') {
    from.setMonth(from.getMonth() - 1);
  } else if (preset === 'quarter') {
    from.setMonth(from.getMonth() - 3);
  } else if (preset === 'year') {
    from.setFullYear(from.getFullYear() - 1);
  }
  return { from, to };
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

// Continuous 'YYYY-MM' buckets spanning [from, to], each with a Hebrew label —
// so the bar chart shows every month in range, zero-filled where empty.
function monthBuckets(from, to) {
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: `${MONTHS_HE[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`, count: 0 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/**
 * The dashboard model. Filters discussions by range + lead + type + participant,
 * scopes tasks/decisions to the surviving discussions, and returns every metric
 * and chart series variant B renders.
 */
export function aggregateDashboard(raw = {}, opts = {}) {
  const { discussions = [], tasks = [], decisions = [], doneStatusIds = new Set() } = raw;
  const {
    preset = 'month', now = new Date(), custom = null,
    leadId = null, typeValue = null, participantId = null, mode = 'sum',
  } = opts;

  const { from, to } = rangeBounds(preset, now, custom);
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

  // Bar chart — discussions per month, continuous & zero-filled.
  const buckets = monthBuckets(from, to);
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  scoped.forEach((d) => {
    const k = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, '0')}`;
    if (byKey[k]) byKey[k].count += 1;
  });

  // Donut — discussions per type.
  const typeMap = {};
  scoped.forEach((d) => { const k = d.type || 'ללא סוג'; typeMap[k] = (typeMap[k] || 0) + 1; });
  const byType = Object.entries(typeMap)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Top participants — people by number of discussions attended (top 5 + Other).
  const partMap = {};
  scoped.forEach((d) => (Array.isArray(d.participants) ? d.participants : []).forEach((p) => {
    const k = String(p.id);
    if (!partMap[k]) partMap[k] = { id: k, name: p.name || k, count: 0 };
    partMap[k].count += 1;
  }));
  const rankedParticipants = Object.values(partMap).sort((a, b) => b.count - a.count);
  const byParticipant = rankedParticipants.slice(0, 5);

  return {
    range: { from, to },
    mode,
    totalDiscussions: scoped.length,
    decisionsPerDiscussion: summarize(decCounts, mode),
    tasksPerDiscussion: summarize(taskCounts, mode),
    participations: summarize(partCounts, mode),
    effectiveness: { pct: effectivenessPct, done, delayed, total: totalTasks },
    byMonth: buckets,
    byType,
    byParticipant,
  };
}

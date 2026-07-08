// Pure derivation logic for the EffectivenessTab KPIs — kept out of the
// component so the business definition of "delayed" is unit-testable.

export const NO_STATUS_KEY = '__none__';

// The "בעיכוב" (delayed) KPI is COMPUTED (deadline-based), not a status label —
// it gets a dedicated dark red that deliberately does not exist in monday's
// status palette (stuck red #e2445c, dark red #bb3354), so it can't be mistaken
// for a real status.
export const DELAYED_COLOR = '#7d1128';
export const DELAYED_LABEL = 'בעיכוב';

// Local midnight. Deadline comparisons are DATE-only — a deadline's time part
// never matters; a task becomes delayed only from the following day.
export function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Which status label ids mean "done" for the delayed KPI: the owner-picked set
// (settings.preferences.delayedDoneStatusIds), falling back to the status
// column's own is_done label. Label id 0 is valid — no truthiness checks.
export function resolveDoneStatusIds(prefIds, doneId) {
  if (Array.isArray(prefIds) && prefIds.length > 0) return new Set(prefIds.map(Number));
  return new Set(doneId != null ? [Number(doneId)] : []);
}

// delayed = has a deadline, that deadline's DAY is before today, and the task's
// status is not in the "done" set. No deadline → never delayed.
export function isDelayed(task, doneStatusIds, todayStart) {
  const d = task?.deadlineID;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  if (task.statusID != null && doneStatusIds.has(Number(task.statusID))) return false;
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day < todayStart;
}

// Count tasks whose status is in the "done" set (used by the "בוצעו" KPI card).
export function countDone(items, doneStatusIds) {
  return items.filter((t) => t.statusID != null && doneStatusIds.has(Number(t.statusID))).length;
}

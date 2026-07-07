/**
 * Absence-type runtime config + balance analytics (pure).
 * Personal absence types are dynamic and derived from monday status labels.
 */
import type { PersonalTypeOption, StatusValueMap } from '../types';
import type { AbsenceType, Balance, DayOffRequest, Entitlement, RequestStatus } from './types';
import { eachDay, fromKey, isWeekend, workdaysBetween } from './dates';

export interface AbsenceTypeMeta {
  id: string;
  /** Display text (for legacy keys this can still be an i18n key). */
  labelKey: string;
  /** Chip/legend color. */
  color: string;
  /** monday status index of this label. */
  index: number;
}

const DEFAULT_ABSENCE_TYPES: AbsenceTypeMeta[] = [
  { id: 'vacation', labelKey: 'types.vacation', color: 'var(--color-event-vacation)', index: 1 },
  { id: 'sick', labelKey: 'types.sick', color: 'var(--color-event-sick)', index: 2 },
  { id: 'reserves', labelKey: 'types.reserves', color: 'var(--color-event-reserves)', index: 3 },
];

export let TYPE_ORDER: AbsenceType[] = DEFAULT_ABSENCE_TYPES.map((t) => t.id);
export let ABSENCE_TYPES: Record<string, AbsenceTypeMeta> = Object.fromEntries(
  DEFAULT_ABSENCE_TYPES.map((t) => [t.id, t]),
);

/** Safe lookup — requests may still reference a type removed from settings. */
export function absenceTypeMeta(type: string): AbsenceTypeMeta {
  return ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
}

/** Icon name (see src/components/ui/Icon) per absence type. */
export const TYPE_ICON: Record<string, string> = {
  vacation: 'plane',
  sick: 'alert',
  reserves: 'briefcase',
};

/**
 * Apply a new runtime personal-types snapshot from settings.
 * We keep this mutable to avoid threading type metadata through every prop chain.
 */
export function applyRuntimeAbsenceTypes(options: PersonalTypeOption[]): void {
  const valid = options
    .filter((opt) => opt.id.trim() !== '')
    .sort((a, b) => a.index - b.index)
    .map((opt) => ({
      id: opt.id,
      labelKey: opt.title,
      color: opt.color || 'var(--color-event-vacation)',
      index: opt.index,
    }));
  if (!valid.length) {
    TYPE_ORDER = DEFAULT_ABSENCE_TYPES.map((t) => t.id);
    ABSENCE_TYPES = Object.fromEntries(DEFAULT_ABSENCE_TYPES.map((t) => [t.id, t]));
    return;
  }
  TYPE_ORDER = valid.map((t) => t.id);
  ABSENCE_TYPES = Object.fromEntries(valid.map((t) => [t.id, t]));
}

/** i18n keys for status labels. */
export const STATUS_LABEL_KEY: Record<RequestStatus, string> = {
  pending: 'status.pending',
  approved: 'status.approved',
  rejected: 'status.rejected',
};

const STATUS_FALLBACK_COLOR: Record<RequestStatus, string> = {
  pending: 'var(--color-warning)',
  approved: 'var(--color-approval-green)',
  rejected: 'var(--color-danger)',
};

function normalizeStatusLabel(label: string | undefined | null): string {
  return (label ?? '').trim().toLowerCase();
}

/** Resolve UI color for a request status from settings label mapping + column snapshot. */
export function resolveStatusColor(
  status: RequestStatus,
  statusValues: StatusValueMap,
  approvalStatusTypes: PersonalTypeOption[],
): string {
  const mapped = normalizeStatusLabel(statusValues[status]);
  if (mapped) {
    const hit = approvalStatusTypes.find((opt) => normalizeStatusLabel(opt.title) === mapped);
    if (hit?.color) return hit.color;
  }
  return STATUS_FALLBACK_COLOR[status];
}

/** Year a request is attributed to (its start year) — matches the prototype's balance logic. */
export function requestYear(r: Pick<DayOffRequest, 'start'>): number {
  return Number(r.start.slice(0, 4));
}

/** Sum of pending workdays for (employee × type × year). */
export function pendingDaysFor(requests: DayOffRequest[], employeeId: string, type: AbsenceType, year: number): number {
  return requests
    .filter((r) => r.employeeId === employeeId && r.type === type && r.status === 'pending' && requestYear(r) === year)
    .reduce((s, r) => s + workdaysBetween(r.start, r.end), 0);
}

/**
 * Balance for (employee × type × year). `entitled` from the entitlements board;
 * `used` = approved workdays; `pending` = pending workdays. (Attributed by start year.)
 */
export function computeBalance(
  requests: DayOffRequest[],
  entitlements: Entitlement[],
  employeeId: string,
  type: AbsenceType,
  year: number,
): Balance {
  const ent = entitlements.find((e) => e.employeeId === employeeId && e.type === type && e.year === year);
  const mine = requests.filter((r) => r.employeeId === employeeId && r.type === type && requestYear(r) === year);
  const used = mine.filter((r) => r.status === 'approved').reduce((s, r) => s + workdaysBetween(r.start, r.end), 0);
  const pending = mine.filter((r) => r.status === 'pending').reduce((s, r) => s + workdaysBetween(r.start, r.end), 0);
  return { entitled: ent?.entitled ?? 0, used, pending };
}

/** Workday day-keys of a request that fall inside `year` (clipped) — for the dashboard breakdown. */
export function reqWorkdayKeysInYear(r: DayOffRequest, year: number): string[] {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (r.end < yStart || r.start > yEnd) return [];
  const s = r.start < yStart ? yStart : r.start;
  const e = r.end > yEnd ? yEnd : r.end;
  return eachDay(s, e).filter((k) => !isWeekend(fromKey(k)));
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { mondayService } from '../services/mondayService';
import { addDaysToDayKey, isDayKey } from '../utils/dateUtils';
import type { PlannerSettings } from '../types/settings.types';
import type { AbsencesByEmployee, EmployeeAbsence } from '../types/entities/holiday.types';
import { logger } from '../utils/Logger';

interface Options {
  enabled: boolean;
  settings?: PlannerSettings | null;
  startDate: Date;
  endDate: Date;
}

export interface UseEmployeeAbsencesResult {
  absencesByEmployee: AbsencesByEmployee;
  isLoading: boolean;
  error: string | null;
}

const EMPTY_MAP: AbsencesByEmployee = new Map();

/** Minimal raw monday column-value shape this hook reads (both sources). */
interface RawColumnValue {
  id: string;
  text?: string | null;
  /** Status columns: the stable label ID (monday calls it `index`). */
  index?: number | string | null;
  persons_and_teams?: Array<{ id: number | string }>;
}

/** Minimal raw monday item shape returned by both fetches. */
interface RawAbsenceItem {
  id: string;
  name?: string;
  column_values?: RawColumnValue[];
}

const extractEmployeeId = (col: RawColumnValue | undefined): string | undefined => {
  const persons = col?.persons_and_teams;
  if (Array.isArray(persons) && persons.length > 0) {
    return String(persons[0]?.id ?? '') || undefined;
  }
  return undefined;
};

/** The settings slice the Day-off expansion reads (W3.1 dayOff* block). */
interface DayOffExpandConfig {
  employeeColId?: string;
  startColId?: string;
  endColId?: string;
  kindColId?: string;
  kindPersonalLabelId?: string;
  kindGeneralLabelId?: string;
  typeColId?: string;
  approvalRequired: boolean;
  approvalColId?: string;
  approvedLabelIds: string[];
  rejectedLabelIds: string[];
}

/**
 * Expands Day-off vacations-board items (raw monday items, already
 * overlap-filtered by `fetchDayOffsForRange`) into per-day absence entries,
 * per the normative algorithm in `Day-off/CONTRACT.md` §6:
 *
 * - kind resolved by LABEL ID first (`dayOffKindPersonalLabelId` /
 *   `dayOffKindGeneralLabelId`); unknown/empty/unmapped kind falls back to the
 *   contract §2 rule: personal iff the person column is non-empty. A NON-empty
 *   kind label matching neither configured ID is settings drift — warn-logged
 *   (once per fetch, with a count) while the fallback keeps the item visible.
 * - **personal items only** — general entries belong to the company-holiday
 *   channel (`holidaysByDate`, W3.4), never to the per-employee absence map.
 * - approval policy per D2 (AMENDED 2026-06-10 / DEV-2): items whose approval
 *   label ID ∈ `dayOffRejectedLabelIds` are excluded ALWAYS, toggle ON or OFF
 *   (rejected stays visible only inside Day-off). Then, when
 *   `dayOffApprovalRequired` is ON, only items whose approval label ID ∈
 *   `dayOffApprovedLabelIds` count (empty approval = semantic pending = not
 *   approved); when OFF, all remaining personal items count.
 * - each item's inclusive [start..end] range is expanded into one entry per
 *   CALENDAR day, clipped to [max(start,windowStart) .. min(end,windowEnd)].
 *   Weekends/holidays are NOT skipped here — day classification stays
 *   authoritative in `useAvailability`'s buildDayInfo priority chain (§6.3).
 * - the `workdays` column is NEVER read (§6.4 — informational only).
 * - `classification` gets the type label TEXT — display-only; the type set is
 *   open per D1 and logic must never branch on it.
 * - each entry also carries (W3.5): `sourceItemId` (the vacations-board item
 *   id), `typeLabelId` (the personalType label ID — the structured type key),
 *   and `approved` (approval label ID ∈ approved set; undefined when no
 *   approval column / approved set is mapped — informational under D2-OFF,
 *   guaranteed `true` on every entry that survives a D2-ON filter).
 */
const expandDayOffItemsInto = (
  items: RawAbsenceItem[],
  cfg: DayOffExpandConfig,
  windowStart: string,
  windowEnd: string,
  into: AbsencesByEmployee
): void => {
  const approvedSet = new Set(cfg.approvedLabelIds);
  const rejectedSet = new Set(cfg.rejectedLabelIds);
  let kindDriftCount = 0;
  let sampleDriftLabel = '';

  for (const item of items) {
    const cols: RawColumnValue[] = item?.column_values || [];
    const findCol = (id?: string) => (id ? cols.find((c) => c.id === id) : undefined);

    const empId = extractEmployeeId(findCol(cfg.employeeColId));

    // Kind: ID-first, then the contract §2 person-presence fallback.
    const kindCol = findCol(cfg.kindColId);
    const kindLabelId = kindCol?.index != null ? String(kindCol.index) : '';
    let isPersonal: boolean;
    if (kindLabelId && cfg.kindPersonalLabelId && kindLabelId === cfg.kindPersonalLabelId) {
      isPersonal = true;
    } else if (kindLabelId && cfg.kindGeneralLabelId && kindLabelId === cfg.kindGeneralLabelId) {
      isPersonal = false;
    } else {
      if (kindLabelId) {
        // Non-empty kind matching nothing configured = settings drift (loud in logs).
        kindDriftCount++;
        sampleDriftLabel = kindLabelId;
      }
      isPersonal = !!empId;
    }
    if (!isPersonal) continue; // general → holidaysByDate channel (W3.4), not this map
    if (!empId) continue; // personal entry without a person cannot join — skip (contract §2: skip, never guess)

    // Approval (D2). `approved` is resolvable only when an approval column AND
    // a non-empty approved-label set are mapped; otherwise it stays undefined
    // (unknown — never guess). Empty approval value = semantic pending = not
    // approved (CONTRACT.md §3). When the policy toggle is ON, non-approved
    // items are filtered out (so every surviving entry has approved === true);
    // when OFF, all personal items count and `approved` is informational.
    const approvalCol = findCol(cfg.approvalColId);
    const approvalLabelId = approvalCol?.index != null ? String(approvalCol.index) : '';
    // DEV-2 (D2 amendment, 2026-06-10): rejected is excluded regardless of the
    // policy toggle. Without a rejected mapping the exclusion is impossible —
    // documented degradation (CONTRACT.md §5.2): map it even when the policy
    // is OFF.
    if (cfg.approvalColId && approvalLabelId && rejectedSet.has(approvalLabelId)) continue;
    const approved: boolean | undefined =
      cfg.approvalColId && approvedSet.size > 0 ? approvedSet.has(approvalLabelId) : undefined;
    if (cfg.approvalRequired && approved !== true) continue; // pending / empty / unknown → not approved

    // Dates were validated by the fetch's overlap filter; re-guard cheaply.
    const start = (findCol(cfg.startColId)?.text || '').trim();
    const end = (findCol(cfg.endColId)?.text || '').trim();
    if (!isDayKey(start) || !isDayKey(end)) continue;

    // Structured type (W3.5): label ID = the type key; text = display-only.
    const typeCol = findCol(cfg.typeColId);
    const classification = typeCol?.text || undefined;
    const typeLabelId = typeCol?.index != null ? String(typeCol.index) : undefined;

    // §6.2 expansion: clip to the window, inclusive on both ends, ALL calendar
    // days (day-keys compare lexicographically). Inverted/disjoint ⇒ no-op.
    const from = start > windowStart ? start : windowStart;
    const to = end < windowEnd ? end : windowEnd;
    if (from > to) continue;

    let perEmployee = into.get(empId);
    if (!perEmployee) {
      perEmployee = new Map<string, EmployeeAbsence>();
      into.set(empId, perEmployee);
    }
    for (let day = from; day <= to; day = addDaysToDayKey(day, 1)) {
      perEmployee.set(day, {
        employeeId: empId,
        date: day,
        classification,
        sourceItemId: item.id,
        approved,
        typeLabelId,
      });
    }
  }

  if (kindDriftCount > 0) {
    logger.warn(
      `[useEmployeeAbsences] ${kindDriftCount} day-off item(s) carry a kind label matching neither configured kind label ID (sample: "${sampleDriftLabel}") — settings drift? Falling back to person-presence (CONTRACT.md §2)`
    );
  }
};

/**
 * THE single producer of `AbsencesByEmployee` — reduces absence rows for the
 * visible range to a map of `employeeId -> dateKey -> EmployeeAbsence`.
 * Consumers: GanttProvider → useAvailability.
 *
 * SOLE source (the legacy Time Logs single-date path was removed — Day-off is
 * the single source of truth for personal absences): the Day-off vacations
 * board (`dayOff*` settings, `Day-off/CONTRACT.md`), active iff `dayOffBoardId`
 * is set; range items expanded per-day — see `expandDayOffItemsInto`. A
 * half-configured dayOff mapping fails loudly (`error='dayoff_misconfigured'` +
 * logger.error), never a silent EMPTY_MAP.
 *
 * Within a window re-read the data is REPLACED (hard-deleted cancellations
 * leave no tombstone — CONTRACT.md §7).
 */
export const useEmployeeAbsences = ({ enabled, settings, startDate, endDate }: Options): UseEmployeeAbsencesResult => {
  const [absencesByEmployee, setAbsencesByEmployee] = useState<AbsencesByEmployee>(EMPTY_MAP);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKeyRef = useRef<string>('');

  const startKey = useMemo(() => format(startDate, 'yyyy-MM-dd'), [startDate]);
  const endKey = useMemo(() => format(endDate, 'yyyy-MM-dd'), [endDate]);

  // Day-off vacations-board source (W3.1 settings block) — the only source.
  const dayOffBoardId = settings?.dayOffBoardId;
  const dayOffEmployeeColId = settings?.dayOffEmployeeColumnId;
  const dayOffStartColId = settings?.dayOffStartDateColumnId;
  const dayOffEndColId = settings?.dayOffEndDateColumnId;
  const dayOffKindColId = settings?.dayOffKindColumnId;
  const dayOffKindPersonalLabelId = settings?.dayOffKindPersonalLabelId;
  const dayOffKindGeneralLabelId = settings?.dayOffKindGeneralLabelId;
  const dayOffTypeColId = settings?.dayOffTypeColumnId;
  const dayOffApprovalRequired = settings?.dayOffApprovalRequired === true;
  const dayOffApprovalColId = settings?.dayOffApprovalColumnId;
  const dayOffApprovedLabelIds = useMemo(
    () => settings?.dayOffApprovedLabelIds || [],
    [settings?.dayOffApprovedLabelIds]
  );
  const dayOffApprovedKey = useMemo(() => dayOffApprovedLabelIds.join(','), [dayOffApprovedLabelIds]);
  const dayOffRejectedLabelIds = useMemo(
    () => settings?.dayOffRejectedLabelIds || [],
    [settings?.dayOffRejectedLabelIds]
  );
  const dayOffRejectedKey = useMemo(() => dayOffRejectedLabelIds.join(','), [dayOffRejectedLabelIds]);

  useEffect(() => {
    const dayOffConfigured = !!dayOffBoardId;

    if (!enabled || !dayOffConfigured) {
      setAbsencesByEmployee(EMPTY_MAP);
      // Reset cache so a later re-enable triggers a fresh fetch — without this,
      // switching from a disabled tab back to an enabled one would early-return
      // because the cacheKey still matches the last successful fetch.
      lastKeyRef.current = '';
      return;
    }

    // A configured-but-incomplete dayOff mapping must fail loudly (CONTRACT.md
    // §5.6) — never a silent empty read. User-visible settings validation is
    // W3.7's surface; here we log + error and skip the read.
    const dayOffMissing: string[] = [];
    if (!dayOffEmployeeColId) dayOffMissing.push('dayOffEmployeeColumnId');
    if (!dayOffStartColId) dayOffMissing.push('dayOffStartDateColumnId');
    if (!dayOffEndColId) dayOffMissing.push('dayOffEndDateColumnId');
    if (dayOffApprovalRequired) {
      if (!dayOffApprovalColId) dayOffMissing.push('dayOffApprovalColumnId');
      if (dayOffApprovedLabelIds.length === 0) dayOffMissing.push('dayOffApprovedLabelIds');
    }
    const dayOffReady = dayOffMissing.length === 0;

    const cacheKey = [
      dayOffBoardId,
      dayOffEmployeeColId,
      dayOffStartColId,
      dayOffEndColId,
      dayOffKindColId,
      dayOffKindPersonalLabelId,
      dayOffKindGeneralLabelId,
      dayOffTypeColId,
      String(dayOffApprovalRequired),
      dayOffApprovalColId,
      dayOffApprovedKey,
      dayOffRejectedKey,
      startKey,
      endKey,
    ].join('|');
    if (cacheKey === lastKeyRef.current) return;

    let cancelled = false;
    setIsLoading(true);
    if (!dayOffReady) {
      logger.error(
        `[useEmployeeAbsences] day-off absence source is half-configured — missing: ${dayOffMissing.join(', ')}. Refusing to read the vacations board (CONTRACT.md §5.6 — no silent empty reads).`
      );
      setError('dayoff_misconfigured');
      setAbsencesByEmployee(EMPTY_MAP);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setError(null);

    mondayService
      .fetchDayOffsForRange(dayOffBoardId!, startKey, endKey, {
        dayOffEmployeeColumnId: dayOffEmployeeColId,
        dayOffStartDateColumnId: dayOffStartColId,
        dayOffEndDateColumnId: dayOffEndColId,
        dayOffKindColumnId: dayOffKindColId,
        dayOffTypeColumnId: dayOffTypeColId,
        dayOffApprovalColumnId: dayOffApprovalColId,
      })
      .then((dayOffItems: RawAbsenceItem[]) => {
        if (cancelled) return;
        const next: AbsencesByEmployee = new Map();
        expandDayOffItemsInto(
          dayOffItems,
          {
            employeeColId: dayOffEmployeeColId,
            startColId: dayOffStartColId,
            endColId: dayOffEndColId,
            kindColId: dayOffKindColId,
            kindPersonalLabelId: dayOffKindPersonalLabelId,
            kindGeneralLabelId: dayOffKindGeneralLabelId,
            typeColId: dayOffTypeColId,
            approvalRequired: dayOffApprovalRequired,
            approvalColId: dayOffApprovalColId,
            approvedLabelIds: dayOffApprovedLabelIds,
            rejectedLabelIds: dayOffRejectedLabelIds,
          },
          startKey,
          endKey,
          next
        );

        setAbsencesByEmployee(next);
        lastKeyRef.current = cacheKey;
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('[useEmployeeAbsences] fetch failed:', err);
        setError('fetch_failed');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `settings` is intentionally not in deps — every field we actually read
    // is listed explicitly so an unrelated settings change (e.g. zoom level)
    // doesn't churn this effect.
  }, [
    enabled,
    startKey,
    endKey,
    dayOffBoardId,
    dayOffEmployeeColId,
    dayOffStartColId,
    dayOffEndColId,
    dayOffKindColId,
    dayOffKindPersonalLabelId,
    dayOffKindGeneralLabelId,
    dayOffTypeColId,
    dayOffApprovalRequired,
    dayOffApprovalColId,
    dayOffApprovedLabelIds,
    dayOffApprovedKey,
    dayOffRejectedLabelIds,
    dayOffRejectedKey,
  ]);

  return { absencesByEmployee, isLoading, error };
};

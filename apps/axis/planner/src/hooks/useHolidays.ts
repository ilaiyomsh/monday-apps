import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { Holiday } from '../types/entities/holiday.types';
import type { PlannerSettings } from '../types/settings.types';
import { mondayService } from '../services/mondayService';
import { addDaysToDayKey, isDayKey } from '../utils/dateUtils';
import { logger } from '../utils/Logger';

export interface UseHolidaysOptions {
  settings?: PlannerSettings | null;
  startDate: Date;
  endDate: Date;
}

export interface UseHolidaysResult {
  holidaysByDate: Map<string, Holiday>;
  isLoading: boolean;
  error: string | null;
}

/** Minimal raw monday column-value shape this hook reads. */
interface RawColumnValue {
  id: string;
  text?: string | null;
  /** Status columns: the stable label ID (monday calls it `index`). */
  index?: number | string | null;
  /** Checkbox columns (CheckboxValue fragment). Contract §4: true/'true' = checked. */
  checked?: boolean | string | null;
  persons_and_teams?: Array<{ id: number | string }>;
}

/** Minimal raw monday item shape returned by `fetchDayOffsForRange`. */
interface RawDayOffItem {
  id: string;
  name?: string;
  column_values?: RawColumnValue[];
}

/** The settings slice the general-day expansion reads (W3.1 + W3.4 dayOff* block). */
interface DayOffGeneralConfig {
  employeeColId?: string;
  startColId?: string;
  endColId?: string;
  kindColId?: string;
  kindPersonalLabelId?: string;
  kindGeneralLabelId?: string;
  mandatoryColId?: string;
}

const EMPTY_HOLIDAYS: Map<string, Holiday> = new Map();

/** One resolved board read: which config+window it answers, its map, its error. */
interface ResolvedDayOff {
  key: string;
  map: Map<string, Holiday>;
  error: string | null;
}

const INITIAL_RESOLVED: ResolvedDayOff = { key: '', map: EMPTY_HOLIDAYS, error: null };

/**
 * Expands GENERAL Day-off vacations-board items (raw monday items, already
 * overlap-filtered by `fetchDayOffsForRange`) into per-day `Holiday` entries
 * per `Day-off/CONTRACT.md` §4 + §6 (DAY-OFF-INTEGRATION W3.4):
 *
 * - kind resolved by LABEL ID first (`dayOffKindGeneralLabelId` /
 *   `dayOffKindPersonalLabelId`); unknown/empty/unmapped kind falls back to the
 *   contract §2 rule: personal iff the person column is non-empty (so general
 *   iff it is empty). A NON-empty kind label matching neither configured ID is
 *   settings drift — warn-logged once per fetch while the fallback keeps the
 *   item visible.
 * - **general items only** — personal entries belong to the per-employee
 *   absence channel (`useEmployeeAbsences`, W3.3), never to `holidaysByDate`.
 *   Routing a general day through the personal channel would corrupt
 *   role-level free% math (plan §2) — and vice versa.
 * - `mandatory` checkbox (contract §4): true ⇒ `blocking:true` (office closed:
 *   zeroes capacity for EVERYONE and is excluded from role denominators by the
 *   existing `useAvailability` math). false/empty ⇒ `blocking:false` =
 *   display-only (the existing informational-holiday path: name surfaces in
 *   tooltips/day-zoom labels, zero capacity effect). An UNMAPPED mandatory
 *   column reads as false for every item (contract-mandated).
 * - the item NAME is the contract display field for general entries (§4).
 * - whole days only (D6) ⇒ `halfDay:false` always.
 * - each item's inclusive [start..end] range expands into one entry per
 *   CALENDAR day, clipped to [max(start,windowStart) .. min(end,windowEnd)].
 * - same-day collisions between general items: a blocking entry wins over a
 *   non-blocking one; otherwise the first item read wins (deterministic).
 */
const expandGeneralDayOffItems = (
  items: RawDayOffItem[],
  cfg: DayOffGeneralConfig,
  windowStart: string,
  windowEnd: string
): Map<string, Holiday> => {
  const result = new Map<string, Holiday>();
  let kindDriftCount = 0;
  let sampleDriftLabel = '';

  for (const item of items) {
    const cols: RawColumnValue[] = item?.column_values || [];
    const findCol = (id?: string) => (id ? cols.find((c) => c.id === id) : undefined);

    const persons = findCol(cfg.employeeColId)?.persons_and_teams;
    const hasPerson = Array.isArray(persons) && persons.length > 0;

    // Kind: ID-first, then the contract §2 person-presence fallback.
    const kindCol = findCol(cfg.kindColId);
    const kindLabelId = kindCol?.index != null ? String(kindCol.index) : '';
    let isGeneral: boolean;
    if (kindLabelId && cfg.kindGeneralLabelId && kindLabelId === cfg.kindGeneralLabelId) {
      isGeneral = true;
    } else if (kindLabelId && cfg.kindPersonalLabelId && kindLabelId === cfg.kindPersonalLabelId) {
      isGeneral = false;
    } else {
      if (kindLabelId) {
        // Non-empty kind matching nothing configured = settings drift (loud in logs).
        kindDriftCount++;
        sampleDriftLabel = kindLabelId;
      }
      isGeneral = !hasPerson;
    }
    if (!isGeneral) continue; // personal → AbsencesByEmployee channel (W3.3), not this map

    // Mandatory checkbox (contract §4): unmapped column ⇒ false ⇒ display-only.
    const mandatoryCol = cfg.mandatoryColId ? findCol(cfg.mandatoryColId) : undefined;
    const blocking = mandatoryCol?.checked === true || mandatoryCol?.checked === 'true';

    // Dates were validated by the fetch's overlap filter; re-guard cheaply.
    const start = (findCol(cfg.startColId)?.text || '').trim();
    const end = (findCol(cfg.endColId)?.text || '').trim();
    if (!isDayKey(start) || !isDayKey(end)) continue;

    const name = (item?.name || '').trim();

    // §6.2 expansion: clip to the window, inclusive on both ends, ALL calendar
    // days (day-keys compare lexicographically). Inverted/disjoint ⇒ no-op.
    const from = start > windowStart ? start : windowStart;
    const to = end < windowEnd ? end : windowEnd;
    if (from > to) continue;

    for (let day = from; day <= to; day = addDaysToDayKey(day, 1)) {
      const existing = result.get(day);
      if (existing && !(blocking && !existing.blocking)) continue; // blocking beats non-blocking; else first wins
      result.set(day, {
        date: day,
        nameHe: name,
        nameEn: name,
        halfDay: false, // whole days only (D6)
        blocking,
        source: 'dayoff',
      });
    }
  }

  if (kindDriftCount > 0) {
    logger.warn(
      `[useHolidays] ${kindDriftCount} day-off item(s) carry a kind label matching neither configured kind label ID (sample: "${sampleDriftLabel}") — settings drift? Falling back to person-presence (CONTRACT.md §2)`
    );
  }
  return result;
};

/**
 * THE single producer of `holidaysByDate` (consumed by GanttProvider →
 * useAvailability + availability cells). The Day-off vacations board is the SOLE
 * source (W5.3 cutover, decision D4): GENERAL entries on the board (`dayOff*`
 * settings, `Day-off/CONTRACT.md` §4 — DAY-OFF-INTEGRATION W3.4) are active iff
 * `dayOffBoardId` is set; ranges expanded per-day — see
 * `expandGeneralDayOffItems`. A half-configured dayOff mapping fails loudly
 * (`error='dayoff_misconfigured'` + logger.error, board never read).
 *
 * The legacy `planner-custom-holidays` manual store was removed in the W5.3
 * cutover (it previously coexisted here, kept alive pending this cutover).
 *
 * Window re-reads REPLACE the board-sourced map (hard-deleted company days
 * leave no tombstone — CONTRACT.md §7).
 */
export const useHolidays = ({ settings, startDate, endDate }: UseHolidaysOptions): UseHolidaysResult => {
  const [resolved, setResolved] = useState<ResolvedDayOff>(INITIAL_RESOLVED);

  const startKey = useMemo(() => format(startDate, 'yyyy-MM-dd'), [startDate]);
  const endKey = useMemo(() => format(endDate, 'yyyy-MM-dd'), [endDate]);

  const boardId = settings?.dayOffBoardId;
  const employeeColId = settings?.dayOffEmployeeColumnId;
  const startColId = settings?.dayOffStartDateColumnId;
  const endColId = settings?.dayOffEndDateColumnId;
  const kindColId = settings?.dayOffKindColumnId;
  const kindGeneralLabelId = settings?.dayOffKindGeneralLabelId;
  const kindPersonalLabelId = settings?.dayOffKindPersonalLabelId;
  const mandatoryColId = settings?.dayOffMandatoryColumnId;

  // A configured-but-incomplete dayOff mapping must fail loudly (CONTRACT.md
  // §5.6) — never a silent empty read. Same required-column set as the
  // personal channel (the employee column is needed for the §2 kind fallback —
  // without it, personal items with an unmatched kind would leak in here as
  // "general" and wrongly zero everyone's capacity).
  const missingKeys = useMemo(() => {
    if (!boardId) return [];
    const missing: string[] = [];
    if (!employeeColId) missing.push('dayOffEmployeeColumnId');
    if (!startColId) missing.push('dayOffStartDateColumnId');
    if (!endColId) missing.push('dayOffEndDateColumnId');
    return missing;
  }, [boardId, employeeColId, startColId, endColId]);

  const configError = boardId && missingKeys.length > 0 ? 'dayoff_misconfigured' : null;
  const dayOffActive = !!boardId && !configError;

  // Everything a board read depends on. '' while inactive ⇒ no fetch.
  const fetchKey = dayOffActive
    ? [
        boardId,
        employeeColId,
        startColId,
        endColId,
        kindColId,
        kindGeneralLabelId,
        kindPersonalLabelId,
        mandatoryColId,
        startKey,
        endKey,
      ].join('|')
    : '';

  const missingJoined = missingKeys.join(', ');
  useEffect(() => {
    if (configError) {
      logger.error(
        `[useHolidays] day-off holiday source is half-configured — missing: ${missingJoined}. Refusing to read the vacations board (CONTRACT.md §5.6 — no silent empty reads).`
      );
    }
  }, [configError, missingJoined]);

  useEffect(() => {
    if (!dayOffActive || !boardId || resolved.key === fetchKey) return;
    let cancelled = false;
    mondayService
      .fetchDayOffsForRange(boardId, startKey, endKey, {
        dayOffEmployeeColumnId: employeeColId,
        dayOffStartDateColumnId: startColId,
        dayOffEndDateColumnId: endColId,
        dayOffKindColumnId: kindColId,
        dayOffMandatoryColumnId: mandatoryColId,
      })
      .then((items: RawDayOffItem[]) => {
        if (cancelled) return;
        // REPLACE within the window on every re-read (CONTRACT.md §7 — deleted
        // company days have no tombstone; a fresh read is the only signal).
        setResolved({
          key: fetchKey,
          map: expandGeneralDayOffItems(
            items,
            {
              employeeColId,
              startColId,
              endColId,
              kindColId,
              kindPersonalLabelId,
              kindGeneralLabelId,
              mandatoryColId,
            },
            startKey,
            endKey
          ),
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('[useHolidays] day-off general-days fetch failed:', err);
        // Keep the previously resolved map (stale-but-honest) and surface the
        // error; the key advances so the failed read isn't retried in a loop.
        setResolved((prev) => ({ key: fetchKey, map: prev.map, error: 'fetch_failed' }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    dayOffActive,
    fetchKey,
    resolved.key,
    boardId,
    employeeColId,
    startColId,
    endColId,
    kindColId,
    kindGeneralLabelId,
    kindPersonalLabelId,
    mandatoryColId,
    startKey,
    endKey,
  ]);

  const dayOffMap = dayOffActive ? resolved.map : EMPTY_HOLIDAYS;
  const dayOffLoading = dayOffActive && resolved.key !== fetchKey;
  const dayOffError = dayOffActive ? resolved.error : configError;

  // Day-off is the sole source — the resolved board map IS holidaysByDate.
  return {
    holidaysByDate: dayOffMap,
    isLoading: dayOffLoading,
    error: dayOffError,
  };
};

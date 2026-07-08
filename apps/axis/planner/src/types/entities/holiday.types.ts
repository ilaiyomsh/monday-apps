export interface Holiday {
  date: string;
  nameHe: string;
  nameEn: string;
  halfDay: boolean;
  // Full-day blockers stop work; half-day blockers shrink capacity. Day-off
  // general entries are blocking iff their `mandatory` checkbox is true
  // (contract §4); mandatory=false entries are display-only (blocking:false ⇒
  // informational name in tooltips, zero capacity effect).
  blocking: boolean;
  // 'dayoff'  — general entry on the Day-off vacations board, the SOLE holiday
  //             source (`Day-off/CONTRACT.md` §4, DAY-OFF-INTEGRATION W3.4).
  //             The legacy manual 'custom' source was removed in the W5.3 cutover.
  source: 'dayoff';
}

export interface EmployeeAbsence {
  employeeId: string;
  date: string;             // 'YYYY-MM-DD'
  /**
   * The absence-type display label (DAY-OFF-INTEGRATION W3.5): the TEXT of the
   * `dayOffTypeColumnId` label — display-only, the type set is open per D1;
   * never branch logic on this text.
   */
  classification?: string;
  /**
   * Day-off source only (`Day-off/CONTRACT.md`): the vacations-board item id
   * this per-day entry was expanded from (one multi-day item → many entries
   * sharing one sourceItemId). Undefined on legacy Time Logs entries.
   */
  sourceItemId?: string;
  /**
   * Day-off source only: resolved approval state per the consumer's mapping —
   * `true` iff the item's approval label ID ∈ `dayOffApprovedLabelIds`
   * (empty approval value = semantic pending = `false`, CONTRACT.md §3).
   * Undefined when unresolvable: legacy entries, or no approval column /
   * approved-label set mapped. NOTE: when `dayOffApprovalRequired` is OFF,
   * non-approved entries still count toward capacity (D2) — this field is
   * informational, not a filter.
   */
  approved?: boolean;
  /**
   * Day-off source only: the stable monday LABEL ID of the personalType
   * status label — the structured type key per CONTRACT.md §3 (the type set
   * is open/dynamic per D1; `classification` carries its display text).
   */
  typeLabelId?: string;
}

export type AbsencesByEmployee = Map<string, Map<string, EmployeeAbsence>>;

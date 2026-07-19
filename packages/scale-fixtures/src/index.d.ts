/**
 * @axis/scale-fixtures — deterministic high-scale test data for the axis apps.
 *
 * Every generator is a pure function of its inputs: the same seed always
 * produces byte-identical output (mulberry32 PRNG, no Date.now / Math.random),
 * so scale tests are reproducible across runs and machines.
 */

export interface FixtureUser {
  /** monday user id (numeric, as the people column returns it). */
  id: number;
  name: string;
}

export interface FixtureProject {
  /** monday item id (string, as GraphQL returns item ids). */
  id: string;
  name: string;
}

/** Shape consumed by the tracker's dashboardAggregation (DashboardEvent). */
export interface FixtureDashboardEvent {
  id: string;
  /** Reported hours; multiples of 0.25 to keep float noise out of sums. */
  hours: number;
  isBillable: boolean;
  category: 'internalProject' | 'externalProject' | 'routine';
  stageLabel: string | null;
  stageColor: string | null;
  nonBillableType: string | null;
  nonBillableColor: string | null;
  eventTypeLabel: string;
  eventTypeColor: string;
  reporterId: number | null;
  date: Date | null;
}

/** Shape consumed by day-off's domain/absence (DayOffRequest). */
export interface FixtureDayOffRequest {
  id: string;
  employeeId: string;
  type: string;
  /** YYYY-MM-DD inclusive range, start <= end, same or adjacent year. */
  start: string;
  end: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
}

export interface FixtureEntitlement {
  employeeId: string;
  type: string;
  year: number;
  entitled: number;
}

/** monday items_page-shaped page (cursor === null on the last page). */
export interface FixtureItemsPage<T> {
  cursor: string | null;
  items: T[];
}

/** monday item shape for the planner's allocations board (lean bundle fields). */
export interface FixtureAllocationItem {
  id: string;
  name: string;
  column_values: Array<{
    id: string;
    text: string;
    linked_item_ids?: string[];
    persons_and_teams?: Array<{ id: number }>;
  }>;
}

/** One aggregate GROUP BY row as monday's aggregate API returns it. */
export interface FixtureAggregateGroup {
  entries: Array<
    | { alias: string; value: { value: string | null } }
    | { alias: string; value: { result: number } }
  >;
}

/** Deterministic PRNG in [0,1) — mulberry32. */
export function makeRng(seed: number): () => number;

/** `count` users: ids 1001, 1002, … with stable Hebrew display names. */
export function genUsers(count: number, seed?: number): FixtureUser[];

/** `count` projects: item ids "9000001", … with stable names. */
export function genProjects(count: number, seed?: number): FixtureProject[];

export interface GenDashboardEventsOptions {
  count: number;
  users: FixtureUser[];
  projects: FixtureProject[];
  /** Inclusive YYYY-MM-DD window events are spread across. */
  from: string;
  to: string;
  seed?: number;
  /**
   * When true, appends a fixed set of edge-case events (null date, Invalid
   * Date, null reporterId, zero hours) AFTER the `count` regular events.
   */
  includeEdgeCases?: boolean;
}

/** Tracker dashboard events at scale, spread across users/projects/dates. */
export function genDashboardEvents(
  opts: GenDashboardEventsOptions
): FixtureDashboardEvent[];

export interface GenDayOffRequestsOptions {
  /** Employee ids (day-off uses string ids). */
  employeeIds: string[];
  /** Absence type ids, e.g. ['vacation','sick','reserves','unpaid']. */
  types: string[];
  year: number;
  count: number;
  seed?: number;
}

/**
 * Absence requests attributed to `year` (start dates inside it; ranges 1–10
 * days, may spill into January of year+1), statuses cycling
 * pending/approved/rejected deterministically.
 */
export function genDayOffRequests(
  opts: GenDayOffRequestsOptions
): FixtureDayOffRequest[];

/** One entitlement row per (employee × type), entitled 5–30 days. */
export function genEntitlements(opts: {
  employeeIds: string[];
  types: string[];
  year: number;
  seed?: number;
}): FixtureEntitlement[];

export interface GenAllocationItemsOptions {
  count: number;
  projects: FixtureProject[];
  users: FixtureUser[];
  /** Column id carrying the board_relation to the project. */
  projectColumnId: string;
  /** Column id carrying the people column of the employee. */
  employeeColumnId: string;
  seed?: number;
}

/** Planner allocations-board items linking projects × employees. */
export function genAllocationItems(
  opts: GenAllocationItemsOptions
): FixtureAllocationItem[];

/**
 * Aggregate GROUP BY rows keyed by the given ids (hours 1–200 per group,
 * two decimal places). Pass `nullGroupHours` to prepend the unlinked-rows
 * bucket (id === null) the real API returns.
 */
export function genAggregateGroups(opts: {
  ids: string[];
  seed?: number;
  idAlias?: string;
  valueAlias?: string;
  nullGroupHours?: number;
}): FixtureAggregateGroup[];

/**
 * Split `items` into items_page-shaped pages of `pageSize`. Cursors are
 * "cursor-1", "cursor-2", …; the last page's cursor is null. An empty items
 * array yields one page with an empty items list and a null cursor.
 */
export function paginate<T>(items: T[], pageSize: number): FixtureItemsPage<T>[];

/** Sum that mirrors the apps' display rounding: Math.round(x * 100) / 100. */
export function round2(x: number): number;

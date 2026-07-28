import mondaySdk from 'monday-sdk-js';
import { logger } from '../utils/Logger';
import { addDaysToDayKey, dayRangesOverlap, isDayKey } from '../utils/dateUtils';
import { apiQueue } from './apiQueue';
import type { PlannerSettings } from '../types/settings.types';

const monday = mondaySdk();

/** The settings slice `fetchDayOffsForRange` reads (W3.1 dayOff* block). */
type DayOffFetchSettings = Pick<
  PlannerSettings,
  | 'dayOffEmployeeColumnId'
  | 'dayOffStartDateColumnId'
  | 'dayOffEndDateColumnId'
  | 'dayOffKindColumnId'
  | 'dayOffTypeColumnId'
  | 'dayOffMandatoryColumnId'
  | 'dayOffApprovalColumnId'
>;

/** Minimal raw-item shape needed for the client-side overlap filter. */
interface RawDayOffItem {
  id: string;
  column_values?: Array<{ id: string; text?: string | null }>;
}

/**
 * How far (calendar days) `fetchDayOffsForRange` widens the fetch window on
 * EACH side before the client-side overlap filter. With the OR-of-betweens
 * query an item is missed only if it spans the entire widened window — i.e.
 * lasts longer than 2×366 days plus the visible window (see the function doc).
 */
export const DAY_OFF_FETCH_WIDENING_DAYS = 366;

/** Resolved inputs for the reported-hours aggregate (perf/unified-load #90). */
export interface ReportedHoursAggregateConfig {
  logsBoardId: string;
  durationColId: string;
  allocRelationColId: string;
}

/**
 * monday's column `settings` field returns parsed JSON on the real API but a
 * string for our mock columns. Normalize to an object either way. Never parse
 * `settings_str`.
 */
function parseColumnSettings(settings: any): any {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      return JSON.parse(settings);
    } catch (err) {
      // Was a silent swallow that masked malformed column settings invisibly. WARN so the
      // failure is observable; the Axiom transport's own dedup (5/60s per identical message)
      // prevents a flood when many columns share the same bad shape.
      logger.warn('[mondayService] parseColumnSettings: malformed column settings JSON, defaulting to {}', err);
      return {};
    }
  }
  return settings;
}

/** Max distinct allocations one reported-hours aggregate page returns. */
const REPORTED_HOURS_AGG_LIMIT = 500;

/**
 * Extract {logsBoardId, durationColId} from a reportedHours mirror column's
 * settings. NOTE: the `settings` field returns `displayed_linked_columns` as an
 * ARRAY [{board_id, column_ids}], while `settings_str` returns it as an OBJECT
 * { "<boardId>": ["<colId>"] }. Handle both so we work regardless of source.
 */
function extractMirrorLogsConfig(mirrorSettings: any): { logsBoardId?: string; durationColId?: string } {
  const dlc = parseColumnSettings(mirrorSettings).displayed_linked_columns;
  if (Array.isArray(dlc)) {
    const first = dlc[0];
    return { logsBoardId: first?.board_id?.toString(), durationColId: first?.column_ids?.[0]?.toString() };
  }
  if (dlc && typeof dlc === 'object') {
    const logsBoardId = Object.keys(dlc)[0];
    const arr = dlc[logsBoardId];
    return { logsBoardId, durationColId: Array.isArray(arr) ? arr[0]?.toString() : undefined };
  }
  return {};
}

/** GraphQL field that sums reported hours per allocation (alias-able for batching). */
function reportedHoursAggregateField(cfg: ReportedHoursAggregateConfig, alias = 'reported'): string {
  return `${alias}: aggregate(query: {
        from: { type: TABLE, id: "${cfg.logsBoardId}" }
        select: [
          { type: FUNCTION, as: "alloc_id", function: { function: ID, params: [ { type: COLUMN, column: { column_id: "${cfg.allocRelationColId}" }, as: "a" } ] } }
          { type: FUNCTION, as: "hrs", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "${cfg.durationColId}" }, as: "h" } ] } }
        ]
        group_by: [{ column_id: "alloc_id" }]
        limit: ${REPORTED_HOURS_AGG_LIMIT}
      }) {
        results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } }
      }`;
}

/** Parse a reported-hours aggregate result into Map<allocationId, hours>. */
function parseReportedHoursAggregate(agg: any): Map<string, number> {
  const map = new Map<string, number>();
  const results = agg?.results || [];
  for (const set of results) {
    let id: string | null = null;
    let hrs = 0;
    for (const e of (set.entries || [])) {
      if (e.alias === 'alloc_id') {
        const v = e.value?.value;
        id = (v === null || v === undefined) ? null : String(v);
      } else if (e.alias === 'hrs') {
        hrs = Number(e.value?.result) || 0;
      }
    }
    if (id) map.set(id, hrs);
  }
  if (results.length >= REPORTED_HOURS_AGG_LIMIT) {
    logger.warn(`[mondayService] reported-hours aggregate hit the ${REPORTED_HOURS_AGG_LIMIT}-group cap — some allocations may miss actual hours. Pagination TODO (#90).`);
  }
  return map;
}

/**
 * Generic GraphQL field: SUM(sumColId) GROUP BY ID(relationColId) on a board.
 * Same proven aggregate shape as `reportedHoursAggregateField` but parameterized
 * — used for the per-PROJECT metrics (allocated hours grouped by the allocations'
 * project relation, reported hours grouped by the time-logs' project relation).
 */
function sumByRelationAggregateField(
  boardId: string,
  sumColId: string,
  relationColId: string,
  alias = 'agg'
): string {
  return `${alias}: aggregate(query: {
        from: { type: TABLE, id: "${boardId}" }
        select: [
          { type: FUNCTION, as: "group_id", function: { function: ID, params: [ { type: COLUMN, column: { column_id: "${relationColId}" }, as: "g" } ] } }
          { type: FUNCTION, as: "val", function: { function: SUM, params: [ { type: COLUMN, column: { column_id: "${sumColId}" }, as: "v" } ] } }
        ]
        group_by: [{ column_id: "group_id" }]
        limit: ${REPORTED_HOURS_AGG_LIMIT}
      }) {
        results { entries { alias value { ... on AggregateGroupByResult { value } ... on AggregateBasicAggregationResult { result } } } }
      }`;
}

/**
 * Parse a SUM-by-relation aggregate result into Map<relatedItemId, sum>.
 * The `null` group (rows whose relation column is empty — e.g. time logs not
 * linked to any project) is DROPPED: `if (id)` skips it, so an unlinked-logs
 * bucket can never leak into a project's total.
 */
function parseSumByRelationAggregate(agg: any): Map<string, number> {
  const map = new Map<string, number>();
  const results = agg?.results || [];
  for (const set of results) {
    let id: string | null = null;
    let val = 0;
    for (const e of (set.entries || [])) {
      if (e.alias === 'group_id') {
        const v = e.value?.value;
        id = (v === null || v === undefined) ? null : String(v);
      } else if (e.alias === 'val') {
        val = Number(e.value?.result) || 0;
      }
    }
    if (id) map.set(id, val);
  }
  if (results.length >= REPORTED_HOURS_AGG_LIMIT) {
    logger.warn(`[mondayService] SUM-by-relation aggregate hit the ${REPORTED_HOURS_AGG_LIMIT}-group cap — some groups may be missing. Pagination TODO.`);
  }
  return map;
}

export const mondayService = {
  /**
   * Fetch all boards the user has access to
   */
  async fetchBoards() {
    const LIMIT = 500;
    const allBoards: any[] = [];
    let page = 1;
    while (true) {
      const query = `query {
        boards (limit: ${LIMIT}, page: ${page}) {
          id
          name
          type
        }
      }`;
      const response = await apiQueue.execute(query) as any;
      if (response.errors) throw new Error(response.errors[0].message);
      const pageBoards = response.data.boards || [];
      allBoards.push(...pageBoards);
      if (pageBoards.length < LIMIT) break;
      page++;
    }
    return allBoards.filter((board: any) => board.type === 'board');
  },

  /**
   * Fetch columns for a specific board
   */
  async fetchColumns(boardId: string) {
    if (boardId.startsWith('mock-')) {
      return [
        { id: 'date', title: 'Start Date', type: 'date', settings: '{}' },
        { id: 'date_1', title: 'End Date', type: 'date', settings: '{}' },
        { id: 'numbers', title: 'Hours', type: 'numbers', settings: '{}' },
        { id: 'status', title: 'Role/Status', type: 'status', settings: '{"labels":{"1":"Developer","2":"Designer"}}' },
        { id: 'board_relation', title: 'Project', type: 'board_relation', settings: '{}' },
        { id: 'board_relation_1', title: 'Employee', type: 'board_relation', settings: '{}' },
        { id: 'name', title: 'Name', type: 'text', settings: '{}' },
        { id: 'people', title: 'User', type: 'people', settings: '{}' },
      ];
    }
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        columns {
          id
          title
          type
          settings
        }
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: { boardId: [boardId] },
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.boards[0]?.columns || [];
  },

  /**
   * Fetch columns for a specific board by type
   */
  async fetchColumnsByType(boardId: string, types: string | string[]) {
    if (boardId.startsWith('mock-')) {
      return this.fetchColumns(boardId);
    }
    const typesArray = Array.isArray(types) ? types : [types];
    const query = `query ($boardId: [ID!]!, $types: [ColumnType!]) {
      boards (ids: $boardId) {
        columns (types: $types) {
          id
          title
          type
          settings
        }
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: { boardId: [boardId], types: typesArray },
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.boards[0]?.columns || [];
  },

  /**
   * Resolve the inputs for the reported-hours aggregate (perf/unified-load #90).
   *
   * The time-logs board id + duration column are DERIVED from the reported-hours
   * mirror column's `settings` (single source of truth — `displayed_linked_columns`
   * maps logsBoardId -> [durationColId]). The reverse connect column (logs ->
   * allocations) is NOT derivable from settings, so it comes from the persisted
   * `timeLogsAllocationColumnId` (auto-detected at settings time). Returns null
   * when anything is unresolvable — caller falls back to the legacy mirror path.
   *
   * Pass `allocColumns` when the allocations columns are already in hand (e.g.
   * from the unified bundle) to avoid an extra round-trip.
   */
  async resolveAggregateConfig(
    settings: PlannerSettings,
    allocColumns?: any[]
  ): Promise<ReportedHoursAggregateConfig | null> {
    if (!settings.reportedHoursColumnId || !settings.timeLogsAllocationColumnId) return null;
    if (settings.allocationsBoardId?.startsWith('mock-')) return null;
    try {
      const cols = allocColumns || await this.fetchColumns(settings.allocationsBoardId);
      const mirror = cols.find((c: any) => c.id === settings.reportedHoursColumnId);
      if (!mirror) return null;
      const { logsBoardId, durationColId } = extractMirrorLogsConfig(mirror.settings);
      if (!logsBoardId || !durationColId) return null;
      return { logsBoardId, durationColId, allocRelationColId: settings.timeLogsAllocationColumnId };
    } catch (err) {
      logger.warn('[mondayService] resolveAggregateConfig failed:', err);
      return null;
    }
  },

  /**
   * Find the board_relation columns INSIDE the time-logs board that point back to
   * the allocations board — candidates for `timeLogsAllocationColumnId` (#90). The
   * logs board is derived from the reportedHours mirror's `settings`. Returns
   * `{id, title}[]`; 1 result ⇒ unambiguous, 2+ ⇒ user/migration picks (default first).
   */
  async findLogsAllocationColumns(settings: any): Promise<Array<{ id: string; title: string }>> {
    if (!settings.reportedHoursColumnId || !settings.allocationsBoardId) return [];
    if (settings.allocationsBoardId.startsWith('mock-')) return [];
    try {
      const allocCols = await this.fetchColumns(settings.allocationsBoardId);
      const mirror = allocCols.find((c: any) => c.id === settings.reportedHoursColumnId);
      if (!mirror) return [];
      const { logsBoardId } = extractMirrorLogsConfig(mirror.settings);
      if (!logsBoardId) return [];
      const logsCols = await this.fetchColumns(logsBoardId);
      const allocBoardId = settings.allocationsBoardId.toString();
      return logsCols
        .filter((c: any) => c.type === 'board_relation')
        .filter((c: any) => {
          const s = parseColumnSettings(c.settings);
          return (s.boardIds || []).map((b: any) => b.toString()).includes(allocBoardId);
        })
        .map((c: any) => ({ id: c.id, title: c.title }));
    } catch (err) {
      logger.warn('[mondayService] findLogsAllocationColumns failed:', err);
      return [];
    }
  },

  /**
   * Reported (actual) hours per allocation, summed server-side via one aggregate
   * on the time-logs board: SUM(duration) GROUP BY ID(logs->allocations relation).
   * Replaces the per-allocation mirror traversal. Keyed by allocation id (string).
   * Covers ALL windows (current/future/past) in one call.
   */
  async fetchReportedHoursByAllocation(
    cfg: ReportedHoursAggregateConfig
  ): Promise<Map<string, number>> {
    if (cfg.logsBoardId.startsWith('mock-')) return new Map();
    const query = `query { ${reportedHoursAggregateField(cfg)} }`;
    const response = await apiQueue.execute(query) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return parseReportedHoursAggregate(response.data?.reported);
  },

  /**
   * Allocated hours per project, summed server-side via one aggregate on the
   * allocations board: SUM(totalHours) GROUP BY ID(project relation). Covers ALL
   * allocations regardless of the windowed in-memory load. Keyed by project id.
   */
  async fetchAllocatedHoursByProject(settings: PlannerSettings): Promise<Map<string, number>> {
    const { allocationsBoardId, totalHoursColumnId, projectColumnId } = settings;
    if (!allocationsBoardId || !totalHoursColumnId || !projectColumnId) return new Map();
    if (allocationsBoardId.startsWith('mock-')) return new Map();
    const query = `query { ${sumByRelationAggregateField(allocationsBoardId, totalHoursColumnId, projectColumnId)} }`;
    const response = await apiQueue.execute(query) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return parseSumByRelationAggregate(response.data?.agg);
  },

  /**
   * Resolve the time-logs → projects relation column id (group-by key for the
   * reported-hours-per-project aggregate). Honors the explicit
   * `timeLogsProjectColumnId` override; otherwise auto-detects the single
   * board_relation column on the logs board pointing to the projects board
   * (mirrors `findLogsAllocationColumns`). Returns null when unresolvable.
   */
  async resolveLogsProjectColumnId(
    settings: PlannerSettings,
    logsBoardId: string
  ): Promise<string | null> {
    if (settings.timeLogsProjectColumnId) return settings.timeLogsProjectColumnId;
    // Derive the projects board: explicit setting, else the project relation
    // column's settings on the allocations board.
    let projectsBoardId = settings.projectsBoardId;
    if (!projectsBoardId && settings.allocationsBoardId && settings.projectColumnId) {
      try {
        const allocCols = await this.fetchColumns(settings.allocationsBoardId);
        const projCol = allocCols.find((c: any) => c.id === settings.projectColumnId);
        const s = parseColumnSettings(projCol?.settings);
        projectsBoardId = (s.boardIds && s.boardIds[0]) ? s.boardIds[0].toString() : undefined;
      } catch (err) {
        // Previously a fully silent swallow: the projects-board derivation would fail with no
        // trace and the reported-hours aggregate could misroute invisibly. WARN (recoverable —
        // we fall through and return null when the board stays unresolvable).
        logger.warn('[mondayService] resolveLogsProjectColumnId: projects-board derivation failed:', err);
      }
    }
    if (!projectsBoardId) return null;
    try {
      const logsCols = await this.fetchColumns(logsBoardId);
      const matches = logsCols
        .filter((c: any) => c.type === 'board_relation')
        .filter((c: any) => {
          const s = parseColumnSettings(c.settings);
          return (s.boardIds || []).map((b: any) => b.toString()).includes(projectsBoardId!.toString());
        });
      return matches[0]?.id ?? null;
    } catch (err) {
      logger.warn('[mondayService] resolveLogsProjectColumnId failed:', err);
      return null;
    }
  },

  /**
   * Reported (actual) hours per project, summed server-side via one aggregate on
   * the time-logs board: SUM(duration) GROUP BY ID(logs→project relation). The
   * logs board + duration column are derived from the reportedHours mirror
   * (resolveAggregateConfig); the project relation column is
   * resolved/auto-detected via resolveLogsProjectColumnId. Keyed by project id.
   */
  async fetchReportedHoursByProject(settings: PlannerSettings): Promise<Map<string, number>> {
    const cfg = await this.resolveAggregateConfig(settings);
    if (!cfg) return new Map();
    if (cfg.logsBoardId.startsWith('mock-')) return new Map();
    const projectRelationColId = await this.resolveLogsProjectColumnId(settings, cfg.logsBoardId);
    if (!projectRelationColId) return new Map();
    const query = `query { ${sumByRelationAggregateField(cfg.logsBoardId, cfg.durationColId, projectRelationColId)} }`;
    const response = await apiQueue.execute(query) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return parseSumByRelationAggregate(response.data?.agg);
  },

  /** Drain a cursor from items_page/next_items_page into a flat item list. */
  async _drainItemsCursor(cursor: string, itemFields: string): Promise<any[]> {
    const items: any[] = [];
    let c: string | null = cursor;
    while (c) {
      const q = `query ($cursor: String!) {
        next_items_page(limit: 500, cursor: $cursor) { cursor items {${itemFields} } }
      }`;
      const r = await apiQueue.execute(q, { variables: { cursor: c } }) as any;
      if (r.errors) throw new Error(r.errors[0].message);
      const p = r.data?.next_items_page;
      if (p?.items) items.push(...p.items);
      c = p?.cursor || null;
    }
    return items;
  },

  /**
   * Unified critical-path load (#90). Two round-trips instead of ~6 sequential:
   *   A) allocations(lean) + employees + columns — one document.
   *   B) reported-hours aggregate + projects items(ids) — one document.
   * Returns raw parts; allocationsApi transforms them. Reported hours come from
   * the aggregate (keyed by allocation id); project metadata from items(ids).
   */
  async fetchCriticalBundle(settings: any): Promise<{
    allocItems: any[];
    empItems: any[];
    columns: any[];
    reportedByAllocId: Map<string, number>;
    projectItems: any[];
  }> {
    const allocBoard = settings.allocationsBoardId;
    const empBoard = settings.employeesBoardId;

    const allocColIds = [
      settings.startDateColumnId, settings.endDateColumnId, settings.hoursPerDayColumnId,
      settings.totalHoursColumnId, settings.projectColumnId, settings.employeeColumnId,
      settings.roleColumnId, settings.allocationCostColumnId, settings.ftePercentageColumnId,
      settings.allocationManagerColumnId, settings.allocationClientColumnId, settings.allocationCapabilityColumnId,
    ].filter(Boolean).map((id: string) => `"${id}"`).join(', ');
    const allocFields = `
            id
            name
            column_values(ids: [${allocColIds}]) {
              id
              text
              ... on BoardRelationValue { linked_item_ids }
              ... on PeopleValue { persons_and_teams { id } }
            }`;
    const empFields = `
            id
            name
            column_values {
              id
              text
              ... on BoardRelationValue { linked_items { id name } }
              ... on MirrorValue { display_value }
              ... on PeopleValue { persons_and_teams { id } }
              ... on StatusValue { index }
            }`;

    // ---- Call A: allocations(lean) + employees + columns ----
    // Rule 1 (forward window): the critical bundle now pulls ALL current+future
    // allocations in one shot — a single forward-open rule (endDate >= today, no
    // start cap) replaces the crosses-today AND-pair, so the separate background
    // future fetch is gone. Past allocations are loaded later, windowed (see
    // fetchPastAllocationsWindow). projectIds (below) now span current+future.
    const docA = `query ($allocBoard: [ID!]!, $empBoard: [ID!]!) {
      allocations: boards(ids: $allocBoard) {
        items_page(limit: 500, query_params: {
          rules: [
            { column_id: "${settings.endDateColumnId}", compare_value: ["TODAY"], operator: greater_than_or_equals }
          ]
        }) { cursor items {${allocFields} } }
      }
      employees: boards(ids: $empBoard) {
        items_page(limit: 500) { cursor items {${empFields} } }
      }
      cols: boards(ids: $allocBoard) { columns { id title type settings } }
    }`;
    const respA = await apiQueue.execute(docA, { variables: { allocBoard: [allocBoard], empBoard: [empBoard] } }) as any;
    if (respA.errors) throw new Error(respA.errors[0].message);
    const allocPage = respA.data?.allocations?.[0]?.items_page;
    const empPage = respA.data?.employees?.[0]?.items_page;
    const columns = respA.data?.cols?.[0]?.columns || [];
    const allocItems = [...(allocPage?.items || [])];
    const empItems = [...(empPage?.items || [])];
    if (allocPage?.cursor) allocItems.push(...await this._drainItemsCursor(allocPage.cursor, allocFields));
    if (empPage?.cursor) empItems.push(...await this._drainItemsCursor(empPage.cursor, empFields));

    // Resolve aggregate config (logs board + duration from the mirror's settings,
    // relation column from the persisted setting) using already-fetched columns.
    const cfg = await this.resolveAggregateConfig(settings, columns);

    // Distinct project ids actually referenced by current allocations.
    const projectIds = Array.from(new Set(
      allocItems
        .map((it: any) => it.column_values?.find((c: any) => c.id === settings.projectColumnId)?.linked_item_ids?.[0])
        .filter(Boolean)
        .map((id: any) => id.toString())
    ));

    // Projects board: explicit setting, else derive from the project relation column.
    let projectsBoardId = settings.projectsBoardId;
    if (!projectsBoardId) {
      const projCol = columns.find((c: any) => c.id === settings.projectColumnId);
      const s = parseColumnSettings(projCol?.settings);
      projectsBoardId = (s.boardIds && s.boardIds[0]) ? s.boardIds[0].toString() : undefined;
    }
    const metaColIds = [
      settings.projectManagerColumnId, settings.projectTypeColumnId,
      settings.projectClassificationColumnId, settings.clientColumnId,
      settings.projectPlannedHoursColumnId,
    ].filter(Boolean) as string[];

    // ---- Call B: reported aggregate (+ first chunk of projects) ----
    let reportedByAllocId = new Map<string, number>();
    let projectItems: any[] = [];
    const firstChunk = projectIds.slice(0, 100);
    const metaClause = metaColIds.length
      ? `column_values(ids: [${metaColIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on PeopleValue { persons_and_teams { id } }
              ... on StatusValue { index label_style { color } }
              ... on BoardRelationValue { linked_item_ids }
            }`
      : '';
    const wantProjects = !!projectsBoardId && firstChunk.length > 0;
    if (cfg || wantProjects) {
      const parts: string[] = [];
      if (cfg) parts.push(reportedHoursAggregateField(cfg));
      if (wantProjects) {
        // limit:100 is REQUIRED — monday's root items(ids:) defaults to a 25-item
        // page, so without it any window with >25 distinct projects silently loses
        // names beyond the 25th (→ "Unknown Project"). firstChunk is <=100.
        parts.push(`projects: items(ids: [${firstChunk.map(id => `"${id}"`).join(', ')}], limit: 100) {
          id
          name
          ${metaClause}
        }`);
      }
      const docB = `query { ${parts.join('\n')} }`;
      const respB = await apiQueue.execute(docB) as any;
      if (respB.errors) throw new Error(respB.errors[0].message);
      if (cfg) reportedByAllocId = parseReportedHoursAggregate(respB.data?.reported);
      if (wantProjects) projectItems = respB.data?.projects || [];
    }

    // Overflow projects beyond the first 100 ids.
    if (projectsBoardId && projectIds.length > 100) {
      const rest = await this.fetchProjectsByIds(projectsBoardId, projectIds.slice(100), metaColIds);
      projectItems.push(...rest);
    }

    return { allocItems, empItems, columns, reportedByAllocId, projectItems };
  },

  /**
   * Backward-WINDOWED past allocations fetch (Rule 1): items whose END date
   * falls within [windowStartDayKey..windowEndDayKey], using the proven two-day
   * `between` shape (a bare single-day compare_value is silently rejected — see
   * CLAUDE.md). useAllocations owns the cursor (1yr
   * windows, +1yr per fetch-more); this fn is STATELESS-by-bounds.
   *
   * Uses the SAME LEAN column set as docA (geometry + identity + board_relation
   * `linked_item_ids` only) — NO nested project metadata (resolved via
   * fetchProjectsByIds) and NO reported-hours mirror (bar color comes from the
   * window-agnostic aggregate). Keyed on endDate so a long allocation that ends
   * >= today is already captured by the forward fetch and lands in exactly one
   * window here by its endDate.
   */
  async fetchPastAllocationsWindow(
    settings: any,
    windowStartDayKey: string,
    windowEndDayKey: string
  ): Promise<any[]> {
    if (settings.allocationsBoardId?.startsWith('mock-')) return [];
    const colIds = [
      settings.startDateColumnId,
      settings.endDateColumnId,
      settings.hoursPerDayColumnId,
      settings.totalHoursColumnId,
      settings.projectColumnId,
      settings.employeeColumnId,
      settings.roleColumnId,
      settings.allocationCostColumnId,
      settings.ftePercentageColumnId,
      settings.allocationManagerColumnId,
      settings.allocationClientColumnId,
      settings.allocationCapabilityColumnId,
    ].filter(Boolean) as string[];
    const colIdsList = colIds.map(id => `"${id}"`).join(', ');
    const itemFields = `
            id
            name
            column_values(ids: [${colIdsList}]) {
              id
              text
              ... on BoardRelationValue { linked_item_ids }
              ... on PeopleValue { persons_and_teams { id } }
            }`;
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (
          limit: 500,
          query_params: {
            rules: [
              { column_id: "${settings.endDateColumnId}", compare_value: ["${windowStartDayKey}", "${windowEndDayKey}"], operator: between }
            ],
            operator: and
          }
        ) {
          cursor
          items {${itemFields}
          }
        }
      }
    }`;
    return this._fetchPaginatedItems(query, { boardId: [settings.allocationsBoardId] }, itemFields);
  },

  /**
   * Fetch a specific set of projects by id with metadata columns, in chunks
   * (perf/unified-load #90). Replaces the per-allocation nested `linked_items`
   * resolution: fetched once per project, joined client-side by projectId.
   */
  async fetchProjectsByIds(boardId: string, ids: string[], metaColIds: string[]): Promise<any[]> {
    if (!boardId || boardId.startsWith('mock-') || ids.length === 0) return [];
    const unique = Array.from(new Set(ids.map(String)));
    const colsClause = metaColIds.length
      ? `column_values(ids: [${metaColIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on PeopleValue { persons_and_teams { id } }
              ... on StatusValue { index label_style { color } }
              ... on BoardRelationValue { linked_item_ids }
            }`
      : '';
    const CHUNK = 100;
    const all: any[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      // limit:100 is REQUIRED — root items(ids:) defaults to a 25-item page, so
      // a chunk of >25 ids would silently drop names past the 25th. CHUNK<=100.
      const query = `query ($ids: [ID!]!) {
        items (ids: $ids, limit: 100) {
          id
          name
          ${colsClause}
        }
      }`;
      const response = await apiQueue.execute(query, { variables: { ids: chunk } }) as any;
      if (response.errors) throw new Error(response.errors[0].message);
      all.push(...(response.data?.items || []));
    }
    return all;
  },

  /**
   * Fetch boards by multiple IDs
   */
  async fetchBoardsByIds(boardIds: string[]) {
    if (boardIds.some(id => id.startsWith('mock-'))) {
      return [];
    }
    const query = `query ($boardIds: [ID!]!) {
      boards (ids: $boardIds) {
        id
        name
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: { boardIds },
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.boards || [];
  },

  /**
   * Fetch active project IDs from projects board
   * @param additionalColumnIds - Optional column IDs to fetch values for (e.g., manager column)
   */
  async fetchActiveProjectIds(
    boardId: string,
    statusColumnId: string,
    activeValues: string[],
    additionalColumnIds?: string[]
  ) {
    logger.debug('[MondayService] fetchActiveProjectIds called:', {
      boardId,
      statusColumnId,
      activeValues,
      additionalColumnIds
    });

    if (boardId.startsWith('mock-')) {
      return [];
    }

    // Build a single rule with any_of operator for exact status label index matching
    // contains_terms would match "לא פעיל" when searching for "פעיל" (substring match)
    // Convert string indices to numbers - Monday.com any_of expects numeric label indices
    const numericValues = activeValues.map(v => {
      const num = parseInt(v, 10);
      return isNaN(num) ? v : num;
    });
    const rules = [{
      column_id: statusColumnId,
      compare_value: numericValues,
      operator: "any_of"
    }];

    // Build column_values clause if additional columns requested
    const validColumnIds = additionalColumnIds?.filter(id => id) || [];
    const columnValuesClause = validColumnIds.length > 0
      ? `column_values (ids: [${validColumnIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on StatusValue {
                index
                label_style {
                  color
                }
              }
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on BoardRelationValue {
                linked_items {
                  id
                }
              }
            }`
      : '';

    const query = `query ($boardId: [ID!]!, $rules: [ItemsQueryRule!]) {
      boards (ids: $boardId) {
        items_page (limit: 500, query_params: { rules: $rules, operator: or }) {
          items {
            id
            name
            ${columnValuesClause}
          }
        }
      }
    }`;

    const variables = {
      boardId: [boardId],
      rules
    };

    logger.debug('[MondayService] fetchActiveProjectIds query variables:', variables);

    // Build matching item fields for pagination continuation
    const itemFields = validColumnIds.length > 0
      ? `
            id
            name
            column_values (ids: [${validColumnIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on StatusValue {
                index
                label_style {
                  color
                }
              }
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on BoardRelationValue {
                linked_items {
                  id
                }
              }
            }`
      : `
            id
            name`;

    const response = await this._fetchPaginatedItems(query, variables, itemFields);
    logger.debug('[MondayService] fetchActiveProjectIds found projects:', response.length);

    // Transform response to include column values
    return response.map((item: any) => {
      const project: any = { id: item.id, name: item.name };

      // Parse column values if present
      item.column_values?.forEach((col: any) => {
        if (col.text) {
          project[col.id] = col.text;
        }

        // Attach status color from StatusValue fragment
        if (col.label_style?.color) {
          project[col.id + '_color'] = col.label_style.color;
        }

        // Attach status label index (string) from StatusValue fragment.
        // Used by classifyProject as a stable identifier — labels' display text
        // can change but their numeric index does not.
        if (col.index !== undefined && col.index !== null) {
          project[col.id + '_index'] = col.index.toString();
        }

        // Attach person ID from PeopleValue fragment
        if (col.persons_and_teams && col.persons_and_teams.length > 0) {
          project[col.id + '_id'] = col.persons_and_teams[0].id.toString();
        }

        // Attach linked item ID from BoardRelationValue fragment
        if (col.linked_items && col.linked_items.length > 0) {
          project[col.id + '_id'] = col.linked_items[0].id.toString();
        }
      });

      return project;
    });
  },

  /**
   * Internal helper for paginated item fetching
   */
  async _fetchPaginatedItems(query: string, variables: any, itemFields?: string) {
    if (variables?.boardId?.[0]?.startsWith?.('mock-')) {
      return [];
    }
    const allItems: any[] = [];
    const response = await apiQueue.execute(query, { variables }) as any;

    if (response.errors) throw new Error(response.errors[0].message);

    const page = response.data.boards ? response.data.boards[0]?.items_page : response.data.next_items_page;

    if (page?.items) {
      allItems.push(...page.items);
    }

    // Default item fields for continuation if caller doesn't specify
    const continuationFields = itemFields || `
            id
            name
            column_values {
              id
              text
            }`;

    let cursor = page?.cursor;
    while (cursor) {
      const nextQuery = `query ($cursor: String!) {
        next_items_page (limit: 500, cursor: $cursor) {
          cursor
          items {${continuationFields}
          }
        }
      }`;
      const nextResponse = await apiQueue.execute(nextQuery, { variables: { cursor } }) as any;
      if (nextResponse.errors) throw new Error(nextResponse.errors[0].message);

      const nextPage = nextResponse.data.next_items_page;
      if (nextPage?.items) {
        allItems.push(...nextPage.items);
      }
      cursor = nextPage?.cursor || null;
    }
    return allItems;
  },

  /**
   * Fetch Day-off vacations-board items whose inclusive [startDate..endDate]
   * range OVERLAPS the inclusive [windowStart..windowEnd] window
   * (Day-off integration W3.2 — normative spec: `Day-off/CONTRACT.md` §6.1).
   *
   * monday `items_page` has no native two-column overlap operator, and the
   * OR-of-betweens pattern used elsewhere in this file MISSES items spanning
   * the whole window (start before it AND end after it). The plan-sanctioned
   * safe path implemented here (plan §4.5 step 1, decision recorded in the
   * execution ledger):
   *   1. fetch with a WIDENED window — OR-of-betweens over
   *      [windowStart − 366d .. windowEnd + 366d], using only the
   *      between/OR operator shape already proven in this app's production
   *      queries;
   *   2. filter CLIENT-SIDE to true inclusive overlap with the real window
   *      (`start ≤ windowEnd AND end ≥ windowStart`, lexicographic day-keys).
   *
   * Coverage cap (accepted + documented): an item is missed only when its range
   * spans the ENTIRE widened window, i.e. lasts longer than 2×366 days plus the
   * window length. Absence entries of 2+ years are outside the product domain.
   *
   * Queries only the mapped `dayOff*` columns (W3.1 settings block) plus the
   * item name — for general entries the NAME is the contract field (§4).
   * Returns raw monday items (overlap-filtered); the caller normalizes (W3.3).
   * Items missing/malformed on either date are dropped per CONTRACT.md §2
   * (skip + log, never guess).
   */
  async fetchDayOffsForRange(
    boardId: string,
    windowStart: string,
    windowEnd: string,
    settings: DayOffFetchSettings | null | undefined
  ) {
    const startColId = settings?.dayOffStartDateColumnId;
    const endColId = settings?.dayOffEndDateColumnId;
    if (!boardId || !settings || !startColId || !endColId) {
      // CONTRACT.md §5.6: a half-configured mapping must fail loudly — never a
      // silent empty result. Callers gate on dayOffBoardId before calling.
      throw new Error(
        '[MondayService] fetchDayOffsForRange requires dayOffStartDateColumnId and dayOffEndDateColumnId (and a board id) — refusing to read a half-configured day-off mapping'
      );
    }
    if (!isDayKey(windowStart) || !isDayKey(windowEnd)) {
      throw new Error(
        `[MondayService] fetchDayOffsForRange window bounds must be YYYY-MM-DD day-keys, got: ${windowStart}..${windowEnd}`
      );
    }

    const colIds = [
      settings.dayOffEmployeeColumnId,
      startColId,
      endColId,
      settings.dayOffKindColumnId,
      settings.dayOffTypeColumnId,
      settings.dayOffMandatoryColumnId,
      settings.dayOffApprovalColumnId,
    ].filter(Boolean) as string[];
    const colIdsStr = colIds.map((id) => `"${id}"`).join(', ');

    const widenedStart = addDaysToDayKey(windowStart, -DAY_OFF_FETCH_WIDENING_DAYS);
    const widenedEnd = addDaysToDayKey(windowEnd, DAY_OFF_FETCH_WIDENING_DAYS);

    const itemFields = `
            id
            name
            column_values (ids: [${colIdsStr}]) {
              id
              text
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on StatusValue {
                index
                label_style { color }
              }
              ... on CheckboxValue {
                checked
              }
            }`;
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (
          limit: 500,
          query_params: {
            rules: [
              { column_id: "${startColId}", compare_value: ["${widenedStart}", "${widenedEnd}"], operator: between },
              { column_id: "${endColId}", compare_value: ["${widenedStart}", "${widenedEnd}"], operator: between }
            ],
            operator: or
          }
        ) {
          cursor
          items {${itemFields}
          }
        }
      }
    }`;

    const items = await this._fetchPaginatedItems(query, { boardId: [boardId] }, itemFields);

    // Client-side overlap filter against the REAL window. Also drops items the
    // widened fetch over-collected and malformed items (missing either date).
    let malformedCount = 0;
    const overlapping = items.filter((item: RawDayOffItem) => {
      const cols = item?.column_values || [];
      const start = (cols.find((c) => c.id === startColId)?.text || '').trim();
      const end = (cols.find((c) => c.id === endColId)?.text || '').trim();
      if (!isDayKey(start) || !isDayKey(end)) {
        malformedCount++;
        return false;
      }
      return dayRangesOverlap(start, end, windowStart, windowEnd);
    });
    if (malformedCount > 0) {
      logger.warn(
        `[MondayService] fetchDayOffsForRange dropped ${malformedCount} item(s) missing a valid start/end date (CONTRACT.md §2: skip, never guess)`
      );
    }
    logger.debug('[MondayService] fetchDayOffsForRange:', {
      boardId,
      window: `${windowStart}..${windowEnd}`,
      widened: `${widenedStart}..${widenedEnd}`,
      fetched: items.length,
      overlapping: overlapping.length,
    });
    return overlapping;
  },

  /**
   * Fetch project data with specific columns
   */
  async fetchProjectData(boardId: string, columnIds: string[]) {
    if (boardId.startsWith('mock-')) {
      return [];
    }
    
    const columnIdsStr = columnIds.filter(id => id).map(id => `"${id}"`).join(', ');
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (limit: 500) {
          items {
            id
            name
            column_values (ids: [${columnIdsStr}]) {
              id
              text
              type
            }
          }
        }
      }
    }`;
    
    const itemFields = `
            id
            name
            column_values (ids: [${columnIdsStr}]) {
              id
              text
              type
            }`;
    const items = await this._fetchPaginatedItems(query, { boardId: [boardId] }, itemFields);
    
    // Transform to a more usable format
    return items.map((item: any) => {
      const data: any = { id: item.id, name: item.name };
      
      item.column_values?.forEach((col: any) => {
        if (col.type === 'numbers' && col.text) {
          data[col.id] = parseFloat(col.text) || 0;
        } else if (col.type === 'people' && col.text) {
          data[col.id] = col.text;
        }
      });
      
      return data;
    });
  },

  /**
   * Fetch items from a board
   */
  async fetchItems(boardId: string) {
    if (boardId.startsWith('mock-')) {
      return [];
    }
    const itemFields = `
            id
            name
            column_values {
              id
              text
              ... on BoardRelationValue {
                linked_items {
                  id
                  name
                }
              }
              ... on MirrorValue {
                display_value
              }
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on StatusValue {
                index
              }
            }`;
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (limit: 500) {
          cursor
          items {${itemFields}
          }
        }
      }
    }`;
    return this._fetchPaginatedItems(query, { boardId: [boardId] }, itemFields);
  },

  /**
   * Fetch allocations that cross today (startDate <= today <= endDate).
   * Also fetches nested project metadata (PM, type) via linked_items on the project column.
   * Returns raw items — caller is responsible for transformation.
   */
  async fetchCurrentAllocations(settings: any): Promise<any[]> {
    if (settings.allocationsBoardId?.startsWith('mock-')) return [];

    // monday's date filter needs the "TODAY" keyword (or `["EXACT", "YYYY-MM-DD"]`).
    // Passing a bare `["YYYY-MM-DD"]` is silently rejected and returns 0 items.
    // See https://developer.monday.com/api-reference/reference/date#filter
    // Build list of allocation column IDs to fetch
    const colIds = [
      settings.startDateColumnId,
      settings.endDateColumnId,
      settings.hoursPerDayColumnId,
      settings.totalHoursColumnId,
      settings.projectColumnId,
      settings.employeeColumnId,
      settings.roleColumnId,
      settings.reportedHoursColumnId,
      settings.allocationCostColumnId,
      settings.ftePercentageColumnId,
      settings.allocationManagerColumnId,
      settings.allocationClientColumnId,
      settings.allocationCapabilityColumnId,
    ].filter(Boolean) as string[];
    const colIdsList = colIds.map(id => `"${id}"`).join(', ');

    // Project metadata columns (on the projects board, fetched via linked_items)
    const projectMetaCols = [
      settings.projectManagerColumnId,
      settings.projectTypeColumnId,
      settings.projectClassificationColumnId,
    ].filter(Boolean) as string[];
    const projectMetaClause = projectMetaCols.length > 0
      ? `column_values(ids: [${projectMetaCols.map(id => `"${id}"`).join(', ')}]) {
                    id
                    text
                    ... on PeopleValue { persons_and_teams { id } }
                    ... on StatusValue { index label_style { color } }
                  }`
      : '';

    const itemFields = `
            id
            name
            column_values(ids: [${colIdsList}]) {
              id
              text
              ... on BoardRelationValue {
                linked_items {
                  id
                  name
                  ${projectMetaClause}
                }
              }
              ... on MirrorValue { display_value }
              ... on PeopleValue { persons_and_teams { id } }
            }`;

    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (
          limit: 500,
          query_params: {
            rules: [
              { column_id: "${settings.startDateColumnId}", compare_value: ["TODAY"], operator: lower_than_or_equal },
              { column_id: "${settings.endDateColumnId}", compare_value: ["TODAY"], operator: greater_than_or_equals }
            ],
            operator: and
          }
        ) {
          cursor
          items {${itemFields}
          }
        }
      }
    }`;

    return this._fetchPaginatedItems(query, { boardId: [settings.allocationsBoardId] }, itemFields);
  },

  /**
   * Create a new item in a board
   */
  async createItem(boardId: string, itemName: string, columnValues: any) {
    const query = `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: {
        boardId,
        itemName,
        columnValues: JSON.stringify(columnValues)
      }
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.create_item;
  },

  /**
   * Update multiple column values for an item
   */
  async updateItem(boardId: string, itemId: string, columnValues: any) {
    const query = `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values (board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
        id
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: {
        boardId,
        itemId,
        columnValues: JSON.stringify(columnValues)
      }
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.change_multiple_column_values;
  },

  /**
   * Update item name
   */
  async updateItemName(itemId: string, newName: string) {
    const query = `mutation ($itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values (item_id: $itemId, column_values: $columnValues) {
        id
        name
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: {
        itemId,
        columnValues: JSON.stringify({ name: newName })
      }
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.change_multiple_column_values;
  },

  /**
   * Delete an item
   */
  async deleteItem(itemId: string) {
    const query = `mutation ($itemId: ID!) {
      delete_item (item_id: $itemId) {
        id
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: { itemId },
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.delete_item;
  },

  /**
   * Get board owners to check permissions
   */
  async getBoardOwners(boardId: string) {
    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        owners {
          id
        }
      }
    }`;
    const response = await apiQueue.execute(query, {
      variables: { boardId: [boardId] },
    }) as any;
    if (response.errors) throw new Error(response.errors[0].message);
    return response.data.boards[0]?.owners || [];
  },

  /**
   * Fetch user photos by user IDs (requires users:read scope)
   */
  async fetchUserPhotos(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const query = `query ($userIds: [ID!]) {
      users (ids: $userIds) {
        id
        photo_thumb
      }
    }`;

    const response = await apiQueue.execute(query, {
      variables: { userIds }
    }) as any;

    if (response.errors) {
      logger.warn('[MondayService] fetchUserPhotos API error:', response.errors);
      return new Map();
    }

    const photoMap = new Map<string, string>();
    response.data.users?.forEach((user: any) => {
      if (user.photo_thumb) {
        photoMap.set(user.id.toString(), user.photo_thumb);
      }
    });

    return photoMap;
  },

  /**
   * Fetch all projects from a board with specific column values (PM, project type, etc.)
   * Used when filterActiveProjects is disabled but we still need column data
   */
  async fetchAllProjectsWithColumns(
    boardId: string,
    columnIds?: string[]
  ) {
    if (boardId.startsWith('mock-')) {
      return [];
    }

    const validColumnIds = columnIds?.filter(id => id) || [];
    const columnValuesClause = validColumnIds.length > 0
      ? `column_values (ids: [${validColumnIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on StatusValue {
                index
                label_style {
                  color
                }
              }
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on BoardRelationValue {
                linked_items {
                  id
                }
              }
            }`
      : '';

    const query = `query ($boardId: [ID!]!) {
      boards (ids: $boardId) {
        items_page (limit: 500) {
          cursor
          items {
            id
            name
            ${columnValuesClause}
          }
        }
      }
    }`;

    const itemFields = validColumnIds.length > 0
      ? `
            id
            name
            column_values (ids: [${validColumnIds.map(id => `"${id}"`).join(', ')}]) {
              id
              text
              ... on StatusValue {
                index
                label_style {
                  color
                }
              }
              ... on PeopleValue {
                persons_and_teams {
                  id
                }
              }
              ... on BoardRelationValue {
                linked_items {
                  id
                }
              }
            }`
      : `
            id
            name`;

    const response = await this._fetchPaginatedItems(query, { boardId: [boardId] }, itemFields);

    // Transform response to include column values
    return response.map((item: any) => {
      const project: any = { id: item.id, name: item.name };

      // Parse column values if present
      item.column_values?.forEach((col: any) => {
        if (col.text) {
          project[col.id] = col.text;
        }

        // Attach status color from StatusValue fragment
        if (col.label_style?.color) {
          project[col.id + '_color'] = col.label_style.color;
        }

        // Attach status label index (string) from StatusValue fragment.
        // Used by classifyProject as a stable identifier — labels' display text
        // can change but their numeric index does not.
        if (col.index !== undefined && col.index !== null) {
          project[col.id + '_index'] = col.index.toString();
        }

        // Attach person ID from PeopleValue fragment
        if (col.persons_and_teams && col.persons_and_teams.length > 0) {
          project[col.id + '_id'] = col.persons_and_teams[0].id.toString();
        }

        // Attach linked item ID from BoardRelationValue fragment
        if (col.linked_items && col.linked_items.length > 0) {
          project[col.id + '_id'] = col.linked_items[0].id.toString();
        }
      });

      return project;
    });
  },

  /**
   * Exposed monday object for custom queries (like aggregate)
   */
  monday
};

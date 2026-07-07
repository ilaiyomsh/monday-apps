/**
 * vacationService — the single funnel between the one "vacations" board and the
 * app's domain objects. Every item on the board is either a PERSONAL day-off
 * request or a GENERAL (company-wide) day; the `kindColumnId` status label
 * discriminates. `listEntries` reads the board once and splits into both lists,
 * so the data provider keeps its existing `requests` / `companyDays` surface.
 *
 * Replaces the former requestsService + companyDaysService + entitlementsService
 * (the yearly-quota concept was removed). All monday I/O goes through `mondayApi`;
 * pure (de)serialization lives in columnMap.ts. Every catch logs/throws.
 *
 * File attachments upload via monday's seamless multipart translation: a `File`
 * passed as a GraphQL variable to `add_file_to_column` is auto-converted to a
 * multipart request by the platform (View apps). See mondayApi.addFileToColumn.
 */
import { mondayApi } from './mondayApi';
import { logger } from '../core';
import {
  parsePeople,
  formatPeople,
  parseStatusText,
  parseStatusIndex,
  formatStatusLabel,
  formatStatusIndex,
  formatLongText,
  parseDateText,
  formatDate,
  formatNumber,
  parseCheckbox,
  formatCheckbox,
  parseFile,
} from './columnMap';
import { rangeOverlapsWindow, yearWindow, workdaysBetween } from '../domain/dates';
import type { ColumnValues } from './mondayApi';
import type { VacationColumnMap, StatusValueMap, KindValueMap, PersonalTypeOption } from '../types';
import type {
  AbsenceType,
  RequestStatus,
  DayOffRequest,
  RequestDraft,
  CompanyDay,
  CompanyDayDraft,
  DayKey,
  DayWindow,
} from '../domain/types';

export interface VacationCtx {
  boardId: string;
  cols: VacationColumnMap;
  kindValues: KindValueMap;
  personalTypes: PersonalTypeOption[];
  statusValues: StatusValueMap;
}

const STATUS_ORDER: RequestStatus[] = ['pending', 'approved', 'rejected'];

interface RawColumnValue {
  id: string;
  type?: string;
  text?: string | null;
  value?: string | null;
}

interface RawItem {
  id: string | number;
  name?: string | null;
  created_at?: string | null;
  column_values?: RawColumnValue[] | null;
}

function entryColumnIds(cols: VacationColumnMap): string[] {
  return [...new Set(Object.values(cols).filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/**
 * Read scope for `listEntries`: an arbitrary inclusive [from,to] day window
 * (integration contract §4.5 — windows may span year boundaries, e.g. a
 * Planner Gantt or tracker month view crossing Dec–Jan), or a plain calendar
 * year (legacy convenience, normalized to that year's window).
 */
export type ReadScope = DayWindow | number;

function toWindow(scope: ReadScope): DayWindow {
  return typeof scope === 'number' ? yearWindow(scope) : scope;
}

/** Board query scoped to items whose [start..end] range overlaps the inclusive
 *  [from,to] window (when both date columns are mapped): `end >= from AND
 *  start <= to` — the contract-§4.5 overlap form, which also catches items
 *  spanning the entire window. */
function buildEntriesQuery(ctx: VacationCtx, window: DayWindow): string {
  const columnIds = entryColumnIds(ctx.cols);
  const colFragment = columnIds.length ? `(ids: ${JSON.stringify(columnIds)})` : '';
  const startCol = ctx.cols.startDateColumnId;
  const endCol = ctx.cols.endDateColumnId;
  const queryParams =
    startCol && endCol
      ? `, query_params: {
          rules: [
            { column_id: "${endCol}", compare_value: ["${window.from}"], operator: greater_than_or_equals },
            { column_id: "${startCol}", compare_value: ["${window.to}"], operator: lower_than_or_equal }
          ],
          operator: and
        }`
      : '';
  return `query ($id: [ID!], $cursor: String) {
  boards(ids: $id) {
    items_page(limit: 100, cursor: $cursor${queryParams}) {
      cursor
      items { id name created_at column_values${colFragment} { id type text value } }
    }
  }
}`;
}

/** Reverse-lookup a board label → its enum key (case/whitespace-insensitive). */
function enumFromLabel<K extends string>(map: Record<K, string>, order: K[], label: string): K | undefined {
  const want = label.trim();
  if (want === '') return undefined;
  for (const key of order) if (map[key].trim() === want) return key;
  const lower = want.toLowerCase();
  for (const key of order) if (map[key].trim().toLowerCase() === lower) return key;
  return undefined;
}

/**
 * True when a configured label id (string, from settings) refers to the label id
 * read off an item's status `value` JSON. Empty/blank configured ids never match
 * (guards `Number('') === 0` against real label id 0).
 */
function sameLabelId(configured: string | null | undefined, actual: number): boolean {
  if (configured == null) return false;
  const trimmed = configured.trim();
  if (trimmed === '') return false;
  return Number(trimmed) === actual;
}

/**
 * Thrown when an item's approval-status label matches neither the configured
 * label ids nor the configured label texts (D8: never silently default to
 * pending — a mismatch means the settings drifted from the board labels, and a
 * silent default makes approved absences vanish from consumers with no error).
 * Surfaces via listEntries → DayOffDataProvider.handleError → ErrorDetailsModal.
 */
export class ApprovalStatusMismatchError extends Error {
  readonly i18nKey = 'errors.approvalStatusMismatch' as const;

  constructor(readonly details: { itemId: string; labelId: number | null; labelText: string }) {
    super(
      `Approval-status label of item ${details.itemId} (id=${details.labelId ?? 'none'}, text="${details.labelText}") matches no configured status mapping — fix the status mapping in Settings`,
    );
    this.name = 'ApprovalStatusMismatchError';
  }
}

/**
 * Resolve an item's approval status. Label-ID first (org standard — stable across
 * renames), then case-insensitive text (legacy settings saved before label ids
 * were stored). An item with NO status value at all is a not-yet-decided request
 * → pending (semantic default, not a mismatch). A non-empty value that matches
 * nothing configured fails LOUDLY (never the old silent `pending` default).
 */
function resolveApprovalStatus(
  ctx: VacationCtx,
  itemId: string,
  labelId: number | null,
  labelText: string,
): RequestStatus {
  if (labelId != null) {
    const ids = ctx.statusValues.labelIds;
    for (const key of STATUS_ORDER) if (sameLabelId(ids?.[key], labelId)) return key;
  }
  const byText = enumFromLabel(ctx.statusValues, STATUS_ORDER, labelText);
  if (byText) return byText;
  if (labelId == null && labelText === '') return 'pending';
  logger.error('vacationService', 'approval-status label matches no configured status mapping', {
    itemId,
    labelId,
    labelText,
    configured: ctx.statusValues,
  });
  throw new ApprovalStatusMismatchError({ itemId, labelId, labelText });
}

function findPersonalTypeByLabelId(types: PersonalTypeOption[], labelId: number | null): PersonalTypeOption | undefined {
  if (labelId == null) return undefined;
  return types.find((opt) => Number(opt.id) === labelId);
}

function findPersonalTypeByTitle(types: PersonalTypeOption[], title: string): PersonalTypeOption | undefined {
  const needle = title.trim().toLowerCase();
  if (!needle) return undefined;
  return types.find((opt) => opt.title.trim().toLowerCase() === needle);
}

function byId(item: RawItem): Map<string, RawColumnValue> {
  const out = new Map<string, RawColumnValue>();
  for (const cv of item.column_values ?? []) out.set(cv.id, cv);
  return out;
}

/** monday `created_at` (ISO) → day-key, or null. */
function createdAtKey(created?: string | null): DayKey | null {
  if (created == null || created.trim() === '') return null;
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Decide whether an item is a personal request or a general day.
 * The kind status label wins — matched by stable label ID first (org standard),
 * then by case-insensitive text (legacy settings). When the kind is unmapped or
 * unknown, fall back to the presence of a person value (personal) vs. none
 * (general) — the contract-blessed fallback (CONTRACT spec / plan §4.1). A
 * non-empty kind that matches nothing configured signals settings drift and is
 * warn-logged before falling back.
 */
function isPersonal(ctx: VacationCtx, get: (id?: string) => RawColumnValue | undefined): boolean {
  const kindCv = get(ctx.cols.kindColumnId);
  const labelId = parseStatusIndex(kindCv?.value);
  const label = parseStatusText(kindCv?.text);
  const { kindValues } = ctx;
  if (labelId != null) {
    if (sameLabelId(kindValues.personalLabelId, labelId)) return true;
    if (sameLabelId(kindValues.generalLabelId, labelId)) return false;
  }
  const personal = kindValues.personal.trim();
  const general = kindValues.general.trim();
  if (label !== '') {
    if (personal !== '' && label.toLowerCase() === personal.toLowerCase()) return true;
    if (general !== '' && label.toLowerCase() === general.toLowerCase()) return false;
  }
  // Fallback: an entry with a person is personal.
  const hasPerson = parsePeople(get(ctx.cols.personColumnId)?.value).length > 0;
  if (labelId != null || label !== '') {
    // A kind label exists but matches neither configured value — the settings
    // drifted from the board labels. The person fallback keeps the item visible
    // (contract §4.1), but the drift must be loud in the logs.
    logger.warn('vacationService', 'kind label matches no configured kind mapping — falling back to person presence', {
      labelId,
      labelText: label,
      configured: kindValues,
      resolvedAs: hasPerson ? 'personal' : 'general',
    });
  }
  return hasPerson;
}

function mapRequest(ctx: VacationCtx, item: RawItem, get: (id?: string) => RawColumnValue | undefined): DayOffRequest | null {
  const { cols } = ctx;
  const employeeId = parsePeople(get(cols.personColumnId)?.value)[0];
  if (!employeeId) return null;
  const start = parseDateText(get(cols.startDateColumnId)?.text);
  const end = parseDateText(get(cols.endDateColumnId)?.text);
  if (!start || !end) return null;

  const typeLabel = parseStatusText(get(cols.personalTypeColumnId)?.text);
  const typeLabelId = parseStatusIndex(get(cols.personalTypeColumnId)?.value);
  const type = findPersonalTypeByLabelId(ctx.personalTypes, typeLabelId) ?? findPersonalTypeByTitle(ctx.personalTypes, typeLabel);
  const fallbackId = typeLabelId != null ? `status_label_${typeLabelId}` : 'status_label_unknown';
  const resolvedType: AbsenceType = type?.id ?? fallbackId;
  const approvalCv = get(cols.approvalStatusColumnId);
  const status: RequestStatus = resolveApprovalStatus(
    ctx,
    String(item.id),
    parseStatusIndex(approvalCv?.value),
    parseStatusText(approvalCv?.text),
  );

  const note = get(cols.empNoteColumnId)?.text?.trim() || undefined;
  const managerNote = get(cols.mgrNoteColumnId)?.text?.trim() || undefined;
  const decidedBy = parsePeople(get(cols.decidedByColumnId)?.value)[0];
  const decidedAt = parseDateText(get(cols.decidedAtColumnId)?.text) ?? undefined;
  const attachment = parseFile(get(cols.fileColumnId)?.value);
  const submittedAt = createdAtKey(item.created_at) ?? start;

  return {
    id: String(item.id),
    employeeId,
    type: resolvedType,
    start,
    end,
    status,
    note,
    managerNote,
    submittedAt,
    decidedBy: decidedBy ?? undefined,
    decidedAt,
    attachment,
  };
}

function mapCompanyDay(ctx: VacationCtx, item: RawItem, get: (id?: string) => RawColumnValue | undefined): CompanyDay | null {
  const { cols } = ctx;
  const start = parseDateText(get(cols.startDateColumnId)?.text);
  const end = parseDateText(get(cols.endDateColumnId)?.text);
  if (!start || !end) return null; // a general day needs a date range
  const mandatory = cols.mandatoryColumnId ? parseCheckbox(get(cols.mandatoryColumnId)?.value) : false;
  return { id: String(item.id), name: item.name ?? '', start, end, mandatory };
}

/**
 * Read board items whose range overlaps `scope` and split into personal
 * requests + general days. `scope` is an inclusive [from,to] `DayWindow`
 * (may span year boundaries) or a calendar-year number (legacy form —
 * existing callers keep working unchanged; defaults to the current year).
 * Server-side filtering (when date columns are mapped) is backed by a
 * client-side overlap filter so over-fetches never leak out of the window.
 */
export async function listEntries(
  ctx: VacationCtx,
  scope: ReadScope = new Date().getFullYear(),
): Promise<{ requests: DayOffRequest[]; companyDays: CompanyDay[] }> {
  const window = toWindow(scope);
  try {
    type Page = { cursor: string | null; items: RawItem[] };
    const items: RawItem[] = [];
    let cursor: string | null = null;
    const query = buildEntriesQuery(ctx, window);
    do {
      const data: { boards: { items_page: Page }[] } = await mondayApi.query<{
        boards: { items_page: Page }[];
      }>(query, { id: [String(ctx.boardId)], cursor });
      const page: Page | undefined = data.boards?.[0]?.items_page;
      if (page?.items) items.push(...page.items);
      cursor = page?.cursor ?? null;
    } while (cursor);

    const requests: DayOffRequest[] = [];
    const companyDays: CompanyDay[] = [];
    for (const item of items) {
      const get = (id?: string) => (id ? byId(item).get(id) : undefined);
      if (isPersonal(ctx, get)) {
        const r = mapRequest(ctx, item, get);
        if (r && rangeOverlapsWindow(r.start, r.end, window)) requests.push(r);
      } else {
        const c = mapCompanyDay(ctx, item, get);
        if (c && rangeOverlapsWindow(c.start, c.end, window)) companyDays.push(c);
      }
    }
    return { requests, companyDays };
  } catch (err) {
    logger.error('vacationService', 'listEntries failed', { window, err });
    throw err;
  }
}

/**
 * Fetch a single board item by id and map it to a `DayOffRequest`. Used by the
 * deep-link flow to open a request that falls outside the currently loaded year
 * window (where `listEntries` wouldn't have returned it). Returns null when the
 * item doesn't exist, isn't on this board, or isn't a personal request (e.g. a
 * general company day) — the caller treats null as "nothing to open".
 */
export async function getRequestById(ctx: VacationCtx, itemId: string): Promise<DayOffRequest | null> {
  const columnIds = entryColumnIds(ctx.cols);
  const colFragment = columnIds.length ? `(ids: ${JSON.stringify(columnIds)})` : '';
  const query = `query ($ids: [ID!]) {
  items(ids: $ids) { id name created_at column_values${colFragment} { id type text value } }
}`;
  try {
    const data = await mondayApi.query<{ items: RawItem[] }>(query, { ids: [String(itemId)] });
    const item = data.items?.[0];
    if (!item) return null;
    const cols = byId(item);
    const get = (id?: string) => (id ? cols.get(id) : undefined);
    if (!isPersonal(ctx, get)) return null;
    return mapRequest(ctx, item, get);
  } catch (err) {
    logger.error('vacationService', 'getRequestById failed', { itemId, err });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Personal request writes
// ---------------------------------------------------------------------------

/** Start/end date columns + the app-computed workdays count (shared by both kinds). */
function dateAndWorkdayColumns(cols: VacationColumnMap, start: DayKey, end: DayKey): ColumnValues {
  const out: ColumnValues = {};
  if (cols.startDateColumnId) out[cols.startDateColumnId] = formatDate(start);
  if (cols.endDateColumnId) out[cols.endDateColumnId] = formatDate(end);
  if (cols.workdaysColumnId) out[cols.workdaysColumnId] = formatNumber(workdaysBetween(start, end));
  return out;
}

function requestItemName(ctx: VacationCtx, employeeLabel: string, draft: RequestDraft): string {
  const typeMeta = ctx.personalTypes.find((opt) => opt.id === draft.type) ?? ctx.personalTypes[0];
  const typeLabel = typeMeta?.title?.trim() || draft.type;
  return `${employeeLabel} - ${typeLabel}`;
}

function requestDraftColumns(ctx: VacationCtx, draft: RequestDraft): ColumnValues {
  const { cols, personalTypes } = ctx;
  const out: ColumnValues = { ...dateAndWorkdayColumns(cols, draft.start, draft.end) };
  if (cols.personalTypeColumnId) {
    const typeMeta = personalTypes.find((opt) => opt.id === draft.type) ?? personalTypes[0];
    if (typeMeta) {
      const labelId = Number(typeMeta.id);
      if (Number.isFinite(labelId)) out[cols.personalTypeColumnId] = formatStatusIndex(labelId);
    }
  }
  if (cols.empNoteColumnId) out[cols.empNoteColumnId] = formatLongText(draft.note ?? '');
  return out;
}

export async function createRequest(
  ctx: VacationCtx,
  employeeId: string,
  draft: RequestDraft,
  employeeName?: string,
): Promise<void> {
  const { cols, statusValues, kindValues } = ctx;
  const itemName = requestItemName(ctx, employeeName?.trim() || employeeId, draft);
  try {
    const columns = requestDraftColumns(ctx, draft);
    if (cols.personColumnId) columns[cols.personColumnId] = formatPeople([employeeId]);
    if (cols.kindColumnId && kindValues.personal) columns[cols.kindColumnId] = formatStatusLabel(kindValues.personal);
    if (cols.approvalStatusColumnId) columns[cols.approvalStatusColumnId] = formatStatusLabel(statusValues.pending);
    const created = (await mondayApi.createItem(ctx.boardId, itemName, columns)) as { create_item?: { id?: string } };
    const newId = created?.create_item?.id;
    if (draft.attachment?.file && cols.fileColumnId && newId) {
      await mondayApi.addFileToColumn(newId, cols.fileColumnId, draft.attachment.file);
    }
  } catch (err) {
    logger.error('vacationService', 'createRequest failed', err);
    throw err;
  }
}

export async function updateRequest(
  ctx: VacationCtx,
  id: string,
  draft: RequestDraft,
  employeeName?: string,
  employeeId?: string,
): Promise<void> {
  const { cols, statusValues } = ctx;
  try {
    const columns = requestDraftColumns(ctx, draft);
    if (cols.approvalStatusColumnId) columns[cols.approvalStatusColumnId] = formatStatusLabel(statusValues.pending);
    await mondayApi.updateMultipleColumnValues(ctx.boardId, id, columns);
    await mondayApi.changeItemName(id, requestItemName(ctx, employeeName?.trim() || employeeId || '', draft));
    if (draft.attachment?.file && cols.fileColumnId) {
      await mondayApi.addFileToColumn(id, cols.fileColumnId, draft.attachment.file);
    }
  } catch (err) {
    logger.error('vacationService', 'updateRequest failed', err);
    throw err;
  }
}

/**
 * Attach a document to an existing request item (any status — e.g. adding a sick
 * note to an already-approved request). Requires a configured file column.
 */
/** Update employee and/or manager notes on an existing request (any status). */
export async function updateRequestNotes(
  ctx: VacationCtx,
  id: string,
  notes: { employeeNote?: string; managerNote?: string },
): Promise<void> {
  const { cols } = ctx;
  try {
    const columns: ColumnValues = {};
    if (notes.employeeNote !== undefined && cols.empNoteColumnId) {
      columns[cols.empNoteColumnId] = formatLongText(notes.employeeNote);
    }
    if (notes.managerNote !== undefined && cols.mgrNoteColumnId) {
      columns[cols.mgrNoteColumnId] = formatLongText(notes.managerNote);
    }
    if (!Object.keys(columns).length) return;
    await mondayApi.updateMultipleColumnValues(ctx.boardId, id, columns);
  } catch (err) {
    logger.error('vacationService', 'updateRequestNotes failed', err);
    throw err;
  }
}

export async function uploadAttachment(ctx: VacationCtx, itemId: string, file: File): Promise<void> {
  const { cols } = ctx;
  if (!cols.fileColumnId) throw new Error('No file column configured for the requests board');
  try {
    await mondayApi.addFileToColumn(itemId, cols.fileColumnId, file);
  } catch (err) {
    logger.error('vacationService', 'uploadAttachment failed', err);
    throw err;
  }
}

export async function setStatus(
  ctx: VacationCtx,
  id: string,
  status: RequestStatus,
  decidedBy: string,
  decidedAt: DayKey,
  managerNote?: string,
): Promise<void> {
  const { cols, statusValues } = ctx;
  try {
    const columns: ColumnValues = {};
    if (cols.approvalStatusColumnId) columns[cols.approvalStatusColumnId] = formatStatusLabel(statusValues[status]);
    if (cols.decidedByColumnId) columns[cols.decidedByColumnId] = formatPeople([decidedBy]);
    if (cols.decidedAtColumnId) columns[cols.decidedAtColumnId] = formatDate(decidedAt);
    if (managerNote != null && cols.mgrNoteColumnId) columns[cols.mgrNoteColumnId] = formatLongText(managerNote);
    await mondayApi.updateMultipleColumnValues(ctx.boardId, id, columns);
  } catch (err) {
    logger.error('vacationService', 'setStatus failed', err);
    throw err;
  }
}

export async function deleteRequest(id: string): Promise<void> {
  try {
    await mondayApi.deleteItem(id);
  } catch (err) {
    logger.error('vacationService', 'deleteRequest failed', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// General / company-day writes
// ---------------------------------------------------------------------------

function companyDayColumns(ctx: VacationCtx, draft: CompanyDayDraft): ColumnValues {
  const { cols, kindValues } = ctx;
  const out: ColumnValues = { ...dateAndWorkdayColumns(cols, draft.start, draft.end) };
  if (cols.kindColumnId && kindValues.general) out[cols.kindColumnId] = formatStatusLabel(kindValues.general);
  if (cols.mandatoryColumnId) out[cols.mandatoryColumnId] = formatCheckbox(draft.mandatory);
  return out;
}

export async function saveCompanyDay(ctx: VacationCtx, draft: CompanyDayDraft): Promise<void> {
  try {
    if (draft.id) {
      await mondayApi.updateMultipleColumnValues(ctx.boardId, draft.id, { ...companyDayColumns(ctx, draft), name: draft.name });
    } else {
      await mondayApi.createItem(ctx.boardId, draft.name, companyDayColumns(ctx, draft));
    }
  } catch (err) {
    logger.error('vacationService', 'saveCompanyDay failed', err);
    throw err;
  }
}

export async function deleteCompanyDay(id: string): Promise<void> {
  try {
    await mondayApi.deleteItem(id);
  } catch (err) {
    logger.error('vacationService', 'deleteCompanyDay failed', err);
    throw err;
  }
}

/** Thrown when a personal-type status label cannot be removed because board items use it. */
export class PersonalTypeInUseError extends Error {
  readonly i18nKey = 'settings.personalTypeInUse' as const;

  constructor() {
    super('settings.personalTypeInUse');
    this.name = 'PersonalTypeInUseError';
  }
}

/** True when at least one board item has the given personal-type label id selected. */
export async function isPersonalTypeLabelInUse(
  boardId: string,
  personalTypeColumnId: string,
  labelId: string,
): Promise<boolean> {
  const numericId = Number(labelId);
  if (!Number.isFinite(numericId)) return false;

  const items = (await mondayApi.getAllItems(boardId, [personalTypeColumnId])) as RawItem[];
  for (const item of items) {
    const cv = item.column_values?.find((c) => c.id === personalTypeColumnId);
    if (parseStatusIndex(cv?.value) === numericId) return true;
  }
  return false;
}

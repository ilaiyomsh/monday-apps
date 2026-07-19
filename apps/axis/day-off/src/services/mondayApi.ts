import { monday, logger } from '../core';
import type { PersonalTypeOption } from '../types';

/**
 * monday API layer — implements the `Monday-api-service` contract (standard #4).
 * Single funnel: every GraphQL call goes through `query()`; components/hooks never
 * call the SDK directly. Auto-retries on rate limits; errors bubble up as MondayApiError.
 * Uses the shared monday SDK + logger from `core` (@axis/app-core).
 */

export class MondayApiError extends Error {
  code?: string;
  response?: unknown;
  constructor(message: string, opts: { code?: string; response?: unknown } = {}) {
    super(message);
    this.name = 'MondayApiError';
    this.code = opts.code;
    this.response = opts.response;
  }
}

export type ColumnValues = Record<string, unknown>;
export interface MondayBoardOption {
  id: string;
  name: string;
}

interface RawBoardColumn {
  id?: string;
  type?: string;
  revision?: string;
  settings?: unknown;
  settings_str?: string;
}

interface StatusColumnSnapshot {
  labels: PersonalTypeOption[];
  revision?: string;
}
export interface MondayStatusColor {
  id: number;
  enum: string;
  hex: string;
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// API-latency health (v2 D5): round ms to a coarse step so repeated api_call
// health signals dedup at the transport instead of shipping a distinct message
// per call (query() is a hot path).
const roundMs = (ms: number): number => Math.round(ms / 250) * 250;

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (v instanceof Error) {
          const errRec = v as Error & { code?: string; response?: unknown; errorCode?: string };
          return {
            name: errRec.name,
            message: errRec.message,
            stack: errRec.stack,
            code: errRec.code,
            errorCode: errRec.errorCode,
            response: errRec.response,
          };
        }
        return v;
      },
      2,
    );
    // eslint-disable-next-line no-restricted-syntax -- error-guard FP-2: safeSerialize builds the logger's own payloads; calling the logger from this catch would recurse (see .claude/skills/error-guard/references/known-issues.md)
  } catch {
    return String(value);
  }
}

const STATUS_COLORS_BY_INDEX: Record<number, { enum: string; hex: string }> = {
  0: { enum: 'working_orange', hex: '#fdab3d' },
  1: { enum: 'done_green', hex: '#00c875' },
  2: { enum: 'stuck_red', hex: '#e2445c' },
  3: { enum: 'dark_blue', hex: '#0086c0' },
  4: { enum: 'purple', hex: '#9d50dd' },
  5: { enum: 'explosive', hex: '#ff642e' },
  6: { enum: 'grass_green', hex: '#037f4c' },
  7: { enum: 'bright_blue', hex: '#579bfc' },
  8: { enum: 'saladish', hex: '#cab641' },
  9: { enum: 'egg_yolk', hex: '#ffcb00' },
  10: { enum: 'blackish', hex: '#333333' },
  11: { enum: 'dark_red', hex: '#bb3354' },
  12: { enum: 'sofia_pink', hex: '#ff158a' },
  13: { enum: 'lipstick', hex: '#ff5ac4' },
  14: { enum: 'dark_purple', hex: '#784bd1' },
  15: { enum: 'bright_green', hex: '#9cd326' },
  16: { enum: 'chili_blue', hex: '#66ccff' },
  17: { enum: 'american_gray', hex: '#808080' },
  18: { enum: 'brown', hex: '#7f5347' },
  19: { enum: 'dark_orange', hex: '#d974b0' },
  101: { enum: 'sunset', hex: '#ff7575' },
  102: { enum: 'bubble', hex: '#faa1f1' },
  103: { enum: 'peach', hex: '#ffadad' },
  104: { enum: 'berry', hex: '#e8697d' },
  105: { enum: 'winter', hex: '#9aadbd' },
  106: { enum: 'river', hex: '#68a1bd' },
  107: { enum: 'navy', hex: '#225091' },
  108: { enum: 'aquamarine', hex: '#4eccc6' },
  109: { enum: 'indigo', hex: '#5559df' },
  110: { enum: 'dark_indigo', hex: '#401694' },
  151: { enum: 'pecan', hex: '#563e3e' },
  152: { enum: 'lavender', hex: '#a25ddc' },
  153: { enum: 'royal', hex: '#2b76e5' },
  154: { enum: 'steel', hex: '#a9bee8' },
  155: { enum: 'orchid', hex: '#dce3ea' },
  156: { enum: 'lilac', hex: '#bda8f0' },
  157: { enum: 'tan', hex: '#a0a0a0' },
  158: { enum: 'sky', hex: '#a1e3f6' },
  159: { enum: 'coffee', hex: '#bd816e' },
  160: { enum: 'teal', hex: '#2da283' },
};
export const MONDAY_STATUS_COLORS: MondayStatusColor[] = Object.entries(STATUS_COLORS_BY_INDEX)
  .map(([id, v]) => ({ id: Number(id), enum: v.enum, hex: v.hex }))
  .sort((a, b) => a.id - b.id);
const STATUS_COLOR_ENUM_BY_INDEX: Record<number, string> = Object.fromEntries(
  Object.entries(STATUS_COLORS_BY_INDEX).map(([k, v]) => [Number(k), v.enum]),
);
const STATUS_COLOR_HEX_BY_INDEX: Record<number, string> = Object.fromEntries(
  Object.entries(STATUS_COLORS_BY_INDEX).map(([k, v]) => [Number(k), v.hex]),
);
const STATUS_COLOR_HEX_BY_ENUM: Record<string, string> = Object.fromEntries(
  Object.values(STATUS_COLORS_BY_INDEX).map((v) => [v.enum, v.hex]),
);
const STATUS_COLOR_ENUM_SET = new Set(Object.values(STATUS_COLOR_ENUM_BY_INDEX));

function normalizeStatusColorValue(color: string | number | undefined): string {
  if (typeof color === 'number' && Number.isFinite(color)) {
    const mapped = STATUS_COLOR_ENUM_BY_INDEX[color];
    if (mapped) return mapped;
    throw new Error(`Unsupported status color numeric ID: ${color}`);
  }
  if (typeof color === 'string') {
    const normalized = color.trim().toLowerCase();
    if (STATUS_COLOR_ENUM_SET.has(normalized)) return normalized;
    const asNumber = Number(color);
    if (normalized !== '' && Number.isFinite(asNumber)) {
      const mapped = STATUS_COLOR_ENUM_BY_INDEX[asNumber];
      if (mapped) return mapped;
      throw new Error(`Unsupported status color numeric ID string: ${color}`);
    }
    throw new Error(`Unsupported status color enum: ${color}`);
  }
  throw new Error('Missing status color value');
}

function resolveStatusColorHex(color: string | number | undefined): string | undefined {
  if (typeof color === 'number' && Number.isFinite(color)) return STATUS_COLOR_HEX_BY_INDEX[color];
  if (typeof color === 'string') {
    const normalized = color.trim().toLowerCase();
    if (STATUS_COLOR_HEX_BY_ENUM[normalized]) return STATUS_COLOR_HEX_BY_ENUM[normalized];
    const asNumber = Number(normalized);
    if (normalized !== '' && Number.isFinite(asNumber)) return STATUS_COLOR_HEX_BY_INDEX[asNumber];
  }
  return undefined;
}

async function query<T = unknown>(graphql: string, variables?: Record<string, unknown>): Promise<T> {
  let attempt = 0;
  for (;;) {
    const t0 = performance.now();
    logger.api('query', graphql, variables);
    try {
      const res = (await monday.api(graphql, { variables })) as { data?: T; errors?: unknown[] };
      logger.apiResponse('query', performance.now() - t0);
      if (res.errors?.length) {
        logger.error('mondayApi', 'GraphQL response errors (full payload)', {
          graphql,
          variables: safeSerialize(variables ?? {}),
          response: safeSerialize(res),
          errors: safeSerialize(res.errors),
        });
        throw new MondayApiError('GraphQL errors', { response: res.errors });
      }
      // API-latency health (v2 D5): terminal success only — bucketed so it dedups.
      logger.health('api_call', { ms: roundMs(performance.now() - t0), ok: true });
      return res.data as T;
    } catch (err) {
      const code = (err as { errorCode?: string })?.errorCode;
      const rateLimited = code === 'COMPLEXITY_BUDGET_EXHAUSTED' || code === 'RATE_LIMIT_EXCEEDED';
      if (rateLimited && attempt < MAX_RETRIES) {
        const backoff = 2 ** attempt * 500;
        logger.warn('mondayApi', `rate limited, retrying in ${backoff}ms`, { attempt });
        attempt += 1;
        await sleep(backoff);
        continue;
      }
      // API-latency health (v2 D5): terminal failure only — outside the retry loop.
      logger.health('api_call', { ok: false, code });
      logger.error('mondayApi', 'GraphQL request failed (full payload)', {
        graphql,
        variables: safeSerialize(variables ?? {}),
        error: safeSerialize(err),
        code,
        response: err instanceof MondayApiError ? safeSerialize(err.response) : undefined,
      });
      logger.apiError('query', err);
      throw err instanceof MondayApiError ? err : new MondayApiError(String((err as Error)?.message ?? err), { code });
    }
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch (err) {
      logger.warn('MondayApi', 'failed to parse JSON object — using null', {
        err,
        rawPreview: raw.slice(0, 120),
      });
      return null;
    }
  }
  return null;
}

function parseJsonArray(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      logger.warn('MondayApi', 'failed to parse JSON array — using null', {
        err,
        rawPreview: raw.slice(0, 120),
      });
      return null;
    }
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseStatusColumnSnapshot(column: RawBoardColumn | undefined): PersonalTypeOption[] {
  const settings = parseJsonObject(column?.settings) ?? parseJsonObject(column?.settings_str);
  if (!settings) return [];
  const labelsArray = parseJsonArray(settings.labels) ?? parseJsonArray(settings.labels_v2) ?? null;
  if (labelsArray) {
    const out: PersonalTypeOption[] = [];
    for (const entry of labelsArray) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const title = typeof rec.label === 'string' ? rec.label.trim() : '';
      if (!title) continue;
      const rawIndex = rec.index;
      const index =
        typeof rawIndex === 'number' && Number.isFinite(rawIndex)
          ? rawIndex
          : typeof rawIndex === 'string' && rawIndex.trim() !== '' && Number.isFinite(Number(rawIndex))
            ? Number(rawIndex)
            : out.length;
      const rawId = rec.id;
      const id =
        typeof rawId === 'number' || (typeof rawId === 'string' && rawId.trim() !== '')
          ? String(rawId)
          : String(index);
      const color =
        (typeof rec.hex === 'string' && rec.hex) ||
        resolveStatusColorHex(typeof rec.color === 'number' || typeof rec.color === 'string' ? rec.color : undefined) ||
        'var(--color-event-vacation)';
      const colorValue = typeof rec.color === 'number' || typeof rec.color === 'string' ? rec.color : undefined;
      const isDeactivated = rec.is_deactivated === true;
      if (isDeactivated) continue;
      out.push({ id, title, color, index });
      out[out.length - 1].colorValue = colorValue;
      out[out.length - 1].isDone = rec.is_done === true;
      out[out.length - 1].isDeactivated = false;
    }
    out.sort((a, b) => a.index - b.index);
    return out;
  }
  const labels =
    parseJsonObject(settings.labels) ??
    parseJsonObject(settings.labels_v2) ??
    parseJsonObject(settings.label_names) ??
    null;
  const labelsColors =
    parseJsonObject(settings.labels_colors) ??
    parseJsonObject(settings.label_colors) ??
    parseJsonObject(settings.colors) ??
    null;
  const labelsIds =
    parseJsonObject(settings.labels_ids) ??
    parseJsonObject(settings.label_ids) ??
    null;
  if (!labels && !labelsColors) return [];

  const out: PersonalTypeOption[] = [];
  const keys = new Set<string>([
    ...Object.keys(labels ?? {}),
    ...Object.keys(labelsColors ?? {}),
  ]);
  for (const indexKey of keys) {
    const index = Number(indexKey);
    if (!Number.isFinite(index)) continue;
    const rawTitle = labels?.[indexKey];
    const colorObj = labelsColors ? asRecord(labelsColors[indexKey]) : null;
    const colorTitle = typeof colorObj?.label === 'string' ? colorObj.label : typeof colorObj?.title === 'string' ? colorObj.title : '';
    const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle : colorTitle;
    if (title.trim() === '') continue;
    const color =
      (typeof colorObj?.color === 'string' && colorObj.color) ||
      (typeof colorObj?.border === 'string' && colorObj.border) ||
      'var(--color-event-vacation)';
    const idFromIdsMap = labelsIds?.[indexKey];
    const idFromColorMeta = colorObj?.id ?? colorObj?.label_id;
    const id = String(idFromIdsMap ?? idFromColorMeta ?? indexKey);
    out.push({
      id,
      title,
      color,
      colorValue: (colorObj?.color as string | number | undefined) ?? undefined,
      index,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

export const mondayApi = {
  raw: monday,
  query,

  getBoard: (boardId: string | number) =>
    query(`query ($id: [ID!]) { boards(ids: $id) { id name columns { id title type settings settings_str } groups { id title } } }`, {
      id: [String(boardId)],
    }),

  async getStatusColumnSnapshotMeta(boardId: string | number, columnId: string): Promise<StatusColumnSnapshot> {
    const data = (await query(
      `query ($id: [ID!]) {
         boards(ids: $id) { columns { id type revision settings settings_str } }
       }`,
      { id: [String(boardId)] },
    )) as { boards?: { columns?: RawBoardColumn[] }[] };
    const col = (data.boards?.[0]?.columns ?? []).find((c) => String(c.id ?? '') === columnId);
    const snapshot = parseStatusColumnSnapshot(col);
    return { labels: snapshot, revision: col?.revision };
  },

  async getStatusColumnSnapshot(boardId: string | number, columnId: string): Promise<PersonalTypeOption[]> {
    return (await mondayApi.getStatusColumnSnapshotMeta(boardId, columnId)).labels;
  },

  async updateStatusColumnSettings(
    boardId: string | number,
    columnId: string,
    revision: string,
    labels: PersonalTypeOption[],
    existingLabelIds: ReadonlySet<number> = new Set(),
  ): Promise<void> {
    const labelsInput = labels
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((label) => {
        const numericId = Number(label.id);
        const isExisting = Number.isFinite(numericId) && existingLabelIds.has(numericId);
        return {
          ...(isExisting ? { id: numericId } : {}),
          color: normalizeStatusColorValue(label.colorValue ?? label.color),
          label: label.title,
          index: label.index,
          isDeactivated: Boolean(label.isDeactivated),
        };
      });
    const labelsLiteral = labelsInput
      .map((label) => {
        const fields = [
          Number.isFinite(label.id) ? `id: ${label.id}` : null,
          `color: ${label.color}`,
          `label: ${JSON.stringify(label.label)}`,
          `index: ${label.index}`,
          label.isDeactivated ? 'is_deactivated: true' : null,
        ].filter(Boolean);
        return `{ ${fields.join(', ')} }`;
      })
      .join(',\n          ');
    const mutation = `mutation ($boardId: ID!, $columnId: String!, $revision: String!) {
         update_status_column(board_id: $boardId, id: $columnId, revision: $revision, settings: {
          labels: [
          ${labelsLiteral}
          ]
         }) { id }
       }`;
    const variables = { boardId: String(boardId), columnId, revision };
    try {
      await query(mutation, variables);
    } catch (err) {
      logger.error('mondayApi', 'update_status_column failed (full payload)', {
        mutation,
        variables: safeSerialize(variables),
        labelsInput: safeSerialize(labelsInput),
        error: safeSerialize(err),
        response: err instanceof MondayApiError ? safeSerialize(err.response) : undefined,
      });
      throw err;
    }
  },

  /**
   * List all account boards via page-based pagination and filter by board type.
   * Used by settings board-picker to show names (not raw ids).
   */
  async listBoardsByType(allowedTypes: string[] = ['board']): Promise<MondayBoardOption[]> {
    const LIMIT = 500;
    const out: MondayBoardOption[] = [];
    const seen = new Set<string>();
    const normalized = new Set(allowedTypes.map((t) => t.toLowerCase()));

    for (let page = 1; page < 100; page += 1) {
      const data = (await query(
        `query ($limit: Int!, $page: Int!) {
           boards(limit: $limit, page: $page) { id name type }
         }`,
        { limit: LIMIT, page },
      )) as { boards?: { id?: string | number; name?: string; type?: string }[] };

      const batch = data.boards ?? [];
      for (const board of batch) {
        const id = String(board.id ?? '');
        const name = String(board.name ?? '');
        const type = String(board.type ?? '').toLowerCase();
        if (!id || !name || seen.has(id)) continue;
        if (normalized.size && !normalized.has(type)) continue;
        seen.add(id);
        out.push({ id, name });
      }
      if (batch.length < LIMIT) break;
    }

    out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    return out;
  },

  /** Owner user ids of a board — used to grant settings access to board owners. */
  async getBoardOwners(boardId: string | number): Promise<{ id: string }[]> {
    const data = (await query(`query ($id: [ID!]) { boards(ids: $id) { owners { id } } }`, {
      id: [String(boardId)],
    })) as { boards?: { owners?: { id: string | number }[] }[] };
    return (data.boards?.[0]?.owners ?? []).map((o) => ({ id: String(o.id) }));
  },

  async getAllItems(boardId: string | number, columnIds?: string[]): Promise<unknown[]> {
    const items: unknown[] = [];
    let cursor: string | null = null;
    do {
      const data = (await query(
        `query ($id: [ID!], $cursor: String) {
           boards(ids: $id) {
             items_page(limit: 100, cursor: $cursor) {
               cursor
               items { id name column_values${columnIds ? `(ids: ${JSON.stringify(columnIds)})` : ''} { id type text value } }
             }
           }
         }`,
        { id: [String(boardId)], cursor },
      )) as { boards: { items_page: { cursor: string | null; items: unknown[] } }[] };
      const page = data.boards?.[0]?.items_page;
      if (page?.items) items.push(...page.items);
      cursor = page?.cursor ?? null;
    } while (cursor);
    return items;
  },

  createItem: (boardId: string | number, name: string, columnValues: ColumnValues = {}, groupId?: string) =>
    query(
      `mutation ($boardId: ID!, $name: String!, $cols: JSON, $groupId: String) {
         create_item(board_id: $boardId, item_name: $name, column_values: $cols, group_id: $groupId) { id }
       }`,
      { boardId: String(boardId), name, cols: JSON.stringify(columnValues), groupId },
    ),

  updateMultipleColumnValues: (boardId: string | number, itemId: string | number, columnValues: ColumnValues) =>
    query(
      `mutation ($boardId: ID!, $itemId: ID!, $cols: JSON!) {
         change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols) { id }
       }`,
      { boardId: String(boardId), itemId: String(itemId), cols: JSON.stringify(columnValues) },
    ),

  deleteItem: (itemId: string | number) =>
    query(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id: String(itemId) }),

  changeItemName: (itemId: string | number, name: string) =>
    query(`mutation ($id: ID!, $name: String!) { change_item_name(item_id: $id, name: $name) { id } }`, {
      id: String(itemId),
      name,
    }),

  /**
   * Upload a file to a file-type column on an item. Relies on monday's seamless
   * auth: when a `File` is passed as a variable, the platform auto-translates the
   * request to a multipart upload (View apps only). The File is passed through the
   * query funnel untouched (not JSON-stringified).
   */
  addFileToColumn: (itemId: string | number, columnId: string, file: File) =>
    query(
      `mutation ($itemId: ID!, $columnId: String!, $file: File!) {
         add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id }
       }`,
      { itemId: String(itemId), columnId, file },
    ),

  // Global storage keyed by instanceId (matches the Axis convention — see SettingsContext).
  storageGet: (key: string) => monday.storage.getItem(key),
  storageSet: (key: string, value: string) => monday.storage.setItem(key, value),
};

export default mondayApi;

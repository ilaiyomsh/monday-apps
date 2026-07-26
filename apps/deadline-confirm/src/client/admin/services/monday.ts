// monday-sdk-js singleton + the two seamless-auth reads the admin view needs
// (spec §9: board/column/label pickers do NOT go through our server).
// Seamless calls ride the parent-negotiated API version; `settings` (typed
// JSON) replaced the deprecated legacy string form in 2025-10.

import mondaySdk from 'monday-sdk-js';
import type { Board, BoardColumn, StatusLabel } from '../types';
import logger from '../utils/logger';
import { latencyBucket } from '../utils/latency';

const monday = mondaySdk();

let sessionTokenPromise: Promise<string> | null = null;

export function getSessionToken(): Promise<string> {
  if (!sessionTokenPromise) {
    sessionTokenPromise = monday
      .get('sessionToken')
      .then((res: { data?: string }) => {
        if (!res?.data) throw new Error('sessionToken unavailable');
        return res.data;
      })
      .catch((err: unknown) => {
        sessionTokenPromise = null; // allow retry on next call
        throw err;
      });
  }
  return sessionTokenPromise;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function seamlessApi<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const t0 = Date.now();
  // API-latency health (D5): bucketed so repeated signals dedup; ships as kind='health'
  // (inert until the Axiom sink is active).
  const reportLatency = (ok: boolean): void =>
    logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok });
  let res: GraphQLResponse<T>;
  try {
    res = (await monday.api(query, variables ? { variables } : undefined)) as GraphQLResponse<T>;
  } catch (err) {
    // network/SDK throw (not a GraphQL error response) — record latency + rethrow
    reportLatency(false);
    throw err;
  }
  // GraphQL soft errors arrive inside a resolved promise — throw at the funnel.
  if (res.errors?.length) {
    reportLatency(false);
    throw new Error(`monday.api error: ${res.errors.map((e) => e.message).join('; ')}`);
  }
  if (!res.data) {
    reportLatency(false);
    throw new Error('monday.api returned no data');
  }
  reportLatency(true);
  return res.data;
}

// The raw boards() query returns every board-like OBJECT — real work boards,
// but also sub-item boards, docs and custom objects. The pickers must offer
// only real boards.
//
// PROBE-VERIFIED 2026-07-27 (API 2026-07, account with 1000+ objects) — the
// discriminator is `type`, NOT `object_type_unique_key`:
//   type:  board 330 | sub_items_board 80 | custom_object 56 | document 34
//   object_type_unique_key: null for 304 of the 330 real boards, and equally
//   null for every document / sub-item board / custom object. When non-null it
//   only ever appeared on type='board', as
//   'work-management::{standalone|project|portfolio-project|portfolio}'.
//
// Filtering on object_type_unique_key therefore dropped 100% of boards and the
// picker rendered "No options" in production. It is still useful, but only as a
// NEGATIVE signal and only when actually present — it must never exclude a
// board whose key is null.
export const REAL_BOARD_TYPE = 'board';
export const BOARDS_PAGE_SIZE = 500;
/** Ceiling on paging, so a huge account cannot spin here forever. */
export const BOARDS_MAX_PAGES = 6;

/** Object keys that are board-typed but are not a plain work board. */
const EXCLUDED_OBJECT_KEYS = new Set(['portfolio', 'portfolio-project']);

interface RawBoardRow {
  id: string;
  name: string;
  type?: string | null;
  object_type_unique_key?: string | null;
}

/** True only for a real work board. See the probe notes above. */
export function isRealBoard(board: { type?: string | null; object_type_unique_key?: string | null }): boolean {
  if (board.type !== REAL_BOARD_TYPE) return false;
  const key = board.object_type_unique_key;
  if (typeof key !== 'string') return true; // null/absent = a plain work board (the common case)
  const bare = key.includes('::') ? (key.split('::').pop() ?? '') : key;
  return !EXCLUDED_OBJECT_KEYS.has(bare);
}

const ADMIN_BOARDS_QUERY = `query AdminBoards($limit: Int!, $page: Int!) {
  boards(limit: $limit, page: $page, order_by: used_at) { id name type object_type_unique_key }
}`;

/**
 * Every real work board the viewer can see, most-recently-used first.
 *
 * Pages until a page comes back short. The probe account returned a FULL first
 * page (500) and another 500 on page 2, so a single request silently hid
 * boards — including any board the operator had not touched recently.
 * Hitting the page cap is surfaced through the logger, never swallowed.
 */
export async function fetchBoards(): Promise<Board[]> {
  const boards: Board[] = [];

  for (let page = 1; page <= BOARDS_MAX_PAGES; page += 1) {
    const data = await seamlessApi<{ boards: Array<RawBoardRow | null> }>(ADMIN_BOARDS_QUERY, {
      limit: BOARDS_PAGE_SIZE,
      page,
    });
    const rows = (data.boards ?? []).filter((b): b is RawBoardRow => Boolean(b));

    for (const b of rows) {
      if (isRealBoard(b)) boards.push({ id: b.id, name: b.name });
    }

    // A short page is the last page. Only a full page can hide more.
    if (rows.length < BOARDS_PAGE_SIZE) return boards;
  }

  logger.warn('admin', 'board_list_truncated', {
    pages: BOARDS_MAX_PAGES,
    scanned: BOARDS_PAGE_SIZE * BOARDS_MAX_PAGES,
    kept: boards.length,
  });
  return boards;
}

interface RawSettingsLabel {
  id: number;
  label: string;
  index: number;
  is_deactivated?: boolean;
}

export function parseStatusLabels(settings: unknown): StatusLabel[] {
  const labels = (settings as { labels?: RawSettingsLabel[] } | null)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((l) => l && typeof l.id === 'number' && !l.is_deactivated)
    .map((l) => ({ id: l.id, label: l.label, index: l.index, isDeactivated: false }))
    .sort((a, b) => a.index - b.index);
}

export async function fetchBoardColumns(boardId: string): Promise<BoardColumn[]> {
  const data = await seamlessApi<{
    boards: Array<{
      columns: Array<{ id: string; title: string; type: string; settings: unknown } | null>;
    } | null>;
  }>(
    `query AdminColumns($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        columns(types: [status, people, date, email]) { id title type settings }
      }
    }`,
    { boardIds: [boardId] }
  );
  const columns = data.boards?.[0]?.columns ?? [];
  return columns
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type as BoardColumn['type'],
      labels: c.type === 'status' ? parseStatusLabels(c.settings) : [],
    }));
}

export async function openOauthTab(): Promise<void> {
  // auth.monday.com may refuse to render inside the iframe (spec §8) — new tab.
  // v3: /oauth/start derives the connecting ACCOUNT from the sessionToken.
  try {
    const token = await getSessionToken();
    window.open(`/oauth/start?st=${encodeURIComponent(token)}`, '_blank', 'noopener');
  } catch (err) {
    // Without a sessionToken there is no account context to connect.
    logger.error('monday', 'oauth_open_failed', err);
  }
}

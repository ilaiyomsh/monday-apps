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

export async function fetchBoards(): Promise<Board[]> {
  const data = await seamlessApi<{ boards: Array<{ id: string; name: string } | null> }>(
    `query AdminBoards { boards(limit: 200, order_by: used_at) { id name } }`
  );
  return (data.boards ?? []).filter((b): b is Board => Boolean(b));
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
        columns(types: [status, people, date]) { id title type settings }
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

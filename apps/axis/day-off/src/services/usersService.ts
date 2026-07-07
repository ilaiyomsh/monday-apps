/**
 * usersService — resolves monday user ids into the app's `Employee` shape.
 * Single API funnel via `mondayApi.query`. `initials` and accent `color` are
 * derived locally (color is a deterministic, id-hashed pick from PALETTE).
 */
import { mondayApi } from './mondayApi';
import { logger } from '../core';
import type { Employee } from '../domain/types';

/** Accent palette — mirrors the prototype EMPLOYEE colors (data.jsx). */
const PALETTE = ['#0073ea', '#a25ddc', '#ff642e', '#00c875', '#579bfc', '#e2445c'] as const;

interface MondayUser {
  id: string | number;
  name?: string | null;
  title?: string | null;
  photo_thumb_small?: string | null;
}

/** First letters of up to 2 name words. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

/** Deterministic palette pick by hashing the id. */
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const USERS_QUERY = `query ($ids: [ID!]) {
  users(ids: $ids) { id name title photo_thumb_small }
}`;

const ALL_USERS_QUERY = `query ($limit: Int!, $page: Int!) {
  users(limit: $limit, page: $page, kind: non_guests) { id name title photo_thumb_small enabled }
}`;

/** Map a raw monday user → the app's Employee shape. */
function toEmployee(u: MondayUser): Employee {
  const id = String(u.id);
  const name = u.name ?? '';
  return {
    id,
    name,
    title: u.title ?? undefined,
    initials: initialsOf(name),
    color: colorFor(id),
    photoUrl: u.photo_thumb_small ?? undefined,
  };
}

const ME_QUERY = `query { me { id name title photo_thumb_small } }`;

/**
 * The authenticated user, resolved from the session via `me` — reliable even
 * when monday's context.user is absent (standalone Custom Object apps).
 */
export async function getMe(): Promise<Employee | null> {
  try {
    const data = await mondayApi.query<{ me: MondayUser | null }>(ME_QUERY);
    return data.me ? toEmployee(data.me) : null;
  } catch (err) {
    logger.error('usersService', 'getMe failed', err);
    throw err;
  }
}

export async function resolveUsers(ids: string[]): Promise<Employee[]> {
  if (!ids.length) return [];
  try {
    const data = await mondayApi.query<{ users: MondayUser[] | null }>(USERS_QUERY, {
      ids: ids.map((id) => String(id)),
    });
    return (data.users ?? []).map(toEmployee);
  } catch (err) {
    logger.error('usersService', 'resolveUsers failed', err);
    throw err;
  }
}

/** Fetch every active (non-guest) user in the account — for the team people-picker. */
export async function listAllUsers(): Promise<Employee[]> {
  const LIMIT = 200;
  try {
    const out: Employee[] = [];
    for (let page = 1; ; page += 1) {
      const data = await mondayApi.query<{ users: (MondayUser & { enabled?: boolean | null })[] | null }>(
        ALL_USERS_QUERY,
        { limit: LIMIT, page },
      );
      const batch = data.users ?? [];
      out.push(...batch.filter((u) => u.enabled !== false).map(toEmployee));
      if (batch.length < LIMIT) break;
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    return out;
  } catch (err) {
    logger.error('usersService', 'listAllUsers failed', err);
    throw err;
  }
}

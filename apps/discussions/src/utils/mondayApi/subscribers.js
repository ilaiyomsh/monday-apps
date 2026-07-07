/*
 * Board membership + account invites — the API behind the "אנשים בלוח" section
 * of the "הרשאות" settings tab (Phase 5). Mirrors monday's native board-members
 * panel: list owners/members, add/remove people, promote/demote owners, subscribe
 * the account-wide team, and invite brand-new people to the account by email.
 *
 * Permissions in this app are ADVISORY (client-side only). These calls touch the
 * REAL monday board membership / account so an owner can manage the people the
 * permission matrix then governs. They are NOT a security boundary.
 *
 * Avatars use a photo field chosen at runtime by ensureUserPhotoSelection()
 * (photo_thumb when the effective API version is < 2026-10, else photo_url
 * { small }) — the seamless iframe version isn't ours to assume, so we detect it.
 *
 * Every call goes through api() so assertNoGraphQLErrors runs after safeApi
 * (safeApi alone does NOT throw on GraphQL soft-errors). Reads are plain queries;
 * writes are mutations that must surface soft-errors.
 *
 * WRITE-PATH IDS ARE INLINED as numeric literals (Number()-coerced ⇒ injection
 * safe). This matches monday's proven-working call form for these membership
 * mutations and sidesteps any seamless-SDK variable quirk. The mutation shapes
 * and the owner/subscriber/demote semantics below were verified live against the
 * API (2026-07 AND 2026-10) before shipping.
 */
import { api, ensureUserPhotoSelection, normalizePhoto } from './monday-client.js';
import logger from '../logger.js';

// Account slug, memoized — used to build native monday deep-links (e.g. the
// board/object subscribers page). Read from `me { account { slug } }` (me:read
// scope). Returns null if unavailable so callers can fall back gracefully.
let _accountSlug;
export async function getAccountSlug() {
  if (_accountSlug !== undefined) return _accountSlug;
  try {
    const data = await api(`query { me { account { slug } } }`, {}, 'getAccountSlug');
    _accountSlug = data?.me?.account?.slug || null;
  } catch {
    _accountSlug = null;
  }
  return _accountSlug;
}

/**
 * List a board's owners and subscribers (members).
 * Returns `{ owners: Person[], subscribers: Person[], teams: Team[] }` where
 * Person is `{ id, name, photoUrl }`. Falls back to empty arrays when the board
 * isn't found (e.g. unmapped board id in local dev).
 */
export async function getBoardPeople(boardId) {
  // Photo field is resolved by probing the live schema (see ensureUserPhotoSelection);
  // at the seamless version (2026-07) `photo_url { small }` is accepted.
  const photo = await ensureUserPhotoSelection();
  const personFields = `id name ${photo}`.trim();
  // IMPORTANT: `team_subscribers` is deliberately OMITTED. It is UNAUTHORIZED for
  // this app's seamless scope (verified live: UNAUTHORIZED_FIELD_OR_TYPE at
  // boards.team_subscribers), and including it fails the ENTIRE query with a
  // generic "Graphql validation errors" — which is what broke avatar loading with
  // BOTH photo_thumb and photo_url. owners/subscribers + photo_url ARE authorized.
  // The account-wide "everyone" team therefore isn't reflected here (teams: []);
  // it is managed in monday's native board-members panel.
  const data = await api(
    `query ($boardId: [ID!]) {
       boards(ids: $boardId) {
         board_kind
         owners { ${personFields} }
         subscribers { ${personFields} }
       }
     }`,
    { boardId: [String(boardId)] },
    'getBoardPeople'
  );
  const board = data?.boards?.[0];
  const map = (p) => ({ id: String(p.id), name: p.name, photoUrl: normalizePhoto(p) });
  const result = {
    // board_kind 'public' = shared with EVERYONE in the account (all account
    // members are implicit subscribers). Individual add/remove is futile there —
    // the picker surfaces this so a "successful" remove that doesn't stick is
    // explained rather than looking broken. 'private'/'share' honor explicit
    // subscriptions and individual removal works.
    boardKind: board?.board_kind || null,
    owners: (board?.owners || []).map(map),
    subscribers: (board?.subscribers || []).map(map),
    teams: [], // team_subscribers is unauthorized for this app's scope (see above)
  };
  // Diagnostic: which board did we read, its sharing kind, and exactly who came
  // back as owner vs member. Enable in prod with enableDebugLogs() in the console.
  logger.info('subscribers', 'getBoardPeople result', {
    boardId: String(boardId),
    boardKind: result.boardKind,
    owners: result.owners.map((p) => ({ id: p.id, name: p.name })),
    subscriberCount: result.subscribers.length,
  });
  return result;
}

/**
 * Set the board membership KIND for the given users.
 *   kind='subscriber' → plain member. On an EXISTING owner this DEMOTES them to a
 *                       member (verified live) — this is the "remove owner" path.
 *   kind='owner'      → owner (also implies member). PROMOTES an existing member.
 * `add_users_to_board` is monday's modern membership mutation; its `kind` enum
 * (BoardSubscriberKind) is LOWERCASE {subscriber|owner}. Returns the affected
 * users (`[{ id }]`) or [].
 */
export async function setBoardMembers(boardId, userIds, kind = 'subscriber') {
  const ids = (userIds || []).map((id) => Number(id)).filter(Number.isFinite);
  if (!ids.length) return [];
  const kindEnum = String(kind).toLowerCase() === 'owner' ? 'owner' : 'subscriber';
  const data = await api(
    `mutation {
       add_users_to_board(board_id: ${Number(boardId)}, user_ids: [${ids.join(', ')}], kind: ${kindEnum}) { id }
     }`,
    {},
    'setBoardMembers'
  );
  const affected = data?.add_users_to_board ?? [];
  logger.info('subscribers', 'setBoardMembers result', {
    boardId: Number(boardId), userIds: ids, kind: kindEnum, affected,
  });
  return affected;
}

/**
 * Remove users from a board entirely (both member and owner status).
 * Returns the removed users (`[{ id }]`) or null.
 */
export async function removeBoardMembers(boardId, userIds) {
  const ids = (userIds || []).map((id) => Number(id)).filter(Number.isFinite);
  if (!ids.length) return null;
  const data = await api(
    `mutation {
       delete_subscribers_from_board(board_id: ${Number(boardId)}, user_ids: [${ids.join(', ')}]) { id }
     }`,
    {},
    'removeBoardMembers'
  );
  const removed = data?.delete_subscribers_from_board ?? null;
  logger.info('subscribers', 'removeBoardMembers result', {
    boardId: Number(boardId), userIds: ids, removed,
  });
  // A remove that returns nothing (or fewer than requested) means monday didn't
  // detach the user — surface it so the silent no-op is visible while debugging.
  if (!removed || removed.length < ids.length) {
    logger.warn('subscribers', 'removeBoardMembers removed fewer than requested', {
      boardId: Number(boardId), requested: ids, removed,
    });
  }
  return removed;
}

/**
 * Add the account-wide "Everyone at <account>" team (team id -1) as a board
 * subscriber. Returns the affected team (`[{ id }]`) or null.
 */
export async function addEveryoneTeam(boardId) {
  const data = await api(
    `mutation {
       add_teams_to_board(board_id: ${Number(boardId)}, kind: subscriber, team_ids: [-1]) { id }
     }`,
    {},
    'addEveryoneTeam'
  );
  return data?.add_teams_to_board ?? null;
}

/**
 * Remove team subscriptions from a board (a real team id, or -1 everyone).
 * Returns the affected team ids (`[{ id }]`) or null.
 */
export async function removeTeamFromBoard(boardId, teamIds) {
  const ids = (teamIds || []).map((id) => Number(id)).filter(Number.isFinite);
  if (!ids.length) return null;
  const data = await api(
    `mutation {
       delete_teams_from_board(board_id: ${Number(boardId)}, team_ids: [${ids.join(', ')}]) { id }
     }`,
    {},
    'removeTeamFromBoard'
  );
  return data?.delete_teams_from_board ?? null;
}

// Account roles invite_users accepts (UserRole enum). MEMBER is the sensible
// default for a board collaborator; VIEW_ONLY/GUEST/ADMIN are the other tiers.
export const ACCOUNT_ROLES = ['MEMBER', 'VIEW_ONLY', 'GUEST', 'ADMIN'];

/**
 * Invite brand-new people to the ACCOUNT by email (monday's native "invite by
 * email"). Once accepted they become account users the board pickers can add.
 * `emails` are inlined via JSON.stringify (correct GraphQL string escaping ⇒
 * injection-safe). Returns `{ invited: User[], errors: {message,code,email}[] }`.
 */
export async function inviteUsersToAccount(emails, userRole = 'MEMBER') {
  const list = (emails || []).map((e) => String(e).trim()).filter(Boolean);
  if (!list.length) return { invited: [], errors: [] };
  const roleEnum = ACCOUNT_ROLES.includes(String(userRole).toUpperCase())
    ? String(userRole).toUpperCase()
    : 'MEMBER';
  const data = await api(
    `mutation {
       invite_users(emails: ${JSON.stringify(list)}, user_role: ${roleEnum}) {
         invited_users { id name }
         errors { message code email }
       }
     }`,
    {},
    'inviteUsersToAccount'
  );
  const res = data?.invite_users;
  return { invited: res?.invited_users ?? [], errors: res?.errors ?? [] };
}

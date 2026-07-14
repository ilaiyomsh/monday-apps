// allowedUsersService — resolves the set of users a team-people column is
// allowed to select, in a TWO-call chain against the monday API (the iframe
// SDK bridge serializes api() calls, so round-trips — not complexity — set the
// dialog's load time; this chain used to be four serial calls):
//
//   q1 GetColumnValue     source item's board_relation link + the linked
//                         (target) items' people column (nested via
//                         linked_items) + the item's own selection.
//   q2 GetTeamsAndUsers   members of every referenced team + details for
//                         listed persons / stale-selection ids, in ONE
//                         document (@include skips an empty side).
//
// All monday reads go through mondayService.query, which RESOLVES GraphQL soft
// errors into a thrown Error (200-with-errors). Every such throw is wrapped into
// an AppError(API_ERROR) — never swallowed. Structural problems raise typed
// AppErrors so the UI can show a specific Hebrew message.

import mondayService from './mondayService.js';
import { parseCellValue } from '../domain/cellValue.js';
import { buildAllowedList } from '../domain/buildAllowedList.js';
import { policyFromSettings } from '../domain/settingsSchema.js';
import { GET_COLUMN_VALUE, GET_TEAMS_AND_USERS } from './graphqlQueries.js';

/**
 * A typed application error carrying a stable `code` and a user-facing Hebrew
 * `userMessage`. `cause` preserves the underlying error for logging upstream.
 */
export class AppError extends Error {
  constructor({ code, userMessage, cause } = {}) {
    super(userMessage || code || 'AppError');
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) this.cause = cause;
  }
}

// User-facing Hebrew messages per code (RTL-first; kept short for toast/inline).
const USER_MESSAGES = {
  NOT_CONFIGURED: 'העמודה לא הוגדרה עדיין. פתחו את הגדרות העמודה כדי לבחור עמודת חיבור לוחות ועמודת אנשים.',
  RELATION_COLUMN_MISSING: 'עמודת חיבור הלוחות שהוגדרה אינה קיימת עוד. בדקו את הגדרות העמודה.',
  RELATION_COLUMN_TYPE_CHANGED: 'עמודת חיבור הלוחות שונתה לסוג אחר. בדקו את הגדרות העמודה.',
  PEOPLE_COLUMN_DRIFT: 'עמודת האנשים שהוגדרה אינה קיימת עוד בפריטים המקושרים. בדקו את הגדרות העמודה.',
  PERMISSION_BLOCKED: 'אין לכם הרשאה לצפות בפריטים המקושרים, ולכן לא ניתן לחשב את רשימת המשתמשים המורשים.',
  API_ERROR: 'אירעה שגיאה בטעינת הנתונים מ-monday. נסו שוב מאוחר יותר.',
};

const appError = (code, cause) =>
  new AppError({ code, userMessage: USER_MESSAGES[code] || code, cause });

// Every monday read funnels through here so a soft/hard error becomes exactly
// one AppError(API_ERROR) with the original cause preserved (never swallowed).
async function runQuery(query, variables) {
  try {
    return await mondayService.query(query, variables);
  } catch (err) {
    throw appError('API_ERROR', err);
  }
}

const uniq = (arr) => [...new Set(arr)];

/**
 * Resolve the allowed-user set for a team-people column instance.
 *
 * @param {{ itemId:string, columnId:string, settings:object, onStep?:(step:string)=>void }} args
 *   `onStep` (optional) is invoked with the chain phase about to run
 *   ('teams' before q2) so the UI can show a step-labeled loading state.
 * @returns {Promise<{ users, teams, selection, partial, emptyChain, missingTeamIds, hadLinkedItems }>}
 *   `selection` entries carry the resolved { name, photo_thumb } when known
 *   (team members ∪ user-details lookup) so a stale selection still renders a
 *   named chip.
 * @throws {AppError} NOT_CONFIGURED | RELATION_COLUMN_MISSING |
 *   RELATION_COLUMN_TYPE_CHANGED | PEOPLE_COLUMN_DRIFT | PERMISSION_BLOCKED | API_ERROR
 */
export async function fetchAllowedUsers({ itemId, columnId, settings, onStep } = {}) {
  const step = (phase) => {
    if (typeof onStep === 'function') onStep(phase);
  };
  // --- config guard -------------------------------------------------------
  if (
    !settings ||
    settings.version == null ||
    !settings.relationColumnId ||
    !settings.peopleColumnId
  ) {
    throw appError('NOT_CONFIGURED');
  }
  const { relationColumnId, peopleColumnId } = settings;
  const policy = policyFromSettings(settings);

  // --- q1: relation link + nested linked-items people + own selection -----
  const q1 = await runQuery(GET_COLUMN_VALUE, {
    itemIds: [String(itemId)],
    columnIds: [relationColumnId, columnId],
    peopleColumnIds: [peopleColumnId],
  });
  const sourceItem = q1?.items?.[0];
  const sourceCols = Array.isArray(sourceItem?.column_values) ? sourceItem.column_values : [];

  const relCv = sourceCols.find((c) => c && c.id === relationColumnId);
  if (!relCv) throw appError('RELATION_COLUMN_MISSING');
  if (relCv.type !== 'board_relation') throw appError('RELATION_COLUMN_TYPE_CHANGED');

  const linkedItemIds = uniq((relCv.linked_item_ids || []).map(String));

  // Own-column selection (persons stored on THIS column); raw JSON string value.
  const ownCv = sourceCols.find((c) => c && c.id === columnId);
  const selection = parseCellValue(ownCv?.value ?? null);

  // --- linked items' people column (nested in q1 via linked_items) --------
  let perItemEntries = [];
  let partial = false;
  const hadLinkedItems = linkedItemIds.length > 0;

  if (linkedItemIds.length > 0) {
    // linked_items resolves like items(ids:) — items the caller cannot read
    // are silently omitted, so the requested-vs-returned comparison below
    // still detects blocked/partial visibility.
    const returnedItems = Array.isArray(relCv.linked_items) ? relCv.linked_items : [];

    if (returnedItems.length === 0) {
      // None of the linked items came back -> caller can't read any.
      throw appError('PERMISSION_BLOCKED');
    }
    if (returnedItems.length < linkedItemIds.length) {
      partial = true;
    }

    let anyPeopleColumn = false;
    perItemEntries = returnedItems.map((item) => {
      const peopleCol = (Array.isArray(item?.column_values) ? item.column_values : []).find(
        (c) => c && c.id === peopleColumnId,
      );
      if (peopleCol) anyPeopleColumn = true;
      const entries = (Array.isArray(peopleCol?.persons_and_teams) ? peopleCol.persons_and_teams : [])
        .filter((e) => e && e.id != null)
        .map((e) => ({ id: String(e.id), kind: e.kind }));
      return { itemId: String(item.id), entries };
    });

    if (!anyPeopleColumn) {
      // The people column is gone from every linked item -> settings drift.
      throw appError('PEOPLE_COLUMN_DRIFT');
    }
  }

  // --- q2: team members + user details in ONE call -------------------------
  const teamIds = uniq(
    perItemEntries.flatMap((pi) => pi.entries.filter((e) => e.kind === 'team').map((e) => e.id)),
  );
  // User-details ids are requested UNFILTERED by team membership (membership is
  // unknown until this same call returns) — the redundancy is a few cheap ids,
  // and it buys merging the former q3+q4 into one round-trip.
  const listedPersonIds = policy.includeListedPersons
    ? perItemEntries.flatMap((pi) => pi.entries.filter((e) => e.kind === 'person').map((e) => e.id))
    : [];
  const staleSelectionIds = selection.map((s) => String(s.id));
  const detailUserIds = uniq([...listedPersonIds, ...staleSelectionIds]);

  let q2 = null;
  if (teamIds.length > 0 || detailUserIds.length > 0) {
    step('teams');
    q2 = await runQuery(GET_TEAMS_AND_USERS, {
      teamIds,
      userIds: detailUserIds,
      includeTeams: teamIds.length > 0,
      includeUsers: detailUserIds.length > 0,
    });
  }

  const teamsMap = {};
  for (const team of Array.isArray(q2?.teams) ? q2.teams : []) {
    teamsMap[String(team.id)] = {
      id: String(team.id),
      name: team.name,
      // Team avatar for the dialog title (Team.picture_url; null when unset).
      picture: team.picture_url ?? null,
      users: (Array.isArray(team.users) ? team.users : []).map((u) => ({
        id: String(u.id),
        name: u.name,
        // API boundary: the query selects photo_url { thumb }; map it back to
        // the internal photo_thumb key. `?? u.photo_thumb` keeps the
        // captured-fixture (old flat field) path working (see MANIFEST.md).
        photo_thumb: u.photo_url?.thumb ?? u.photo_thumb,
      })),
    };
  }

  // ids already covered by a resolved team's membership.
  const teamMemberIds = new Set();
  for (const team of Object.values(teamsMap)) {
    for (const u of team.users) teamMemberIds.add(String(u.id));
  }

  // User details for listed persons + stale-selection ids. Ids also covered by
  // a team are dropped here: the nested teams selection returns real photo
  // URLs while the ROOT users field resolves photo_url null for anyone but the
  // caller (live-probed quirk, 2026-07) — team-resolved details must win.
  const usersById = {};
  for (const u of Array.isArray(q2?.users) ? q2.users : []) {
    const uid = String(u.id);
    if (teamMemberIds.has(uid)) continue;
    usersById[uid] = {
      id: uid,
      name: u.name,
      photo_thumb: u.photo_url?.thumb ?? u.photo_thumb,
    };
  }

  // --- aggregate ----------------------------------------------------------
  const { users, teams, emptyChain, missingTeamIds } = buildAllowedList(
    perItemEntries,
    teamsMap,
    policy,
    usersById,
  );

  // Resolved user details across every source: user-details lookups ∪ team memberships.
  // A stale selection whose id is NOT in the allowed set still resolves its
  // name/photo here, so the picker renders a named chip instead of a "?" one.
  const resolvedUsersById = { ...usersById };
  for (const team of Object.values(teamsMap)) {
    for (const u of team.users) {
      if (!resolvedUsersById[u.id]) resolvedUsersById[u.id] = u;
    }
  }
  const enrichedSelection = selection.map((s) => {
    const u = resolvedUsersById[String(s.id)];
    return u
      ? { id: String(s.id), kind: s.kind, name: u.name, photo_thumb: u.photo_thumb }
      : { id: String(s.id), kind: s.kind };
  });

  return {
    users,
    teams,
    selection: enrichedSelection,
    partial,
    emptyChain,
    missingTeamIds,
    hadLinkedItems,
  };
}

export default fetchAllowedUsers;

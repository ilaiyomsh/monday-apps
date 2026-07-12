// allowedUsersService — resolves the set of users a team-people column is
// allowed to select, by walking the q1..q4 chain against the monday API:
//
//   q1 GetColumnValue        source item's board_relation link + its own people
//                            column selection.
//   q2 GetLinkedItemsPeople  the linked (target) items' people column — the
//                            teams/persons that define the allowed set.
//   q3 GetTeamsMembers       members of every referenced team.
//   q4 GetUsersDetails       details for listed persons + stale-selection ids
//                            not covered by any resolved team.
//
// All monday reads go through mondayService.query, which RESOLVES GraphQL soft
// errors into a thrown Error (200-with-errors). Every such throw is wrapped into
// an AppError(API_ERROR) — never swallowed. Structural problems raise typed
// AppErrors so the UI can show a specific Hebrew message.

import mondayService from './mondayService.js';
import { parseCellValue } from '../domain/cellValue.js';
import { buildAllowedList } from '../domain/buildAllowedList.js';
import { policyFromSettings } from '../domain/settingsSchema.js';
import {
  GET_COLUMN_VALUE,
  GET_LINKED_ITEMS_PEOPLE,
  GET_TEAMS_MEMBERS,
  GET_USERS_DETAILS,
} from './graphqlQueries.js';

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
 *   ('linkedPeople' before q2, 'teams' before q3) so the UI can show a
 *   step-labeled loading state.
 * @returns {Promise<{ users, teams, selection, partial, emptyChain, missingTeamIds, hadLinkedItems }>}
 *   `selection` entries carry the resolved { name, photo_thumb } when known
 *   (team members ∪ q4 lookup) so a stale selection still renders a named chip.
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

  // --- q1: source item's relation link + own-column selection -------------
  const q1 = await runQuery(GET_COLUMN_VALUE, {
    itemIds: [String(itemId)],
    columnIds: [relationColumnId, columnId],
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

  // --- q2: linked items' people column ------------------------------------
  let perItemEntries = [];
  let partial = false;
  const hadLinkedItems = linkedItemIds.length > 0;

  if (linkedItemIds.length > 0) {
    step('linkedPeople');
    const q2 = await runQuery(GET_LINKED_ITEMS_PEOPLE, {
      itemIds: linkedItemIds,
      columnIds: [peopleColumnId],
    });
    const returnedItems = Array.isArray(q2?.items) ? q2.items : [];

    if (returnedItems.length === 0) {
      // None of the requested linked items came back -> caller can't read any.
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

  // --- q3: team members ---------------------------------------------------
  const teamIds = uniq(
    perItemEntries.flatMap((pi) => pi.entries.filter((e) => e.kind === 'team').map((e) => e.id)),
  );
  const teamsMap = {};
  if (teamIds.length > 0) {
    step('teams');
    const q3 = await runQuery(GET_TEAMS_MEMBERS, { teamIds });
    for (const team of Array.isArray(q3?.teams) ? q3.teams : []) {
      teamsMap[String(team.id)] = {
        id: String(team.id),
        name: team.name,
        users: (Array.isArray(team.users) ? team.users : []).map((u) => ({
          id: String(u.id),
          name: u.name,
          // API boundary: GET_TEAMS_MEMBERS now selects photo_url { thumb }; map it
          // back to the internal photo_thumb key. `?? u.photo_thumb` keeps the
          // captured-fixture (old flat field) path working (see MANIFEST.md).
          photo_thumb: u.photo_url?.thumb ?? u.photo_thumb,
        })),
      };
    }
  }

  // ids already covered by a resolved team's membership.
  const teamMemberIds = new Set();
  for (const team of Object.values(teamsMap)) {
    for (const u of team.users) teamMemberIds.add(String(u.id));
  }

  // --- q4: user details for listed persons + stale-selection ids ----------
  // Only ids NOT already covered by a team need a details lookup.
  const listedPersonIds = policy.includeListedPersons
    ? perItemEntries.flatMap((pi) => pi.entries.filter((e) => e.kind === 'person').map((e) => e.id))
    : [];
  const staleSelectionIds = selection.map((s) => String(s.id));
  const needUserIds = uniq([...listedPersonIds, ...staleSelectionIds]).filter(
    (id) => !teamMemberIds.has(id),
  );

  const usersById = {};
  if (needUserIds.length > 0) {
    const q4 = await runQuery(GET_USERS_DETAILS, { userIds: needUserIds });
    for (const u of Array.isArray(q4?.users) ? q4.users : []) {
      usersById[String(u.id)] = {
        id: String(u.id),
        name: u.name,
        // API boundary: GET_USERS_DETAILS now selects photo_url { thumb }; map it
        // back to the internal photo_thumb key (`?? u.photo_thumb` keeps captures working).
        photo_thumb: u.photo_url?.thumb ?? u.photo_thumb,
      };
    }
  }

  // --- aggregate ----------------------------------------------------------
  const { users, teams, emptyChain, missingTeamIds } = buildAllowedList(
    perItemEntries,
    teamsMap,
    policy,
    usersById,
  );

  // Resolved user details across every source: q4 lookups ∪ team memberships.
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

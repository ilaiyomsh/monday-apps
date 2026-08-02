/*
 * ============================================================================
 *  FIRST-RUN PROVISIONING — extend the current board + create the other two
 * ============================================================================
 *
 *  This is a board-view app: it always runs INSIDE an existing board, which we
 *  treat as the DISCUSSIONS board. On first launch (settings empty) the
 *  SetupWizard offers to build everything automatically:
 *    1. ADD the discussions columns to the CURRENT board (context.boardId) —
 *       we do NOT create a discussions board.
 *    2. CREATE the topics + decisions boards (in the same workspace), and for the
 *       tasks board either CREATE a new one or CONNECT an existing board the owner
 *       chose (tasks.mode 'create' | 'connect').
 *    3. Enable subitems on the topics board (the `subtasks` COLUMN TYPE is not
 *       supported by the API, so we trigger it via create_subitem on a throwaway
 *       item, read the auto-created subitems board id from the subtasks column's
 *       settings_str, then delete the throwaway item) and add its checkbox cols.
 *    4. Wire the board_relation columns (defaults `{ boardIds: [<id>] }` —
 *       verified to link correctly against the live API).
 *  Returns a ready `{ boards, columns }` config that SettingsContext persists.
 *
 *  Idempotent-ish: columns are matched by (title, type) on each board and reused
 *  if already present, so a retry after a partial run won't duplicate columns.
 *  All mutations go through api() (throws on GraphQL soft-errors); progress is
 *  reported via onProgress(step, total, label).
 * ============================================================================
 */

import { api } from './monday-client.js';
import { detectManagedDropdownColumnId, findManagedDropdownColumnByTitle } from './managedColumns.js';
import logger from '../logger.js';

const MODULE = 'provisionBoards';
// The account-level managed dropdown's title. One constant so the create and the
// idempotent title lookup can never drift apart (round312).
const MANAGED_TYPE_TITLE = 'סוג דיון';

/*
 * Status column (tasks.statusID) — exact label set, display order and colors the
 * user requested (verified against the live board). Stable label ids: בעבודה=0,
 * בוצע=1 (is_done), תקוע=2, טרם החל=3, blank=5. `labels_positions_v2` is the
 * DISPLAY order (blank, טרם החל, בעבודה, תקוע, בוצע); `done_colors:[1]` marks
 * בוצע as done.
 */
const STATUS_DEFAULTS = JSON.stringify({
  labels: { 0: 'בעבודה', 1: 'בוצע', 2: 'תקוע', 3: 'טרם החל', 5: '' },
  labels_positions_v2: { 0: 2, 1: 4, 2: 3, 3: 1, 5: 0 },
  labels_colors: {
    0: { color: '#fdab3d', border: '#e99729', var_name: 'orange' },
    1: { color: '#00c875', border: '#00b461', var_name: 'green-shadow' },
    2: { color: '#df2f4a', border: '#ce3048', var_name: 'red-shadow' },
    3: { color: '#007eb5', border: '#3db0df', var_name: 'blue-links' },
    5: { color: '#c4c4c4', border: '#b0b0b0', var_name: 'grey' },
  },
  done_colors: [1],
});

/*
 * Decision status column (decisions.decisionStatusID) — matches the live
 * decisions board: הוקפאה=0 (blue), בתוקף=1 (green, is_done), בוטלה=2 (red).
 * Display order: הוקפאה, בוטלה, בתוקף. "בתוקף" must exist — it's the default
 * status a new decision gets (see useDecisions).
 */
const DECISION_STATUS_DEFAULTS = JSON.stringify({
  labels: { 0: 'הוקפאה', 1: 'בתוקף', 2: 'בוטלה' },
  labels_positions_v2: { 0: 0, 1: 2, 2: 1 },
  labels_colors: {
    0: { color: '#579bfc', border: '#4387e8', var_name: 'bright-blue' },
    1: { color: '#00c875', border: '#00b461', var_name: 'green-shadow' },
    2: { color: '#df2f4a', border: '#ce3048', var_name: 'red-shadow' },
  },
  done_colors: [1],
});

/*
 * Decision TRACKING column (decisions.decisionTrackingID) — round153, per the
 * owner's spec. Five labels in this display order, "התקבלה" first = the default
 * a new decision gets (see useDecisions). Labels are read from the mapped column
 * at runtime, so editing them on the board is reflected instantly; this default
 * only shapes a freshly-provisioned board.
 */
const DECISION_TRACKING_DEFAULTS = JSON.stringify({
  labels: { 0: 'התקבלה', 1: 'הועברה ליישום', 2: 'מיושמת חלקית', 3: 'מיושמת באופן מלא', 4: 'נבחנת מחדש' },
  labels_positions_v2: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  labels_colors: {
    0: { color: '#c4c4c4', border: '#b0b0b0', var_name: 'grey' },
    1: { color: '#579bfc', border: '#4387e8', var_name: 'bright-blue' },
    2: { color: '#fdab3d', border: '#e99729', var_name: 'orange' },
    3: { color: '#00c875', border: '#00b461', var_name: 'green-shadow' },
    4: { color: '#007eb5', border: '#3db0df', var_name: 'blue-links' },
  },
  done_colors: [3],
});

/*
 * The confirmed, trimmed column set (matches the live boards + what the code
 * reads/writes). `type` is a monday ColumnType. Order = board layout order.
 * `relations` are created LAST (need the target board id). `subitems` columns
 * are created on the auto-generated subitems board of the topics board.
 *
 * The `discussions` board is the CURRENT board — its columns are added to it,
 * the board itself is not created. `previousDiscussionID` self-links to it.
 */
export const PROVISION_SPEC = {
  discussions: {
    isCurrentBoard: true,
    // round141b — used ONLY when createDiscussionsBoard is set (custom-object
    // install, where there is no meaningful host board to extend).
    name: 'דיונים',
    columns: [
      { alias: 'discussionCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'discussionLeadID', type: 'people', title: 'מוביל דיון' },
      // round294 — the COORDINATOR role ("מרכז דיון") is a first-class access
      // source (accessRoleSources.taskEditorsID = lead + coordinator + creator),
      // so it must exist on a fresh board for מרכז הדיון to flow into the tasks
      // "יכולת עריכה" column on task creation. Previously unprovisioned, so a
      // coordinator could never be assigned out of the box.
      { alias: 'discussionCoordinatorID', type: 'people', title: 'מרכז דיון' },
      { alias: 'participantsID', type: 'people', title: 'משתתפים' },
      // round312 — EXTERNAL participants (round211). The alias has been in
      // COLUMN_SCHEMA since round211 but was never provisioned, so on every fresh
      // install the column did not exist and nothing could be mapped to it — the
      // whole external-participants feature silently hid (owner-reported from a new
      // account install). long_text holding comma-separated names.
      { alias: 'externalParticipantsID', type: 'long_text', title: 'משתתפים חיצוניים' },
      { alias: 'creationDateID', type: 'date', title: 'תאריך יצירה' },
      { alias: 'discussionDateID', type: 'date', title: 'תאריך הדיון' },
      { alias: 'summaryFileID', type: 'file', title: 'קובץ סיכום (DOCS)' },
    ],
    // All connections are bidirectional (allowCreateReflectionColumn). The
    // reflection auto-created on the TARGET board IS the back-link the app maps:
    // discussions→topics reflects as topics.discussionLinkID; discussions→tasks as
    // tasks.discussionLinkID. We rename each reflection to "דיונים" and map it, so we do
    // NOT create separate relation columns on topics/tasks. previousDiscussionID is
    // a self-link (no reflection mapped).
    relations: [
      {
        alias: 'topicsBoardLinkID',
        target: 'topics',
        title: 'נושאים לדיון',
        reflection: { board: 'topics', alias: 'discussionLinkID', title: 'דיונים' },
      },
      {
        alias: 'tasksBoardLinkID',
        target: 'tasks',
        title: 'משימות',
        reflection: { board: 'tasks', alias: 'discussionLinkID', title: 'דיונים' },
      },
      {
        alias: 'decisionsBoardLinkID',
        target: 'decisions',
        title: 'החלטות',
        reflection: { board: 'decisions', alias: 'discussionLinkID', title: 'דיון' },
      },
      { alias: 'previousDiscussionID', target: 'discussions', title: 'דיון קודם' },
    ],
  },
  topics: {
    name: 'נושאים לדיון',
    columns: [
      { alias: 'topicCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'topicCreationDateID', type: 'date', title: 'תאריך יצירה' }, // round115
      { alias: 'topicNotForDiscussionID', type: 'checkbox', title: 'האם להציג' },
      // round313 — per-topic priority. Live: TopicsTab renders the cell off
      // `useStatusOptions('topics','topicPriorityID')`, useTopics writes it, and it is
      // a mappable row in TOPICS_SETTINGS_FIELDS — but it was never provisioned, so on
      // a fresh install the cell had no column and simply never appeared.
      { alias: 'topicPriorityID', type: 'status', title: 'עדיפות' },
    ],
    // discussionLinkID (back-link to discussions) is created as the reflection of
    // discussions.topicsBoardLinkID — see above.
    relations: [],
    /*
     * round312 — COLUMN_SCHEMA.topics declares SEVEN subitem aliases; this list
     * carried only two, so on a fresh install monday's default English subitem
     * columns (Owner/Status/Date) were all the board had and the other five aliases
     * stayed unmapped (owner-reported: "the subitem column names are not in Hebrew
     * and are not mapped"). All seven are provisioned now.
     */
    subitems: [
      { alias: 'pointNotForDiscussionID', type: 'checkbox', title: 'האם להציג' },
      { alias: 'pointCreationDateID', type: 'date', title: 'תאריך יצירה' }, // round115
      { alias: 'pointCheckedID', type: 'checkbox', title: 'האם נידונה' },
      { alias: 'pointCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'pointResponsesID', type: 'long_text', title: 'התייחסויות' },
    ],
    // round312 — the two subitem-level connect-boards columns. They live on the
    // topics SUBITEMS board (a point links to its own decisions/tasks), which the
    // top-level `relations` loop cannot reach: that loop only knows the four main
    // boards. Handled by a dedicated pass keyed on the subitems board id.
    subitemRelations: [
      { alias: 'pointDecisionsLinkID', target: 'decisions', title: 'החלטות' },
      { alias: 'pointTasksLinkID', target: 'tasks', title: 'משימות' },
    ],
  },
  tasks: {
    name: 'משימות',
    columns: [
      { alias: 'taskCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'taskCreationDateID', type: 'date', title: 'תאריך יצירה' }, // round115
      { alias: 'responsibilityID', type: 'people', title: 'אחריות' },
      // round312 — "שותפים" (round305). Same gap as externalParticipantsID: the
      // alias reached COLUMN_SCHEMA but not this spec, so a fresh tasks board had
      // no partners column and the "המשימות שלי" partners cell had nothing to map.
      { alias: 'partnersID', type: 'people', title: 'שותפים' },
      { alias: 'deadlineID', type: 'date', title: 'דד ליין' },
      { alias: 'statusID', type: 'status', title: 'סטאטוס', defaults: STATUS_DEFAULTS },
      { alias: 'detailsID', type: 'long_text', title: 'מקור המשימה' },
      // round294 — the tasks board ALWAYS carries a people column "יכולת עריכה"
      // (taskEditorsID). It is the INFRASTRUCTURE column into which task creation
      // from a discussion writes the discussion's creator + coordinator + manager
      // (accessRoleSources.taskEditorsID). Provisioning it here means: a freshly
      // CREATED tasks board gets it; a CONNECTED existing board has it ensured by
      // (title,type) — created if absent, reused if present; and a post-install
      // top-up run completes+maps it on boards that predate this. Without it the
      // column was never mapped, so the editors write in useTasks was a silent
      // no-op (owner-reported: the roles never landed in the board).
      { alias: 'taskEditorsID', type: 'people', title: 'יכולת עריכה' },
    ],
    // discussionLinkID (back-link to discussions) is the reflection of
    // discussions.tasksBoardLinkID — see above.
    relations: [
      /*
       * round313 — task → the TOPIC it was created from. useTasks:454 writes it on
       * every task created out of a topic (`relations.topicsLinkID = { linkedItems:
       * [{ id: topicId }] }`, where topicId is the topic ITEM's id — TopicsTab:1240),
       * but the column was never provisioned and is deliberately absent from the tasks
       * mapping screen, so that write resolved to no column and was a silent no-op on
       * every install: the task→topic link was never recorded anywhere.
       *
       * Bidirectional, so the reflection monday creates on the topics board becomes
       * `topics.tasksLinkID` ("חיבור למשימות") — the topics-side alias that was equally
       * unprovisioned. One relation closes both.
       */
      {
        alias: 'topicsLinkID',
        target: 'topics',
        title: 'נושאים לדיון',
        reflection: { board: 'topics', alias: 'tasksLinkID', title: 'משימות' },
      },
    ],
  },
  decisions: {
    name: 'החלטות',
    columns: [
      { alias: 'decisionCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'deciderID', type: 'people', title: 'מקבל ההחלטה' },
      { alias: 'affectedID', type: 'people', title: 'מושפעים' },
      { alias: 'decisionStatusID', type: 'status', title: 'סטאטוס', defaults: DECISION_STATUS_DEFAULTS },
      { alias: 'decisionTrackingID', type: 'status', title: 'מעקב החלטה', defaults: DECISION_TRACKING_DEFAULTS },
      { alias: 'decisionDateID', type: 'date', title: 'תאריך' },
    ],
    // discussionLinkID (back-link to discussions) is the reflection of
    // discussions.decisionsBoardLinkID — created automatically, mapped by mapReflection.
    relations: [],
  },
};

const BOARD_ORDER = ['discussions', 'topics', 'tasks', 'decisions'];

// Count every unit of work so the wizard can show a real progress bar.
function countSteps(tasks, createDiscussionsBoard = false) {
  let n = 0;
  for (const key of BOARD_ORDER) {
    const spec = PROVISION_SPEC[key];
    // create_board — skipped for the current board (discussions, unless a
    // custom-object install creates it too), and for tasks when connecting an
    // existing board instead of creating a new one.
    if (spec.isCurrentBoard) {
      if (createDiscussionsBoard) n += 1;
    } else if (!(key === 'tasks' && tasks?.mode === 'connect')) n += 1;
    n += spec.columns.length;
    n += (spec.relations || []).length;
    // enable subitems (once) + its own columns + (round312) its connect-boards columns
    if (spec.subitems || spec.subitemRelations) {
      n += 1 + (spec.subitems || []).length + (spec.subitemRelations || []).length;
    }
  }
  n += 2; // managed type column "סוג דיון": account-level dropdown on discussions + the SAME column attached to tasks (round126)
  return n;
}

async function createBoard(name, workspaceId) {
  const vars = { name, kind: 'public' };
  if (workspaceId) vars.wsId = String(workspaceId);
  const data = await api(
    `mutation ($name: String!, $kind: BoardKind!, $wsId: ID) {
      create_board(board_name: $name, board_kind: $kind, workspace_id: $wsId) { id }
    }`,
    vars,
    'create_board'
  );
  const id = data?.create_board?.id;
  if (!id) throw new Error(`create_board לא החזיר מזהה עבור "${name}"`);
  return String(id);
}

async function readColumns(boardId) {
  const data = await api(
    `query ($b: [ID!]) { boards(ids: $b) { columns { id title type settings_str } } }`,
    { b: [String(boardId)] },
    'read_columns'
  );
  return data?.boards?.[0]?.columns || [];
}

// Create a column, or reuse an existing one matched by (title, type) — keeps the
// wizard safe to re-run after a partial failure. `existing` is the board's
// current column list (from readColumns).
async function ensureColumn(boardId, existing, title, columnType, defaults) {
  const hit = (existing || []).find((c) => c.title === title && c.type === columnType);
  if (hit) return String(hit.id);
  const data = await api(
    `mutation ($boardId: ID!, $title: String!, $type: ColumnType!, $defaults: JSON) {
      create_column(board_id: $boardId, title: $title, column_type: $type, defaults: $defaults) { id }
    }`,
    { boardId: String(boardId), title, type: columnType, defaults: defaults || null },
    'create_column'
  );
  const id = data?.create_column?.id;
  if (!id) throw new Error(`create_column לא החזיר מזהה עבור "${title}"`);
  if (existing) existing.push({ id, title, type: columnType }); // keep cache fresh
  return String(id);
}

/*
 * "סוג דיון" (discussion type) is provisioned as an ACCOUNT-LEVEL MANAGED
 * DROPDOWN column: create_dropdown_managed_column (account) → its UUID, then
 * attach_dropdown_managed_column (board) → the board column instance. Created
 * EMPTY (no preset labels — each account defines its own types); labels are
 * added later via update_dropdown_managed_column using the persisted UUID.
 * round312 (owner decision 2026-08-02: "the discussion-type column is ALWAYS
 * managed") — this used to adopt ANY board dropdown titled "סוג דיון"/"סוג" as the
 * type column, returning managedColumnId: null. On a customer's real board "סוג" is
 * an ordinary column name, so the app happily mapped a PLAIN dropdown as the type
 * column; adding a type then took the board-level update_dropdown_column path,
 * which is what failed in the new account. An existing column is now adopted only
 * when it can be tied to a managed column — by the caller's known UUID, or by
 * label-signature detection. Otherwise a managed column is attached and mapped.
 *
 * Idempotence without a UUID comes from a title lookup on the ACCOUNT
 * (findManagedDropdownColumnByTitle): detection cannot recognise an EMPTY managed
 * column, so a bare re-run would otherwise mint a second account-level "סוג דיון"
 * — clutter the app cannot clean up.
 */
export async function ensureManagedTypeColumn(boardId, existing, knownManagedId = null) {
  const hit = (existing || []).find(
    (c) => c.type === 'dropdown' && (c.title === 'סוג דיון' || c.title === 'סוג')
  );
  if (hit) {
    if (knownManagedId) return { id: String(hit.id), managedColumnId: String(knownManagedId) };
    const detected = await detectManagedDropdownColumnId(boardId, String(hit.id));
    if (detected) return { id: String(hit.id), managedColumnId: String(detected) };
    logger.warn(MODULE, 'קיימת עמודת dropdown רגילה בשם סוג/סוג דיון — מחוברת עמודה מנוהלת במקומה', {
      boardId: String(boardId), plainColumnId: String(hit.id), plainTitle: hit.title,
    });
  }
  let managedColumnId = knownManagedId || (await findManagedDropdownColumnByTitle(MANAGED_TYPE_TITLE));
  if (!managedColumnId) {
    const created = await api(
      `mutation ($t: String!) { create_dropdown_managed_column(title: $t) { id } }`,
      { t: MANAGED_TYPE_TITLE },
      'create_dropdown_managed_column'
    );
    managedColumnId = created?.create_dropdown_managed_column?.id;
    if (!managedColumnId) throw new Error('create_dropdown_managed_column לא החזיר מזהה');
  }
  const attached = await api(
    `mutation ($b: ID!, $mc: ID!) { attach_dropdown_managed_column(board_id: $b, managed_column_id: $mc) { id } }`,
    { b: String(boardId), mc: String(managedColumnId) },
    'attach_dropdown_managed_column'
  );
  const colId = attached?.attach_dropdown_managed_column?.id;
  if (!colId) throw new Error('attach_dropdown_managed_column לא החזיר מזהה עמודה');
  if (existing) existing.push({ id: colId, title: 'סוג דיון', type: 'dropdown' });
  return { id: String(colId), managedColumnId: String(managedColumnId) };
}

/*
 * The `subtasks` COLUMN TYPE is not creatable via the API. Enable subitems the
 * supported way: create one subitem (auto-creates the subitems board), read the
 * subitems board id from the parent's subtasks column settings, then remove the
 * throwaway item (deleting it cascades to its subitem). Idempotent: if subitems
 * are already enabled, just return the existing subitems board id.
 */
async function ensureSubitemsBoard(parentBoardId) {
  const findSub = (cols) => {
    const c = (cols || []).find((x) => x.type === 'subtasks');
    if (!c) return null;
    try {
      return JSON.parse(c.settings_str || '{}')?.boardIds?.[0] || null;
    } catch (err) {
      if (!err?.__loggedId) logger.warn(MODULE, 'settings_str של עמודת subtasks אינו JSON תקין', err);
      return null;
    }
  };

  let subId = findSub(await readColumns(parentBoardId));
  if (subId) return String(subId);

  const it = await api(
    `mutation ($b: ID!) { create_item(board_id: $b, item_name: "__wizard_init__") { id } }`,
    { b: String(parentBoardId) },
    'create_item'
  );
  const tempItemId = it?.create_item?.id;
  await api(
    `mutation ($p: ID!) { create_subitem(parent_item_id: $p, item_name: "__init__") { id } }`,
    { p: String(tempItemId) },
    'create_subitem'
  );
  subId = findSub(await readColumns(parentBoardId));

  try {
    await api(
      `mutation ($i: ID!) { delete_item(item_id: $i) { id } }`,
      { i: String(tempItemId) },
      'delete_item'
    );
  } catch (err) {
    if (!err?.__loggedId) logger.warn(MODULE, 'מחיקת פריט הזמני נכשלה — אפשר למחוק ידנית', err);
  }

  if (!subId) throw new Error('לא נמצא מזהה לוח התת-פריטים אחרי הפעלת תת-פריטים');
  return String(subId);
}

function settingsPointTo(col, targetBoardId) {
  try {
    const ids = JSON.parse(col.settings_str || '{}')?.boardIds || [];
    return ids.map(String).includes(String(targetBoardId));
  } catch (err) {
    if (!err?.__loggedId) logger.warn(MODULE, 'settings_str של עמודת קישור אינו JSON תקין', err);
    return false;
  }
}

// Create a bidirectional connect-boards column (reflection column auto-created on
// the target board). Reused if a matching one already exists. Falls back to an
// unlinked column only if the linked shape is rejected by the API.
async function ensureRelationColumn(boardId, existing, title, targetBoardId) {
  const hit = (existing || []).find((c) => c.title === title && c.type === 'board_relation');
  if (hit) return String(hit.id);
  const defaults = JSON.stringify({
    boardIds: [Number(targetBoardId)],
    allowMultipleItems: true,
    allowCreateReflectionColumn: true,
  });
  try {
    return await ensureColumn(boardId, existing, title, 'board_relation', defaults);
  } catch (err) {
    // Linking shape rejected by this API version — create the column unlinked so
    // the owner can finish it in Settings, but don't fail the whole run.
    if (!err?.__loggedId) {
      logger.warn(MODULE, `יצירת קישור "${title}" עם boardIds נכשלה — יוצר עמודה לא-מקושרת`, err);
    }
    return await ensureColumn(boardId, existing, title, 'board_relation');
  }
}

async function renameColumn(boardId, columnId, title) {
  await api(
    `mutation ($b: ID!, $c: String!, $t: String!) {
      change_column_title(board_id: $b, column_id: $c, title: $t) { id }
    }`,
    { b: String(boardId), c: String(columnId), t: title },
    'change_column_title'
  );
}

// After a bidirectional relation is created from the source board, find the
// reflection column on the target board (a board_relation pointing back at the
// source), rename it, and return its id so it can be mapped.
async function mapReflection(sourceBoardId, targetBoardId, title) {
  const cols = await readColumns(targetBoardId);
  const refl = cols.find((c) => c.type === 'board_relation' && settingsPointTo(c, sourceBoardId));
  if (!refl) {
    logger.warn(MODULE, `לא נמצאה עמודת ה-reflection בלוח המטרה עבור "${title}"`);
    return null;
  }
  if (refl.title !== title) {
    try {
      await renameColumn(targetBoardId, refl.id, title);
    } catch (err) {
      if (!err?.__loggedId) logger.warn(MODULE, `שינוי שם עמודת ה-reflection ל"${title}" נכשל`, err);
    }
  }
  return String(refl.id);
}

/*
 * Orchestrates the whole first-run build. `discussionsBoardId` is the current
 * board (required — this is a board-view app). Returns { boards, columns } ready
 * for SettingsContext.updateSettings(). Throws (after logging) on a fatal
 * failure; the wizard surfaces the error and lets the user retry / map manually.
 *
 * TOP-UP MODE — pass `existingConfig` ({ boards, columns }) to run AFTER install
 * from Settings: roles already mapped to a board id are REUSED (never recreated),
 * only missing boards are created, and only MISSING columns/relations/subitem
 * columns (and the managed "סוג דיון") are completed on the involved boards. The
 * result is the existing config DEEP-MERGED with the new ids, so nothing is
 * clobbered. When `existingConfig` is null/undefined the behavior is identical to
 * first-run (every skip below is guarded behind its presence).
 */
export async function provisionAllBoards({ discussionsBoardId, workspaceId, onProgress, tasks = { mode: 'create' }, existingConfig = null, createDiscussionsBoard = false } = {}) {
  // round141b — custom-object install: there is no meaningful host board, so a
  // real "דיונים" board is CREATED below instead of extending the current one.
  if (!discussionsBoardId && !createDiscussionsBoard) {
    throw new Error('לא זוהה הלוח הנוכחי — יש לפתוח את האפליקציה מתוך לוח דיונים');
  }
  if (tasks?.mode === 'connect' && !tasks?.boardId) {
    throw new Error('לא נבחר לוח משימות קיים לחיבור');
  }

  const total = countSteps(tasks, createDiscussionsBoard);
  let step = 0;
  // round141 — the wizard narrates BOARD-level phases (owner request): every
  // tick also reports the current phase ("יוצר את לוח המשימות…"), while `label`
  // keeps the fine-grained step detail for logs/debugging.
  let phase = '';
  const setPhase = (p) => { phase = p; };
  const tick = (label) => {
    step += 1;
    try {
      onProgress?.(step, total, label, phase);
    } catch (err) {
      /* progress callback must never break provisioning */
      if (!err?.__loggedId) logger.warn(MODULE, 'onProgress callback זרק שגיאה — ממשיך', err);
    }
  };

  logger.info(MODULE, 'התחלת הקמת לוחות אוטומטית', { total, discussionsBoardId, createDiscussionsBoard });
  const hasIdEarly = (v) => Boolean(v && v.id && String(v.id).trim());

  // discussions = the current board; topics + decisions are always created, and
  // tasks is either created (mode 'create') or an existing board is connected
  // (mode 'connect'), in which case its columns are still ensured/reused below.
  const boardIds = {};
  if (createDiscussionsBoard && !(existingConfig && hasIdEarly(existingConfig.boards?.discussions))) {
    setPhase('מקים את לוח הדיונים…');
    boardIds.discussions = await createBoard(PROVISION_SPEC.discussions.name, workspaceId);
    tick('נוצר לוח: דיונים');
  } else {
    boardIds.discussions = String(
      (existingConfig && existingConfig.boards?.discussions?.id) || discussionsBoardId
    );
  }
  // TOP-UP MODE (existingConfig provided): start the column accumulator from a
  // DEEP CLONE of the existing mapping so untouched roles/columns/aliases —
  // including ones this wizard never provisions (formula/mirror, priority, notes,
  // taskType, …) — survive into the returned MERGED config. First-run
  // (existingConfig null) keeps the exact empty scaffold as before.
  const columns = existingConfig?.columns
    ? JSON.parse(JSON.stringify(existingConfig.columns))
    : { discussions: {}, topics: {}, tasks: {}, decisions: {} };
  if (existingConfig) {
    for (const key of BOARD_ORDER) {
      if (!columns[key] || typeof columns[key] !== 'object') columns[key] = {};
    }
  }
  // Is a role/alias already mapped in the INCOMING config? Only ever true in
  // top-up mode; always false on first-run, so every skip below is inert then.
  const hasId = (v) => Boolean(v && v.id && String(v.id).trim());

  // 1) create the missing boards. topics + decisions are always created; tasks is
  // created only in 'create' mode — in 'connect' mode we reuse the chosen board id
  // (its columns are still ensured/reused by title+type in step 2).
  for (const key of BOARD_ORDER) {
    if (PROVISION_SPEC[key].isCurrentBoard) continue;
    // TOP-UP: a role already mapped to a board id is REUSED — never recreated.
    if (existingConfig && hasId(existingConfig.boards?.[key])) {
      boardIds[key] = String(existingConfig.boards[key].id);
      continue;
    }
    if (key === 'tasks' && tasks?.mode === 'connect') {
      boardIds.tasks = String(tasks.boardId);
      continue;
    }
    setPhase(`יוצר את לוח "${PROVISION_SPEC[key].name}"…`);
    boardIds[key] = await createBoard(PROVISION_SPEC[key].name, workspaceId);
    tick(`נוצר לוח: ${PROVISION_SPEC[key].name}`);
  }

  // 2) simple columns (reusing any already present on each board). For an
  // EXISTING tasks board (mode 'connect') the wizard may pass a columnMap that
  // maps each required task field onto one of the board's existing columns:
  //   - a real column id  → map it directly (do NOT create a new column);
  //   - '__create__'/absent → create it via ensureColumn (reuse-by-title-or-create).
  // Without a columnMap (older callers) every column goes through ensureColumn —
  // today's behavior. Either way we tick() once per field so progress stays right.
  const existingByBoard = {};
  // Board-level narration for the column work. The discussions "board" is the
  // CURRENT board — no board named דיונים is ever created (this is a board-view
  // app); say so explicitly instead of implying a new board appeared.
  const PHASE_LABELS = {
    discussions: createDiscussionsBoard
      ? 'מקים את לוח הדיונים…'
      : 'מוסיף את עמודות הדיונים ללוח הנוכחי (הוא לוח הדיונים)…',
    topics: 'מקים את לוח הנושאים לדיון…',
    tasks: tasks?.mode === 'connect' ? 'מחבר ומשלים את לוח המשימות הקיים…' : 'מקים את לוח המשימות…',
    decisions: 'מקים את לוח ההחלטות…',
  };
  for (const key of BOARD_ORDER) {
    setPhase(PHASE_LABELS[key]);
    existingByBoard[key] = await readColumns(boardIds[key]);
    const taskColumnMap =
      key === 'tasks' && tasks?.mode === 'connect' && tasks?.columnMap ? tasks.columnMap : null;
    for (const col of PROVISION_SPEC[key].columns) {
      // TOP-UP: keep an alias already mapped (cloned above) — do NOT recreate or
      // attach it; only MISSING columns are completed.
      if (existingConfig && hasId(existingConfig.columns?.[key]?.[col.alias])) continue;
      const mapped = taskColumnMap ? taskColumnMap[col.alias] : undefined;
      if (mapped && mapped !== '__create__') {
        columns[key][col.alias] = { id: String(mapped), type: col.type, title: col.title, verified: true };
        tick(`עמודה ממופה: ${col.title}`);
        continue;
      }
      const id = await ensureColumn(boardIds[key], existingByBoard[key], col.title, col.type, col.defaults);
      columns[key][col.alias] = { id, type: col.type, title: col.title, verified: true };
      tick(`עמודה: ${col.title}`);
    }
  }

  // "סוג דיון" — account-level managed dropdown attached to the discussions board.
  // TOP-UP: if it's already mapped, keep it — do NOT create/attach a new managed
  // column (that would mint a duplicate account-level column).
  if (!(existingConfig && hasId(existingConfig.columns?.discussions?.discussionTypeID))) {
    setPhase(PHASE_LABELS.discussions);
    const t = await ensureManagedTypeColumn(boardIds.discussions, existingByBoard.discussions);
    columns.discussions.discussionTypeID = {
      id: t.id, type: 'dropdown', title: 'סוג דיון', verified: true, managedColumnId: t.managedColumnId,
    };
    tick('עמודת סוג דיון (managed dropdown)');
  }

  // round126 — attach the SAME account-level managed column to the TASKS board
  // (taskTypeID). One managed column on both boards keeps the type labels
  // identical automatically (the by-text bridge stays as a fallback for
  // accounts whose columns predate this). Works for created AND connected
  // tasks boards. The managed UUID comes from this run's create, or from the
  // persisted mapping; without one we still create a PLAIN dropdown so the
  // by-text bridge works, and log it.
  if (!(existingConfig && hasId(existingConfig.columns?.tasks?.taskTypeID))) {
    setPhase(PHASE_LABELS.tasks);
    const knownManagedId =
      columns.discussions.discussionTypeID?.managedColumnId ||
      existingConfig?.columns?.discussions?.discussionTypeID?.managedColumnId ||
      null;
    /*
     * round312 — always go through ensureManagedTypeColumn, even with no known
     * UUID: it now resolves the account's managed column by title itself, so the
     * tasks board gets the SAME managed column as discussions instead of a plain
     * dropdown bridged by text. The plain fallback stays for the one case that
     * genuinely cannot be managed — an account where creating an account-level
     * column is not permitted — because failing there would abort the whole
     * install over a column the by-text bridge can live without.
     */
    let tt;
    try {
      tt = await ensureManagedTypeColumn(boardIds.tasks, existingByBoard.tasks, knownManagedId);
    } catch (err) {
      logger.warn(MODULE, 'לא ניתן לחבר עמודה מנוהלת במשימות — נוצרת עמודת dropdown רגילה (גישור לפי טקסט)', err);
      tt = {
        id: await ensureColumn(boardIds.tasks, existingByBoard.tasks, MANAGED_TYPE_TITLE, 'dropdown'),
        managedColumnId: null,
      };
    }
    columns.tasks.taskTypeID = {
      id: tt.id, type: 'dropdown', title: 'סוג דיון', verified: true, managedColumnId: tt.managedColumnId,
    };
    tick('עמודת סוג דיון במשימות (אותה עמודה מנוהלת)');
  }

  // 3) subitems (topics): enable + add its own columns, plus (round312) the two
  // per-POINT connect-boards columns, which live on the SUBITEMS board and so are
  // out of reach of the main `relations` pass below.
  for (const key of BOARD_ORDER) {
    const subSpec = PROVISION_SPEC[key].subitems;
    const subRelSpec = PROVISION_SPEC[key].subitemRelations || [];
    if (!subSpec && !subRelSpec.length) continue;
    // TOP-UP: only the subitem columns not already mapped need work; if every one
    // is already mapped, skip enabling/reading the subitems board entirely.
    const unmapped = (list) => (existingConfig
      ? list.filter((col) => !hasId(existingConfig.columns?.[key]?.[col.alias]))
      : list);
    const subMissing = unmapped(subSpec || []);
    const subRelMissing = unmapped(subRelSpec);
    if (!subMissing.length && !subRelMissing.length) continue;
    setPhase(PHASE_LABELS[key]);
    const subBoardId = await ensureSubitemsBoard(boardIds[key]);
    tick('הופעלו תת-פריטים');
    const subExisting = await readColumns(subBoardId);
    for (const col of subMissing) {
      const id = await ensureColumn(subBoardId, subExisting, col.title, col.type, col.defaults);
      columns[key][col.alias] = { id, type: col.type, title: col.title, verified: true, subitems: true };
      tick(`עמודת תת-פריט: ${col.title}`);
    }
    // The app only ever READS/WRITES the subitems side of these two, and a
    // reflection on the decisions/tasks board would be noise there — so they are
    // created UNLINKED-back (ensureRelationColumn's linked shape targets the board;
    // the reflection it may create is simply never mapped).
    for (const rel of subRelMissing) {
      const id = await ensureRelationColumn(subBoardId, subExisting, rel.title, boardIds[rel.target]);
      columns[key][rel.alias] = {
        id, type: 'board_relation', title: rel.title, verified: true, subitems: true,
      };
      tick(`עמודת קישור בתת-פריט: ${rel.title}`);
    }
  }

  // 4) relations (need all board ids to exist). Each is bidirectional: the
  // reflection auto-created on the target board is mapped as the back-link.
  setPhase('מקשר בין הלוחות…');
  for (const key of BOARD_ORDER) {
    for (const rel of PROVISION_SPEC[key].relations || []) {
      // TOP-UP: keep an already-mapped relation column; otherwise create it.
      if (!(existingConfig && hasId(existingConfig.columns?.[key]?.[rel.alias]))) {
        const id = await ensureRelationColumn(boardIds[key], existingByBoard[key], rel.title, boardIds[rel.target]);
        columns[key][rel.alias] = { id, type: 'board_relation', title: rel.title, verified: true };
      }
      if (rel.reflection) {
        // TOP-UP: keep an already-mapped reflection; otherwise locate + map it.
        const reflMapped =
          existingConfig && hasId(existingConfig.columns?.[rel.reflection.board]?.[rel.reflection.alias]);
        if (!reflMapped) {
          const reflId = await mapReflection(boardIds[key], boardIds[rel.target], rel.reflection.title);
          if (reflId) {
            columns[rel.reflection.board][rel.reflection.alias] = {
              id: reflId,
              type: 'board_relation',
              title: rel.reflection.title,
              verified: true,
            };
          }
        }
      }
      tick(`קישור: ${rel.title}`);
    }
  }

  const config = {
    boards: {
      discussions: { id: boardIds.discussions },
      topics: { id: boardIds.topics },
      tasks: { id: boardIds.tasks },
      decisions: { id: boardIds.decisions },
    },
    columns,
  };

  logger.info(MODULE, 'הקמת לוחות הושלמה', { boards: boardIds });
  return config;
}

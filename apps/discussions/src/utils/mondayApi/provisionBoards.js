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
import logger from '../logger.js';

const MODULE = 'provisionBoards';

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
    columns: [
      { alias: 'discussionCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'discussionLeadID', type: 'people', title: 'מוביל דיון' },
      { alias: 'participantsID', type: 'people', title: 'משתתפים' },
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
      { alias: 'topicNotForDiscussionID', type: 'checkbox', title: 'האם להציג' },
    ],
    // discussionLinkID (back-link to discussions) is created as the reflection of
    // discussions.topicsBoardLinkID — see above.
    relations: [],
    subitems: [{ alias: 'pointNotForDiscussionID', type: 'checkbox', title: 'האם להציג' }],
  },
  tasks: {
    name: 'משימות',
    columns: [
      { alias: 'taskCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'responsibilityID', type: 'people', title: 'אחריות' },
      { alias: 'deadlineID', type: 'date', title: 'דד ליין' },
      { alias: 'statusID', type: 'status', title: 'סטאטוס', defaults: STATUS_DEFAULTS },
      { alias: 'detailsID', type: 'long_text', title: 'מקור המשימה' },
    ],
    // discussionLinkID (back-link to discussions) is the reflection of
    // discussions.tasksBoardLinkID — see above.
    relations: [],
  },
  decisions: {
    name: 'החלטות',
    columns: [
      { alias: 'decisionCreatorID', type: 'people', title: 'יוצר' },
      { alias: 'deciderID', type: 'people', title: 'מקבל ההחלטה' },
      { alias: 'affectedID', type: 'people', title: 'מושפעים' },
      { alias: 'decisionStatusID', type: 'status', title: 'סטאטוס', defaults: DECISION_STATUS_DEFAULTS },
      { alias: 'decisionDateID', type: 'date', title: 'תאריך' },
    ],
    // discussionLinkID (back-link to discussions) is the reflection of
    // discussions.decisionsBoardLinkID — created automatically, mapped by mapReflection.
    relations: [],
  },
};

const BOARD_ORDER = ['discussions', 'topics', 'tasks', 'decisions'];

// Count every unit of work so the wizard can show a real progress bar.
function countSteps(tasks) {
  let n = 0;
  for (const key of BOARD_ORDER) {
    const spec = PROVISION_SPEC[key];
    // create_board — skipped for the current board (discussions), and for tasks
    // when connecting an existing board instead of creating a new one.
    if (!spec.isCurrentBoard && !(key === 'tasks' && tasks?.mode === 'connect')) n += 1;
    n += spec.columns.length;
    n += (spec.relations || []).length;
    if (spec.subitems) n += 1 + spec.subitems.length; // enable subitems + its columns
  }
  n += 1; // discussions managed type column ("סוג דיון" — account-level managed dropdown)
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
 * Retry-safe: if a dropdown titled "סוג דיון"/"סוג" already exists on the board,
 * reuse it (managedColumnId unknown → null; the app can detect/persist it later).
 */
async function ensureManagedTypeColumn(boardId, existing) {
  const hit = (existing || []).find(
    (c) => c.type === 'dropdown' && (c.title === 'סוג דיון' || c.title === 'סוג')
  );
  if (hit) return { id: String(hit.id), managedColumnId: null };
  const created = await api(
    `mutation ($t: String!) { create_dropdown_managed_column(title: $t) { id } }`,
    { t: 'סוג דיון' },
    'create_dropdown_managed_column'
  );
  const managedColumnId = created?.create_dropdown_managed_column?.id;
  if (!managedColumnId) throw new Error('create_dropdown_managed_column לא החזיר מזהה');
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
    } catch {
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
  } catch {
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
 */
export async function provisionAllBoards({ discussionsBoardId, workspaceId, onProgress, tasks = { mode: 'create' } } = {}) {
  if (!discussionsBoardId) {
    throw new Error('לא זוהה הלוח הנוכחי — יש לפתוח את האפליקציה מתוך לוח דיונים');
  }
  if (tasks?.mode === 'connect' && !tasks?.boardId) {
    throw new Error('לא נבחר לוח משימות קיים לחיבור');
  }

  const total = countSteps(tasks);
  let step = 0;
  const tick = (label) => {
    step += 1;
    try {
      onProgress?.(step, total, label);
    } catch {
      /* progress callback must never break provisioning */
    }
  };

  logger.info(MODULE, 'התחלת הקמת לוחות אוטומטית', { total, discussionsBoardId });

  // discussions = the current board; topics + decisions are always created, and
  // tasks is either created (mode 'create') or an existing board is connected
  // (mode 'connect'), in which case its columns are still ensured/reused below.
  const boardIds = { discussions: String(discussionsBoardId) };
  const columns = { discussions: {}, topics: {}, tasks: {}, decisions: {} };

  // 1) create the missing boards. topics + decisions are always created; tasks is
  // created only in 'create' mode — in 'connect' mode we reuse the chosen board id
  // (its columns are still ensured/reused by title+type in step 2).
  for (const key of BOARD_ORDER) {
    if (PROVISION_SPEC[key].isCurrentBoard) continue;
    if (key === 'tasks' && tasks?.mode === 'connect') {
      boardIds.tasks = String(tasks.boardId);
      continue;
    }
    boardIds[key] = await createBoard(PROVISION_SPEC[key].name, workspaceId);
    tick(`נוצר לוח: ${PROVISION_SPEC[key].name}`);
  }

  // 2) simple columns (reusing any already present on each board)
  const existingByBoard = {};
  for (const key of BOARD_ORDER) {
    existingByBoard[key] = await readColumns(boardIds[key]);
    for (const col of PROVISION_SPEC[key].columns) {
      const id = await ensureColumn(boardIds[key], existingByBoard[key], col.title, col.type, col.defaults);
      columns[key][col.alias] = { id, type: col.type, title: col.title, verified: true };
      tick(`עמודה: ${col.title}`);
    }
  }

  // "סוג דיון" — account-level managed dropdown attached to the discussions board.
  {
    const t = await ensureManagedTypeColumn(boardIds.discussions, existingByBoard.discussions);
    columns.discussions.discussionTypeID = {
      id: t.id, type: 'dropdown', title: 'סוג דיון', verified: true, managedColumnId: t.managedColumnId,
    };
    tick('עמודת סוג דיון (managed dropdown)');
  }

  // 3) subitems (topics): enable + add its checkbox columns
  for (const key of BOARD_ORDER) {
    const subSpec = PROVISION_SPEC[key].subitems;
    if (!subSpec) continue;
    const subBoardId = await ensureSubitemsBoard(boardIds[key]);
    tick('הופעלו תת-פריטים');
    const subExisting = await readColumns(subBoardId);
    for (const col of subSpec) {
      const id = await ensureColumn(subBoardId, subExisting, col.title, col.type, col.defaults);
      columns[key][col.alias] = { id, type: col.type, title: col.title, verified: true, subitems: true };
      tick(`עמודת תת-פריט: ${col.title}`);
    }
  }

  // 4) relations (need all board ids to exist). Each is bidirectional: the
  // reflection auto-created on the target board is mapped as the back-link.
  for (const key of BOARD_ORDER) {
    for (const rel of PROVISION_SPEC[key].relations || []) {
      const id = await ensureRelationColumn(boardIds[key], existingByBoard[key], rel.title, boardIds[rel.target]);
      columns[key][rel.alias] = { id, type: 'board_relation', title: rel.title, verified: true };
      if (rel.reflection) {
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

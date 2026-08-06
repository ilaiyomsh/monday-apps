/*
 * ============================================================================
 *  round363 — BOARD BLUEPRINT: make a fresh install look like the LIVE boards
 * ============================================================================
 *
 *  provisionBoards builds the plain column set; this module layers the rest of
 *  the owner's live-board blueprint on top (fetched from דיונים1/משימות1/
 *  נושאים לדיון1/החלטות1, 2026-08-06):
 *
 *    1. TASK FLAG FORMULAS — "האם המשימה בעיכוב"/"האם המשימה בוצעה", the 0/1
 *       columns the discussions-board mirrors sum over.
 *    2. THE EFFECTIVENESS PIPELINE on the discussions board — count formulas
 *       ("סך משימות"/"סך נושאים") → sum mirrors ("סך משימות בעיכוב"/"שבוצעו")
 *       → percent formulas ("ביצוע %"/"בעיכוב %") → "אפקטיביות דיון". These are
 *       exactly the seven read-only display aliases COLUMN_SCHEMA.discussions
 *       already declares; until this round they could only be mapped by hand.
 *    3. DEFAULT VIEWS — the live boards' table views (group-by/sort/filter),
 *       rebuilt over the mapped column ids.
 *    4. GROUPS + NAME-COLUMN "TERMINOLOGY" — the default group's title+color
 *       and the first column's title, matching the live boards. Applied ONLY to
 *       boards this run CREATED: a host/connected board's groups and name
 *       column are the owner's content, not ours to restyle.
 *
 *  Every GraphQL shape was probed live in the sandbox first (see
 *  .claude/skills/monday-api/references/column-formats.md):
 *    · formulas reference column IDS in braces, so every formula is BUILT at
 *      runtime from the mapped ids — never stored as a fixed string;
 *    · a mirror's defaults take displayed_linked_columns as an ARRAY
 *      [{board_id, column_ids}] (+ function:"sum"); the server stores it back
 *      as a map, and a blank settings_str read back means the mirror was
 *      silently created UNCONFIGURED — such a column is not mapped and not
 *      adopted on reuse;
 *    · update_group's color takes a NAMED palette color ("dark-orange"), a hex
 *      value is rejected with "Input color is not in colors options";
 *    · item_terminology is NOT settable via the API (update_board's enum stops
 *      at name/description/communication), so the name column's TITLE carries
 *      the terminology instead (change_column_title on column_id "name").
 *
 *  Everything here is display/derived data — FAIL-SOFT BY DESIGN: each element
 *  is attempted independently, a failure is logged (never swallowed) and the
 *  install proceeds. Dependents of a failed element are skipped, not created
 *  broken.
 * ============================================================================
 */

import { api } from './monday-client.js';
import logger from '../logger.js';

const MODULE = 'boardBlueprint';

// The live boards' default-group styling. Colors are NAMED palette colors —
// update_group rejects hex (live values: dark-orange=#ff642e, orange=#fdab3d).
export const BLUEPRINT_GROUPS = {
  discussions: { title: 'רשימת הדיונים', color: 'dark-orange' },
  topics: { title: 'נושאי דיון', color: 'orange' },
  tasks: { title: 'רשימת המשימות', color: 'dark-orange' },
  decisions: { title: 'רשימת ההחלטות', color: 'dark-orange' },
};

// The item terminology of each live board, carried as the NAME column's title
// (the API has no item_terminology mutation — probed round363).
export const BLUEPRINT_NAME_TITLES = {
  discussions: 'שם הדיון',
  topics: 'נושא',
  tasks: 'משימה',
  decisions: 'פירוט ההחלטה',
};

/*
 * The default views, keyed by board role. `groupBy`/`sort`/`filter` reference
 * ALIASES; they resolve to real column ids at apply time and a view whose
 * group-by alias is unmapped is skipped (a group-by over nothing is noise).
 * compare_value [1] on the status filters is the "בוצע" label — stable id 1 in
 * STATUS_DEFAULTS and on the live board alike.
 */
const BLUEPRINT_VIEWS = {
  discussions: [
    { name: 'לפי מוביל', groupBy: 'discussionLeadID', sort: [{ alias: 'discussionDateID', direction: 'desc' }] },
    {
      name: 'לפי אפקטיביות',
      groupBy: 'effectivenessID',
      groupSortDirection: 'ASC',
      sort: [{ alias: 'discussionDateID', direction: 'desc' }],
    },
  ],
  tasks: [
    {
      name: 'לפי דיון',
      groupBy: 'discussionLinkID',
      sort: [{ alias: 'statusID', direction: 'asc' }],
      filter: { alias: 'statusID', operator: 'not_any_of', compareValue: [1] },
    },
    {
      name: 'לפי עדיפות',
      groupBy: 'priorityID',
      sort: [{ alias: 'statusID', direction: 'asc' }],
      filter: { alias: 'statusID', operator: 'not_any_of', compareValue: [1] },
    },
    {
      name: 'עיכובים',
      groupBy: 'statusID',
      filter: { alias: 'taskDelayedFlagID', operator: 'is_not_empty', compareValue: [] },
    },
  ],
  topics: [
    { name: 'לפי דיון', groupBy: 'discussionLinkID' },
  ],
  decisions: [],
};

const VIEW_COUNT = Object.values(BLUEPRINT_VIEWS).reduce((n, list) => n + list.length, 0);

// 2 task flags + 2 count formulas + 2 mirrors + 2 percent formulas + effectiveness
const BLUEPRINT_COLUMN_COUNT = 9;

/*
 * The two tasks-board flag formulas the discussions mirrors sum over — the live
 * formula text verbatim, over the mapped status/deadline ids. "בוצע" is a label
 * TEXT by design (formulas compare status by label, like the live board).
 */
export function buildTaskFlagFormulas(taskCols) {
  const statusId = taskCols?.statusID?.id;
  const deadlineId = taskCols?.deadlineID?.id;
  if (!statusId || !deadlineId) return [];
  return [
    {
      alias: 'taskDelayedFlagID',
      title: 'האם המשימה בעיכוב',
      formula: `IF(AND(DAYS(TODAY(), {${deadlineId}}) > 0, {${statusId}} <> "בוצע"), "1", "")`,
    },
    {
      alias: 'taskDoneFlagID',
      title: 'האם המשימה בוצעה',
      formula: `IF({${statusId}} = "בוצע", 1, "")`,
    },
  ];
}

/*
 * Progress-bar budget, mirroring countSteps' created-board rules: topics +
 * decisions are always created, tasks only in 'create' mode, discussions only
 * on a custom-object install. Groups/name-renames apply to created boards
 * alone, so their count follows the same logic; columns and views are counted
 * flat (top-up runs simply finish under budget, like countSteps itself).
 */
export function countBlueprintSteps(tasks = { mode: 'create' }, createDiscussionsBoard = false) {
  let created = 2; // topics + decisions
  if (tasks?.mode !== 'connect') created += 1;
  if (createDiscussionsBoard) created += 1;
  return BLUEPRINT_COLUMN_COUNT + created * 2 + VIEW_COUNT;
}

const hasId = (v) => Boolean(v && v.id && String(v.id).trim());

const isBlankSettings = (settingsStr) => {
  if (!settingsStr) return true;
  try {
    return Object.keys(JSON.parse(settingsStr)).length === 0;
  } catch (err) {
    if (!err?.__loggedId) logger.warn(MODULE, 'settings_str של עמודת blueprint אינו JSON תקין', err);
    return true;
  }
};

/*
 * Create a formula/mirror column, or adopt an existing one matched by
 * (title, type) — the same reuse rule as provisionBoards' ensureColumn, with
 * one addition: a MIRROR is adopted only when its settings are non-blank
 * (a blank mirror is the silently-unconfigured artifact of a failed run, and
 * adopting it would freeze the breakage in place).
 *
 * Returns the column id, or null when the created mirror came back blank —
 * the caller then leaves the alias unmapped so a retry can fix it.
 */
async function ensureBlueprintColumn(boardId, existing, title, columnType, defaults) {
  const hit = (existing || []).find((c) => (
    c.title === title
    && c.type === columnType
    && (columnType !== 'mirror' || !isBlankSettings(c.settings_str))
  ));
  if (hit) return String(hit.id);
  const data = await api(
    `mutation ($boardId: ID!, $title: String!, $type: ColumnType!, $defaults: JSON) {
      create_column(board_id: $boardId, title: $title, column_type: $type, defaults: $defaults) { id settings_str }
    }`,
    { boardId: String(boardId), title, type: columnType, defaults: defaults || null },
    'create_column'
  );
  const col = data?.create_column;
  if (!col?.id) throw new Error(`create_column לא החזיר מזהה עבור "${title}"`);
  if (columnType === 'mirror' && isBlankSettings(col.settings_str)) {
    // The probed trap: HTTP 200, a column exists, but its settings are {} —
    // an unconfigured mirror that would sum nothing. Not mapped, loudly logged.
    logger.warn(MODULE, `עמודת המירור "${title}" נוצרה ללא הגדרות (settings_str ריק) — לא ממופה`, {
      boardId: String(boardId), columnId: String(col.id),
    });
    if (existing) existing.push({ id: col.id, title, type: columnType, settings_str: '{}' });
    return null;
  }
  if (existing) existing.push({ id: col.id, title, type: columnType, settings_str: col.settings_str });
  return String(col.id);
}

const mirrorDefaults = (relationColumnId, sourceBoardId, sourceColumnId) => JSON.stringify({
  relation_column: { [String(relationColumnId)]: true },
  displayed_linked_columns: [{ board_id: String(sourceBoardId), column_ids: [String(sourceColumnId)] }],
  function: 'sum',
});

const formulaDefaults = (formula) => JSON.stringify({ formula });

async function readViews(boardId) {
  const data = await api(
    'query ($b: [ID!]) { boards(ids: $b) { views { id name } } }',
    { b: [String(boardId)] },
    'read_views'
  );
  return data?.boards?.[0]?.views || [];
}

async function readGroups(boardId) {
  const data = await api(
    'query ($b: [ID!]) { boards(ids: $b) { groups { id title } } }',
    { b: [String(boardId)] },
    'read_groups'
  );
  return data?.boards?.[0]?.groups || [];
}

async function updateGroup(boardId, groupId, attribute, value) {
  await api(
    `mutation ($b: ID!, $g: String!, $attr: GroupAttributes!, $v: String!) {
      update_group(board_id: $b, group_id: $g, group_attribute: $attr, new_value: $v) { id }
    }`,
    { b: String(boardId), g: String(groupId), attr: attribute, v: value },
    'update_group'
  );
}

async function renameNameColumn(boardId, title) {
  await api(
    `mutation ($b: ID!, $c: String!, $t: String!) {
      change_column_title(board_id: $b, column_id: $c, title: $t) { id }
    }`,
    { b: String(boardId), c: 'name', t: title },
    'change_column_title'
  );
}

async function createTableView(boardId, name, settings, sort, filter) {
  await api(
    `mutation ($b: ID!, $name: String!, $settings: TableViewSettingsInput, $sort: [ItemsQueryOrderBy!], $filter: ItemsQueryGroup) {
      create_view_table(board_id: $b, name: $name, settings: $settings, sort: $sort, filter: $filter) { id }
    }`,
    { b: String(boardId), name, settings, sort, filter },
    'create_view_table'
  );
}

/*
 * Apply the whole blueprint. `columns` is provisioning's accumulator (already
 * deep-cloned from existingConfig in top-up mode) and is MUTATED with the new
 * aliases; formula/mirror aliases are mapped `verified: false` — the existing
 * convention for best-effort read-only display fields. `createdBoards` lists
 * the roles whose board was created BY THIS RUN (groups/name-rename gate).
 *
 * Fail-soft throughout: each element runs in its own try/catch, a failure is
 * logged and its dependents are skipped. This function never throws.
 */
export async function applyBoardBlueprint({
  boardIds,
  columns,
  existingByBoard = {},
  createdBoards = [],
  onProgress = null,
} = {}) {
  const tick = (label) => {
    try {
      onProgress?.(label);
    } catch (err) {
      if (!err?.__loggedId) logger.warn(MODULE, 'onProgress callback זרק שגיאה — ממשיך', err);
    }
  };

  // Map an alias to a freshly ensured column; skipped when already mapped
  // (top-up) or when a dependency is missing. Returns the mapped id or null.
  const ensureAlias = async (boardKey, alias, title, columnType, defaults) => {
    if (hasId(columns?.[boardKey]?.[alias])) return String(columns[boardKey][alias].id);
    try {
      const id = await ensureBlueprintColumn(
        boardIds[boardKey], existingByBoard[boardKey], title, columnType, defaults
      );
      if (!id) return null;
      columns[boardKey][alias] = { id, type: columnType, title, verified: false };
      tick(`עמודת blueprint: ${title}`);
      return id;
    } catch (err) {
      logger.warn(MODULE, `יצירת עמודת ה-blueprint "${title}" נכשלה — ממשיך בלעדיה`, err);
      return null;
    }
  };

  // 1) task flag formulas (the mirror sources)
  const flagIds = {};
  for (const f of buildTaskFlagFormulas(columns?.tasks)) {
    flagIds[f.alias] = await ensureAlias('tasks', f.alias, f.title, 'formula', formulaDefaults(f.formula));
  }

  // 2) discussions count formulas — off the relation column ids
  const tasksLinkId = columns?.discussions?.tasksBoardLinkID?.id;
  const topicsLinkId = columns?.discussions?.topicsBoardLinkID?.id;
  const totalTasksId = tasksLinkId
    ? await ensureAlias('discussions', 'totalTasksID', 'סך משימות', 'formula', formulaDefaults(`{${tasksLinkId}#Count}`))
    : null;
  if (topicsLinkId) {
    await ensureAlias('discussions', 'totalTopicsID', 'סך נושאים', 'formula', formulaDefaults(`{${topicsLinkId}#Count}`));
  }

  // 3) sum mirrors over the tasks relation → the flag formulas
  const tasksBoardId = boardIds?.tasks;
  const delayedMirrorId = (tasksLinkId && flagIds.taskDelayedFlagID)
    ? await ensureAlias('discussions', 'delayedTasksID', 'סך משימות בעיכוב', 'mirror',
      mirrorDefaults(tasksLinkId, tasksBoardId, flagIds.taskDelayedFlagID))
    : null;
  const doneMirrorId = (tasksLinkId && flagIds.taskDoneFlagID)
    ? await ensureAlias('discussions', 'completedTasksID', 'סך משימות שבוצעו', 'mirror',
      mirrorDefaults(tasksLinkId, tasksBoardId, flagIds.taskDoneFlagID))
    : null;

  // 4) percent formulas — need the total + their mirror
  const pctFormula = (numeratorId) => (
    `IF(AND({${totalTasksId}} <> "0", {${totalTasksId}} > 0), ROUND(DIVIDE(MULTIPLY({${numeratorId}}, 100), {${totalTasksId}}), 0), "")`
  );
  const donePctId = (totalTasksId && doneMirrorId)
    ? await ensureAlias('discussions', 'completionPctID', 'ביצוע %', 'formula', formulaDefaults(pctFormula(doneMirrorId)))
    : null;
  const delayedPctId = (totalTasksId && delayedMirrorId)
    ? await ensureAlias('discussions', 'delayedPctID', 'בעיכוב %', 'formula', formulaDefaults(pctFormula(delayedMirrorId)))
    : null;

  // 5) effectiveness — needs both percents
  if (donePctId && delayedPctId) {
    await ensureAlias('discussions', 'effectivenessID', 'אפקטיביות דיון', 'formula', formulaDefaults(
      `IF({${delayedPctId}}>50, "נדרשת בקרה", IF({${donePctId}}>75, "דיון מוצלח", "עוד מוקדם להסיק"))`
    ));
  }

  // 6+7) groups + name-column terminology — CREATED boards only (a host or
  // connected board's groups/name column are the owner's content)
  for (const key of createdBoards) {
    const group = BLUEPRINT_GROUPS[key];
    const boardId = boardIds?.[key];
    if (!group || !boardId) continue;
    try {
      const groups = await readGroups(boardId);
      const target = groups[0];
      if (target?.id) {
        await updateGroup(boardId, target.id, 'title', group.title);
        await updateGroup(boardId, target.id, 'color', group.color);
      }
      tick(`קבוצת ברירת מחדל: ${group.title}`);
    } catch (err) {
      logger.warn(MODULE, `עיצוב קבוצת ברירת המחדל בלוח "${key}" נכשל — ממשיך`, err);
    }
    try {
      const title = BLUEPRINT_NAME_TITLES[key];
      if (title) await renameNameColumn(boardId, title);
      tick(`עמודת שם: ${BLUEPRINT_NAME_TITLES[key]}`);
    } catch (err) {
      logger.warn(MODULE, `שינוי שם עמודת השם בלוח "${key}" נכשל — ממשיך`, err);
    }
  }

  // 8) views — additive on every board; a same-name view is never duplicated
  for (const [key, defs] of Object.entries(BLUEPRINT_VIEWS)) {
    if (!defs.length) continue;
    const boardId = boardIds?.[key];
    if (!boardId) continue;
    let existingNames;
    try {
      existingNames = new Set((await readViews(boardId)).map((v) => v?.name));
    } catch (err) {
      logger.warn(MODULE, `קריאת התצוגות של לוח "${key}" נכשלה — מדלג על תצוגות הלוח`, err);
      continue;
    }
    for (const def of defs) {
      try {
        if (existingNames.has(def.name)) continue;
        const groupById = columns?.[key]?.[def.groupBy]?.id;
        if (!groupById) continue; // a group-by over an unmapped column is noise
        const condition = { columnId: String(groupById) };
        if (def.groupSortDirection) {
          condition.config = { sortSettings: { direction: def.groupSortDirection } };
        }
        const settings = { group_by: { conditions: [condition] } };
        const sort = (def.sort || [])
          .filter((s) => hasId(columns?.[key]?.[s.alias]))
          .map((s) => ({ column_id: String(columns[key][s.alias].id), direction: s.direction }));
        let filter = null;
        if (def.filter) {
          const filterColId = columns?.[key]?.[def.filter.alias]?.id;
          if (!filterColId) continue; // the filter IS the view's meaning — skip without it
          filter = {
            operator: 'and',
            rules: [{
              column_id: String(filterColId),
              compare_value: def.filter.compareValue,
              operator: def.filter.operator,
            }],
          };
        }
        await createTableView(boardId, def.name, settings, sort.length ? sort : null, filter);
        tick(`תצוגה: ${def.name}`);
      } catch (err) {
        logger.warn(MODULE, `יצירת התצוגה "${def.name}" בלוח "${key}" נכשלה — ממשיך`, err);
      }
    }
  }

  return columns;
}

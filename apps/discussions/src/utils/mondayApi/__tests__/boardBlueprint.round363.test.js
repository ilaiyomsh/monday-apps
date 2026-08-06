import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round363 — provisioning builds the LIVE-BOARD blueprint on top of the plain
 * column set: the tasks flag formulas, the discussions effectiveness pipeline
 * (count formulas → sum mirrors → percent formulas → effectiveness), default
 * board views, colored default groups, and the name-column "terminology".
 *
 * Every GraphQL shape here was probed live in the sandbox (WZ-, workspace
 * 16291824) before being pinned:
 *   · formula column  — create_column defaults {"formula": "..."}; formulas
 *     reference column IDS in braces;
 *   · mirror column   — defaults with displayed_linked_columns as an ARRAY
 *     [{board_id, column_ids}] + function:"sum"; a blank settings_str ("{}")
 *     read back means the mirror was silently created UNCONFIGURED;
 *   · views           — create_view_table with typed settings/sort/filter;
 *   · groups          — update_group color takes a NAMED palette color
 *     ("dark-orange"), a hex value is rejected;
 *   · terminology     — item_terminology is NOT settable via the API, so the
 *     built-in "name" column is renamed instead (change_column_title).
 */

const { api, state } = vi.hoisted(() => {
  const state = {
    calls: [],
    colSeq: 0,
    mirrorSettingsBlank: false,
    failOnTitle: null,
    existingViews: {},
  };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('create_column')) {
        if (state.failOnTitle && vars?.title === state.failOnTitle) {
          throw new Error(`boom on ${vars.title}`);
        }
        state.colSeq += 1;
        const id = `${vars?.type === 'mirror' ? 'lookup' : 'col'}-${state.colSeq}`;
        const settings_str = vars?.type === 'mirror'
          ? (state.mirrorSettingsBlank ? '{}' : (vars?.defaults || '{"x":1}'))
          : (vars?.defaults || '{}');
        return { create_column: { id, settings_str } };
      }
      if (s.includes('create_view_table')) return { create_view_table: { id: `view-${state.calls.length}` } };
      if (s.includes('update_group')) return { update_group: { id: vars?.g || 'g' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'name' } };
      if (s.includes('views {') || s.includes('views{')) {
        const views = state.existingViews[String(vars?.b?.[0] ?? vars?.b ?? '')] || [];
        return { boards: [{ views }] };
      }
      if (s.includes('groups {') || s.includes('groups{')) {
        return { boards: [{ groups: [{ id: 'topics', title: 'Group Title' }] }] };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));

import {
  buildTaskFlagFormulas,
  countBlueprintSteps,
  applyBoardBlueprint,
  BLUEPRINT_GROUPS,
  BLUEPRINT_NAME_TITLES,
} from '../boardBlueprint.js';

const BOARD_IDS = { discussions: '100', topics: '200', tasks: '300', decisions: '400' };

// The plain-column mapping the blueprint builds ON TOP OF (as provisioning
// leaves it after the columns/relations passes).
function baseColumns() {
  return {
    discussions: {
      discussionLeadID: { id: 'people-lead', type: 'people' },
      discussionDateID: { id: 'date-disc', type: 'date' },
      tasksBoardLinkID: { id: 'rel-tasks', type: 'board_relation' },
      topicsBoardLinkID: { id: 'rel-topics', type: 'board_relation' },
    },
    topics: {
      discussionLinkID: { id: 'rel-back-disc', type: 'board_relation' },
    },
    tasks: {
      statusID: { id: 'status-1', type: 'status' },
      deadlineID: { id: 'date-dl', type: 'date' },
      priorityID: { id: 'prio-1', type: 'status' },
      discussionLinkID: { id: 'rel-disc', type: 'board_relation' },
    },
    decisions: {},
  };
}

function emptyCaches() {
  return { discussions: [], topics: [], tasks: [], decisions: [] };
}

const ALL_CREATED = ['discussions', 'topics', 'tasks', 'decisions'];

const createColumnCalls = () => state.calls.filter((c) => c.q.includes('create_column'));
const byTitle = (title) => createColumnCalls().find((c) => c.vars?.title === title);

beforeEach(() => {
  state.calls = [];
  state.colSeq = 0;
  state.mirrorSettingsBlank = false;
  state.failOnTitle = null;
  state.existingViews = {};
  vi.clearAllMocks();
});

describe('round363 — task flag formulas (mirror sources)', () => {
  it('builds the two flag formulas with the LIVE formula text over the mapped ids', () => {
    const out = buildTaskFlagFormulas({ statusID: { id: 'status_x' }, deadlineID: { id: 'date_y' } });
    expect(out).toEqual([
      {
        alias: 'taskDelayedFlagID',
        title: 'האם המשימה בעיכוב',
        formula: 'IF(AND(DAYS(TODAY(), {date_y}) > 0, {status_x} <> "בוצע"), "1", "")',
      },
      {
        alias: 'taskDoneFlagID',
        title: 'האם המשימה בוצעה',
        formula: 'IF({status_x} = "בוצע", 1, "")',
      },
    ]);
  });
});

describe('round363 — applyBoardBlueprint: the effectiveness pipeline', () => {
  it('creates the whole chain and each dependent formula references the ids created before it', async () => {
    const columns = baseColumns();
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ALL_CREATED,
    });

    // tasks flags — created on the TASKS board with the live formula text
    const delayed = byTitle('האם המשימה בעיכוב');
    expect(delayed.vars.boardId).toBe('300');
    expect(JSON.parse(delayed.vars.defaults).formula)
      .toBe('IF(AND(DAYS(TODAY(), {date-dl}) > 0, {status-1} <> "בוצע"), "1", "")');
    const done = byTitle('האם המשימה בוצעה');
    expect(JSON.parse(done.vars.defaults).formula).toBe('IF({status-1} = "בוצע", 1, "")');

    // count formulas on the DISCUSSIONS board off the relation column ids
    expect(JSON.parse(byTitle('סך משימות').vars.defaults).formula).toBe('{rel-tasks#Count}');
    expect(JSON.parse(byTitle('סך נושאים').vars.defaults).formula).toBe('{rel-topics#Count}');

    // mirrors: ARRAY form + sum + relation keyed by the tasks link column
    const delayedMirror = byTitle('סך משימות בעיכוב');
    expect(delayedMirror.vars.type).toBe('mirror');
    const md = JSON.parse(delayedMirror.vars.defaults);
    expect(md.relation_column).toEqual({ 'rel-tasks': true });
    expect(md.function).toBe('sum');
    expect(Array.isArray(md.displayed_linked_columns)).toBe(true);
    expect(md.displayed_linked_columns).toEqual([
      { board_id: '300', column_ids: [columns.tasks.taskDelayedFlagID.id] },
    ]);
    const doneMirror = byTitle('סך משימות שבוצעו');
    expect(JSON.parse(doneMirror.vars.defaults).displayed_linked_columns).toEqual([
      { board_id: '300', column_ids: [columns.tasks.taskDoneFlagID.id] },
    ]);

    // percent formulas reference the total + mirror ids created above
    const totalId = columns.discussions.totalTasksID.id;
    const doneMirrorId = columns.discussions.completedTasksID.id;
    const delayedMirrorId = columns.discussions.delayedTasksID.id;
    expect(JSON.parse(byTitle('ביצוע %').vars.defaults).formula).toBe(
      `IF(AND({${totalId}} <> "0", {${totalId}} > 0), ROUND(DIVIDE(MULTIPLY({${doneMirrorId}}, 100), {${totalId}}), 0), "")`
    );
    expect(JSON.parse(byTitle('בעיכוב %').vars.defaults).formula).toBe(
      `IF(AND({${totalId}} <> "0", {${totalId}} > 0), ROUND(DIVIDE(MULTIPLY({${delayedMirrorId}}, 100), {${totalId}}), 0), "")`
    );

    // effectiveness references the two percent ids
    const pctDone = columns.discussions.completionPctID.id;
    const pctDelayed = columns.discussions.delayedPctID.id;
    expect(JSON.parse(byTitle('אפקטיביות דיון').vars.defaults).formula).toBe(
      `IF({${pctDelayed}}>50, "נדרשת בקרה", IF({${pctDone}}>75, "דיון מוצלח", "עוד מוקדם להסיק"))`
    );

    // every rollup alias mapped as a read-only display field (verified: false)
    for (const alias of ['totalTasksID', 'totalTopicsID', 'completedTasksID', 'delayedTasksID', 'completionPctID', 'delayedPctID', 'effectivenessID']) {
      expect(columns.discussions[alias].id).toBeTruthy();
      expect(columns.discussions[alias].verified).toBe(false);
    }
    for (const alias of ['taskDelayedFlagID', 'taskDoneFlagID']) {
      expect(columns.tasks[alias].id).toBeTruthy();
      expect(columns.tasks[alias].verified).toBe(false);
    }
  });

  it('a mirror whose settings came back BLANK is not mapped (the silently-unconfigured trap)', async () => {
    state.mirrorSettingsBlank = true;
    const columns = baseColumns();
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ALL_CREATED,
    });
    expect(columns.discussions.delayedTasksID).toBeUndefined();
    expect(columns.discussions.completedTasksID).toBeUndefined();
    // and the dependents that need them are skipped, not created broken
    expect(byTitle('ביצוע %')).toBeUndefined();
    expect(byTitle('בעיכוב %')).toBeUndefined();
    expect(byTitle('אפקטיביות דיון')).toBeUndefined();
  });

  it('REUSES an existing column by (title, type) instead of duplicating it', async () => {
    const columns = baseColumns();
    const caches = emptyCaches();
    caches.tasks.push({ id: 'existing-flag', title: 'האם המשימה בעיכוב', type: 'formula', settings_str: '{"formula":"x"}' });
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: caches,
      createdBoards: ALL_CREATED,
    });
    expect(byTitle('האם המשימה בעיכוב')).toBeUndefined();
    expect(columns.tasks.taskDelayedFlagID.id).toBe('existing-flag');
  });

  it('does NOT adopt an existing mirror whose settings_str is blank — creates a configured one', async () => {
    const columns = baseColumns();
    const caches = emptyCaches();
    caches.discussions.push({ id: 'blank-mirror', title: 'סך משימות בעיכוב', type: 'mirror', settings_str: '{}' });
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: caches,
      createdBoards: ALL_CREATED,
    });
    expect(byTitle('סך משימות בעיכוב')).toBeDefined();
    expect(columns.discussions.delayedTasksID.id).not.toBe('blank-mirror');
  });

  it('TOP-UP: an alias already mapped is left alone', async () => {
    const columns = baseColumns();
    columns.discussions.effectivenessID = { id: 'kept', type: 'formula', verified: false };
    columns.tasks.taskDoneFlagID = { id: 'kept-flag', type: 'formula', verified: false };
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: [],
    });
    expect(byTitle('אפקטיביות דיון')).toBeUndefined();
    expect(byTitle('האם המשימה בוצעה')).toBeUndefined();
    expect(columns.discussions.effectivenessID.id).toBe('kept');
    // the done-mirror still gets built, pointing at the KEPT flag id
    const doneMirror = byTitle('סך משימות שבוצעו');
    expect(JSON.parse(doneMirror.vars.defaults).displayed_linked_columns).toEqual([
      { board_id: '300', column_ids: ['kept-flag'] },
    ]);
  });

  it('one element failing does not stop the rest (fail-soft, logged)', async () => {
    state.failOnTitle = 'האם המשימה בעיכוב';
    const columns = baseColumns();
    await expect(applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ALL_CREATED,
    })).resolves.toBeDefined();
    // the failed branch's dependents are skipped…
    expect(byTitle('סך משימות בעיכוב')).toBeUndefined();
    // …but the independent chain still completed
    expect(byTitle('האם המשימה בוצעה')).toBeDefined();
    expect(byTitle('סך משימות')).toBeDefined();
    expect(byTitle('סך משימות שבוצעו')).toBeDefined();
  });
});

describe('round363 — groups + name-column terminology (created boards ONLY)', () => {
  it('renames + colors the default group and renames the name column on boards this run created', async () => {
    const columns = baseColumns();
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ['topics', 'decisions'],
    });
    const groupCalls = state.calls.filter((c) => c.q.includes('update_group'));
    const boardsTouched = new Set(groupCalls.map((c) => String(c.vars.b)));
    expect(boardsTouched).toEqual(new Set(['200', '400']));
    // title + NAMED color per board (hex is rejected by the API)
    const topicCalls = groupCalls.filter((c) => String(c.vars.b) === '200');
    const values = topicCalls.map((c) => c.vars.v);
    expect(values).toContain(BLUEPRINT_GROUPS.topics.title);
    expect(values).toContain(BLUEPRINT_GROUPS.topics.color);
    expect(BLUEPRINT_GROUPS.topics.color).toBe('orange');
    expect(BLUEPRINT_GROUPS.discussions.color).toBe('dark-orange');

    const renames = state.calls.filter((c) => c.q.includes('change_column_title'));
    expect(renames.map((c) => [String(c.vars.b), c.vars.t]).sort()).toEqual([
      ['200', BLUEPRINT_NAME_TITLES.topics],
      ['400', BLUEPRINT_NAME_TITLES.decisions],
    ].sort());
    // the HOST board (discussions, not created) is never renamed/regrouped
    expect(groupCalls.some((c) => String(c.vars.b) === '100')).toBe(false);
    expect(renames.some((c) => String(c.vars.b) === '100')).toBe(false);
  });
});

describe('round363 — default views', () => {
  it('creates the blueprint views with mapped column ids in group_by/sort/filter', async () => {
    const columns = baseColumns();
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ALL_CREATED,
    });
    const viewCalls = state.calls.filter((c) => c.q.includes('create_view_table'));
    const names = viewCalls.map((c) => c.vars.name);
    expect(names).toEqual(expect.arrayContaining([
      'לפי מוביל', 'לפי אפקטיביות', 'לפי דיון', 'לפי עדיפות', 'עיכובים',
    ]));

    const byLead = viewCalls.find((c) => c.vars.name === 'לפי מוביל');
    expect(byLead.vars.b).toBe('100');
    expect(byLead.vars.settings.group_by.conditions).toEqual([{ columnId: 'people-lead' }]);
    expect(byLead.vars.sort).toEqual([{ column_id: 'date-disc', direction: 'desc' }]);

    // the effectiveness view carries the definition's group-sort direction (ASC)
    const byEffectiveness = viewCalls.find((c) => c.vars.name === 'לפי אפקטיביות');
    expect(byEffectiveness.vars.settings.group_by.conditions).toEqual([{
      columnId: columns.discussions.effectivenessID.id,
      config: { sortSettings: { direction: 'ASC' } },
    }]);

    const delays = viewCalls.find((c) => c.vars.name === 'עיכובים');
    expect(delays.vars.b).toBe('300');
    expect(delays.vars.filter).toEqual({
      operator: 'and',
      rules: [{ column_id: columns.tasks.taskDelayedFlagID.id, compare_value: [], operator: 'is_not_empty' }],
    });

    const byPriority = viewCalls.find((c) => c.vars.name === 'לפי עדיפות');
    expect(byPriority.vars.filter.rules).toEqual([
      { column_id: 'status-1', compare_value: [1], operator: 'not_any_of' },
    ]);
  });

  it('skips a view whose name already exists on the board, and one whose group-by alias is unmapped', async () => {
    const columns = baseColumns();
    delete columns.tasks.priorityID;
    state.existingViews['300'] = [{ name: 'לפי דיון' }];
    await applyBoardBlueprint({
      boardIds: BOARD_IDS,
      columns,
      existingByBoard: emptyCaches(),
      createdBoards: ALL_CREATED,
    });
    const names = state.calls.filter((c) => c.q.includes('create_view_table')).map((c) => c.vars.name + '@' + c.vars.b);
    expect(names).not.toContain('לפי דיון@300'); // same-name view exists
    expect(names).toContain('לפי דיון@200'); // the topics one is unaffected
    expect(names).not.toContain('לפי עדיפות@300'); // priority alias unmapped
  });
});

describe('round363 — countBlueprintSteps', () => {
  it('counts columns + groups + renames + views by the same created-board rules as countSteps', () => {
    // 9 columns + (topics,decisions,tasks) × (group+rename) + 6 views
    expect(countBlueprintSteps({ mode: 'create' }, false)).toBe(9 + 3 * 2 + 6);
    // connected tasks board is NOT restyled
    expect(countBlueprintSteps({ mode: 'connect' }, false)).toBe(9 + 2 * 2 + 6);
    // custom-object install creates the discussions board too
    expect(countBlueprintSteps({ mode: 'create' }, true)).toBe(9 + 4 * 2 + 6);
  });
});

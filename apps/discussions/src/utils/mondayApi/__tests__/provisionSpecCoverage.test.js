import { describe, it, expect } from 'vitest';
import { PROVISION_SPEC } from '../provisionBoards.js';
import { COLUMN_SCHEMA } from '../boards.config.js';

/*
 * round312 — the recurring bug class this file exists to end.
 *
 * There are TWO lists: COLUMN_SCHEMA (what the app knows how to map and use) and
 * PROVISION_SPEC (what the install/top-up actually CREATES). An alias added to the
 * first and forgotten in the second produces a feature that works in an account
 * where someone once made the column by hand, and silently does nothing in every
 * fresh install. Owner-reported from a new-account install, three times over:
 *
 *   · tasks.partnersID              (round305) — never provisioned
 *   · discussions.externalParticipantsID (round211) — never provisioned
 *   · topics subitems: 5 of the 7 point-level aliases — never provisioned, so the
 *     subitems board kept monday's default ENGLISH columns and nothing mapped
 *
 * So the assertions below are DERIVED from COLUMN_SCHEMA rather than listing the
 * fixed aliases: adding the next alias to the schema and forgetting the spec fails
 * here, which is the whole point. Anything deliberately NOT provisioned has to be
 * named in the exception sets, with the reason.
 */

// Board keys the wizard provisions. `decisions` IS provisioned; every board key in
// PROVISION_SPEC must be a real schema board.
const PROVISIONED_BOARDS = ['discussions', 'topics', 'tasks', 'decisions'];

/*
 * Aliases the app maps but must NOT create:
 *  - formula/mirror: monday cannot create these via the API at all (they need a
 *    formula body / a source column picked by hand).
 *  - board_relation: created by the `relations` / `subitemRelations` passes, not the
 *    plain column pass — asserted separately below.
 *  - the reflection back-links: monday auto-creates them on the TARGET board when
 *    the bidirectional connect column is made; mapReflection maps them.
 *  - discussionTypeID / taskTypeID: the account-level MANAGED dropdown, attached by
 *    ensureManagedTypeColumn rather than create_column.
 *  - the "My Tasks"-only columns and summaryFileID etc. are provisioned; nothing to
 *    exempt there.
 */
const UNCREATABLE_TYPES = new Set(['formula', 'mirror', 'subtasks']);
const EXEMPT = {
  discussions: new Set([
    'discussionTypeID',      // managed dropdown (ensureManagedTypeColumn)
    /*
     * round380 — פרויקט connects to the ACCOUNT'S OWN projects board, which this app
     * does not create, does not know the id of, and must never touch. A connect-boards
     * column can only be created once its TARGET board is known, so provisioning it
     * would mean either guessing a board or creating a column connected to nothing.
     *
     * This is therefore a permanent exemption, not the "not yet judged" limbo below:
     * the owner creates and connects the column in monday and maps it in Settings, and
     * `isProjectModeReady` keeps the whole project path hidden until they have. That
     * gate is what makes an unprovisioned column safe here — unlike round340's
     * taskNotesID/priorityID, where the same "don't be presumptuous" reasoning left
     * two features with nothing to map and no way to appear.
     */
    'projectLinkID',
  ]),
  topics: new Set([
    'discussionLinkID',      // reflection of discussions.topicsBoardLinkID
    'tasksLinkID',           // reflection of the round313 tasks.topicsLinkID relation
    /*
     * round313 — DEAD schema entries, verified by grep: nothing outside
     * boards.config.js references either, and neither is a row in
     * TOPICS_SETTINGS_FIELDS, so no surface can even map them. Provisioning them
     * would put columns nobody reads on a customer's board.
     */
    'topicDetailID', 'counterID',
  ]),
  tasks: new Set([
    'taskTypeID',            // the SAME managed dropdown as discussions
    'discussionLinkID',      // reflection of discussions.tasksBoardLinkID
    /*
     * round340 — `taskNotesID` and `priorityID` LEFT this set: they are provisioned now.
     *
     * The exemption reasoning ("owner-mapped optional columns … creating one would be
     * presumptuous") was wrong for these two, and the owner reported the consequence
     * from a fresh-account install: MyTasksTable gates both cells on the mapping being
     * present, so with no column created there was nothing to map and both features
     * silently did not exist. `taskViewersID` left the set too, by being retired from
     * COLUMN_SCHEMA entirely.
     */
    // round313 — dead schema entry: no reference anywhere outside boards.config.js.
    'phaseID',
  ]),
  decisions: new Set([
    'discussionLinkID',      // reflection of discussions.decisionsBoardLinkID
    'pointLinkID',           // per-point link, written from the topics side
    /*
     * round313 — RETIRED, not forgotten. SettingsModal states it outright: the
     * decisions priority column "was dropped from the UI … it is excluded from the
     * MAPPING screen too. The alias stays in COLUMN_SCHEMA … so
     * useDecisions/useMyDecisions references never break". Creating a column for a
     * retired feature would resurrect it by the back door; the remaining readers all
     * gate on the mapping being present (e.g. PreviousTasksTab's
     * `decCols.decisionPriorityID?.id &&`) and degrade cleanly without it.
     */
    'decisionPriorityID',
  ]),
};

/*
 * round313 — the baseline is EMPTY, and that is the point.
 *
 * round312 pinned seven aliases here as "surfaced but not yet judged". Each has now
 * been resolved on evidence rather than left in limbo: `topics.topicPriorityID` and
 * `tasks.topicsLinkID` were LIVE code paths and are provisioned (the latter brings
 * `topics.tasksLinkID` with it as its reflection); the other four are dead or
 * retired and are named in EXEMPT above with the reason.
 *
 * Keeping the (now empty) map rather than deleting the mechanism is deliberate: the
 * next alias that arrives unprovisioned lands here as a failure with nowhere to hide,
 * and adding to this list again has to be an explicit, argued act.
 */
const KNOWN_UNPROVISIONED = {
  discussions: [],
  topics: [],
  tasks: [],
  decisions: [],
};

const specAliases = (key) => new Set([
  ...(PROVISION_SPEC[key].columns || []).map((c) => c.alias),
  ...(PROVISION_SPEC[key].relations || []).map((c) => c.alias),
  ...(PROVISION_SPEC[key].subitems || []).map((c) => c.alias),
  ...(PROVISION_SPEC[key].subitemRelations || []).map((c) => c.alias),
]);

// Aliases of `key` that a fresh install is expected to create.
const expectedAliases = (key) => Object.entries(COLUMN_SCHEMA[key] || {})
  .filter(([alias, def]) => !UNCREATABLE_TYPES.has(def.type) && !(EXEMPT[key] || new Set()).has(alias))
  .map(([alias]) => alias);

describe('PROVISION_SPEC covers every mappable COLUMN_SCHEMA alias', () => {
  PROVISIONED_BOARDS.forEach((key) => {
    it(`${key}: nothing is unprovisioned beyond the pinned baseline`, () => {
      const provisioned = specAliases(key);
      const missing = expectedAliases(key).filter((a) => !provisioned.has(a));
      expect(missing.sort()).toEqual([...KNOWN_UNPROVISIONED[key]].sort());
    });
  });

  it('the three owner-reported gaps are closed', () => {
    // named explicitly so a future exemption cannot quietly re-open them
    expect(specAliases('tasks').has('partnersID')).toBe(true);
    expect(specAliases('discussions').has('externalParticipantsID')).toBe(true);
    ['pointCheckedID', 'pointCreatorID', 'pointResponsesID',
      'pointDecisionsLinkID', 'pointTasksLinkID'].forEach((alias) => {
      expect(specAliases('topics').has(alias)).toBe(true);
    });
  });

  it('provisions every alias with the TYPE the schema declares', () => {
    // a people column provisioned as text maps fine and then fails on write
    PROVISIONED_BOARDS.forEach((key) => {
      const all = [
        ...(PROVISION_SPEC[key].columns || []),
        ...(PROVISION_SPEC[key].subitems || []),
      ];
      all.forEach((col) => {
        const schema = COLUMN_SCHEMA[key]?.[col.alias];
        if (!schema) return; // spec-only helper column — nothing to compare
        expect(col.type).toBe(schema.type);
      });
    });
  });

  it('puts every board_relation alias in a relations list, never in the plain columns', () => {
    PROVISIONED_BOARDS.forEach((key) => {
      (PROVISION_SPEC[key].columns || []).forEach((c) => expect(c.type).not.toBe('board_relation'));
      (PROVISION_SPEC[key].subitems || []).forEach((c) => expect(c.type).not.toBe('board_relation'));
    });
  });
});

describe('the topics SUBITEMS board', () => {
  it('provisions all seven point-level aliases the schema declares', () => {
    const schemaSubitems = Object.entries(COLUMN_SCHEMA.topics)
      .filter(([, def]) => def.subitems === true)
      .map(([alias]) => alias);
    expect(schemaSubitems).toHaveLength(7);
    const provisioned = specAliases('topics');
    schemaSubitems.forEach((alias) => expect(provisioned.has(alias)).toBe(true));
  });

  it('routes the two point-level links through subitemRelations, with their targets', () => {
    // they live on the SUBITEMS board, which the main relations pass cannot reach
    const rels = PROVISION_SPEC.topics.subitemRelations;
    expect(rels.map((r) => r.alias).sort()).toEqual(['pointDecisionsLinkID', 'pointTasksLinkID']);
    expect(rels.find((r) => r.alias === 'pointDecisionsLinkID').target).toBe('decisions');
    expect(rels.find((r) => r.alias === 'pointTasksLinkID').target).toBe('tasks');
    rels.forEach((r) => expect(PROVISION_SPEC[r.target]).toBeTruthy());
  });

  it('gives every subitem column a non-empty Hebrew title', () => {
    // the reported symptom was English default columns; a blank/ASCII title here
    // would reproduce it
    [...PROVISION_SPEC.topics.subitems, ...PROVISION_SPEC.topics.subitemRelations].forEach((c) => {
      expect(c.title.trim()).not.toBe('');
      expect(/[֐-׿]/.test(c.title)).toBe(true);
    });
  });

  it('has no duplicate titles on the subitems board', () => {
    // ensureColumn matches by (title, type), so two specs sharing a title+type
    // would collapse onto ONE column and leave an alias mapped to the wrong id
    const seen = [...PROVISION_SPEC.topics.subitems, ...PROVISION_SPEC.topics.subitemRelations]
      .map((c) => `${c.title}|${c.type || 'board_relation'}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('relation targets', () => {
  it('every relation target is a provisioned board', () => {
    PROVISIONED_BOARDS.forEach((key) => {
      (PROVISION_SPEC[key].relations || []).forEach((rel) => {
        expect(PROVISIONED_BOARDS).toContain(rel.target);
      });
    });
  });

  it('every declared reflection names a real board + alias', () => {
    // a reflection whose alias is not in COLUMN_SCHEMA is mapped into a key nothing
    // reads — the write lands and the feature still looks broken
    PROVISIONED_BOARDS.forEach((key) => {
      (PROVISION_SPEC[key].relations || []).forEach((rel) => {
        if (!rel.reflection) return;
        expect(PROVISIONED_BOARDS).toContain(rel.reflection.board);
        expect(COLUMN_SCHEMA[rel.reflection.board]).toHaveProperty(rel.reflection.alias);
        expect(rel.reflection.title.trim()).not.toBe('');
      });
    });
  });
});

describe('the task → topic link (round313)', () => {
  it('is a tasks-side relation pointing at the topics board', () => {
    // useTasks writes relations.topicsLinkID on every task created from a topic;
    // unprovisioned, that write resolved to no column and did nothing
    const rel = PROVISION_SPEC.tasks.relations.find((r) => r.alias === 'topicsLinkID');
    expect(rel).toBeTruthy();
    expect(rel.target).toBe('topics');
  });

  it('carries the reflection that maps the topics-side back-link', () => {
    // one bidirectional relation closes BOTH previously-unprovisioned aliases
    const rel = PROVISION_SPEC.tasks.relations.find((r) => r.alias === 'topicsLinkID');
    expect(rel.reflection).toEqual(
      expect.objectContaining({ board: 'topics', alias: 'tasksLinkID' }),
    );
  });

  it('does not collide with a title already used on either board', () => {
    const rel = PROVISION_SPEC.tasks.relations.find((r) => r.alias === 'topicsLinkID');
    const titlesOn = (key) => [
      ...(PROVISION_SPEC[key].columns || []),
      ...(PROVISION_SPEC[key].relations || []),
    ].map((c) => c.title);
    // ensureColumn matches by (title, type): a clash would silently reuse the wrong column
    expect(titlesOn('tasks').filter((t) => t === rel.title)).toHaveLength(1);
    expect(titlesOn('topics')).not.toContain(rel.reflection.title);
  });
});

describe('the per-topic priority column (round313)', () => {
  it('is provisioned as a status column on the topics board', () => {
    const col = PROVISION_SPEC.topics.columns.find((c) => c.alias === 'topicPriorityID');
    expect(col).toBeTruthy();
    expect(col.type).toBe('status');
  });
});

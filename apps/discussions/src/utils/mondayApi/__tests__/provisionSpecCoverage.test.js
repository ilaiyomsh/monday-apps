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
  ]),
  topics: new Set([
    'discussionLinkID',      // reflection of discussions.topicsBoardLinkID
  ]),
  tasks: new Set([
    'taskTypeID',            // the SAME managed dropdown as discussions
    'discussionLinkID',      // reflection of discussions.tasksBoardLinkID
    // Owner-mapped optional columns: the app hides the feature when unmapped and
    // the owner chooses which existing column to use, so creating one would be
    // presumptuous rather than helpful.
    'taskNotesID', 'priorityID', 'taskViewersID',
  ]),
  decisions: new Set([
    'discussionLinkID',      // reflection of discussions.decisionsBoardLinkID
    'pointLinkID',           // per-point link, written from the topics side
  ]),
};

/*
 * KNOWN GAP BASELINE — aliases the schema declares, the wizard does NOT create, and
 * round312 deliberately did not touch. Surfaced BY the invariant below while fixing
 * the three the owner reported; left alone because whether each is a live feature or
 * a vestigial entry from the Vibe export is a product question, not a code one
 * (`tasks.topicsLinkID` still carries its generated title "link to נושאים לדיון1",
 * which rather suggests the latter). Raised with the owner separately.
 *
 * Pinned as an EXACT set on purpose: adding a new alias without provisioning it
 * fails here, and provisioning one of these fails too — which is the nudge to
 * delete it from this list. Either way the set cannot drift in silence.
 */
const KNOWN_UNPROVISIONED = {
  discussions: [],
  topics: ['topicPriorityID', 'tasksLinkID', 'topicDetailID', 'counterID'],
  tasks: ['topicsLinkID', 'phaseID'],
  decisions: ['decisionPriorityID'],
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
});

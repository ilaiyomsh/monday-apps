// Characterization of the q1..q4 chain in fetchAllowedUsers, driven against the
// dev-harness monday-sdk stub with the REAL captured probe responses registered
// via installAppApiHandlers (see src/test-utils/probes/MANIFEST.md). vitest
// aliases monday-sdk-js -> the stub (vite.config.js test.alias), so the
// mondayService the service imports resolves to the SAME shared harness the
// test drives here.
//
// The two "modified capture" cases (relation-missing, subset/partial) do NOT
// hand-build a monday response: they take a real capture and remove/extend one
// field to reproduce a genuine live state (a deleted relation column; a linked
// item the caller can no longer read), keeping every other field exactly as
// captured.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { harness } from '../dev-harness/monday-sdk-stub.js';
import { installAppApiHandlers } from '../test-utils/probeFixtures.js';
import getColumnValueCapture from '../test-utils/probes/GetColumnValue.json';
import { fetchAllowedUsers, AppError } from './allowedUsersService.js';

// Settings that match the probe boards/columns exactly (MANIFEST.md).
const SETTINGS = {
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true },
};
const SOURCE_ITEM_ID = '12511436134';
const OWN_COLUMN_ID = 'multiple_person_mm562c71';

const call = (overrides) =>
  fetchAllowedUsers({ itemId: SOURCE_ITEM_ID, columnId: OWN_COLUMN_ID, settings: SETTINGS, ...overrides });

beforeEach(() => {
  harness.reset();
});

afterEach(() => {
  harness.reset();
});

describe('fetchAllowedUsers — happy chain (relation -> linked people -> team members)', () => {
  it('resolves the "test ilai" team to EXACTLY its 3 members by id and Hebrew name', async () => {
    installAppApiHandlers(harness);

    const result = await call();

    // Exactly the three seeded members of team 1348990, he-name sorted.
    expect(result.users.map((u) => u.id)).toEqual(['37022703', '48274917', '96863017']);
    expect(result.users.map((u) => u.name)).toEqual([
      'עידו פיוטרקובסקי',
      'עילי שלם',
      'רוני ארגמן',
    ]);
    expect(result.users).toHaveLength(3);

    // The one referenced team is listed; nothing missing; full (not partial) chain.
    expect(result.teams).toEqual([{ id: '1348990', name: 'test ilai' }]);
    expect(result.missingTeamIds).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.emptyChain).toBe(false);
    // Own people column was empty in the capture (value:null) -> empty selection.
    expect(result.selection).toEqual([]);
  });
});

describe('fetchAllowedUsers — selection enrichment + linked-item flag', () => {
  it('enriches a stale own-column selection with the resolved name/photo from team membership', async () => {
    // Real capture with the own people column carrying a prior selection (person
    // 48274917 "עילי שלם"), who is also a member of the allowed team — so the
    // resolved details come from team membership, not a q4 lookup. Before the
    // fix, `selection` carried only bare {id, kind} and the chip rendered nameless.
    const withSelection = {
      items: getColumnValueCapture.data.items.map((it) => ({
        ...it,
        column_values: it.column_values.map((cv) =>
          cv.id === 'multiple_person_mm562c71'
            ? { ...cv, value: JSON.stringify({ personsAndTeams: [{ id: 48274917, kind: 'person' }] }) }
            : cv,
        ),
      })),
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: withSelection } });

    const result = await call();

    expect(result.selection).toEqual([
      {
        id: '48274917',
        kind: 'person',
        name: 'עילי שלם',
        photo_thumb:
          'https://files.monday.com/use1/photos/48274917/thumb/48274917-user_photo_initials_2026_06_08_11_53_40.png?1780919621',
      },
    ]);
    expect(result.hadLinkedItems).toBe(true);
  });

  it('leaves an unresolvable stale selection id as a bare {id, kind} entry (no name invented)', async () => {
    // Selection id 99999999 is neither a team member nor returned by the q4
    // user-details lookup, so no name/photo can be resolved — the entry stays bare.
    const withUnknownSelection = {
      items: getColumnValueCapture.data.items.map((it) => ({
        ...it,
        column_values: it.column_values.map((cv) =>
          cv.id === 'multiple_person_mm562c71'
            ? { ...cv, value: JSON.stringify({ personsAndTeams: [{ id: 99999999, kind: 'person' }] }) }
            : cv,
        ),
      })),
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: withUnknownSelection } });

    const result = await call();

    expect(result.selection).toEqual([{ id: '99999999', kind: 'person' }]);
  });

  it('invokes onStep with "linkedPeople" then "teams" in order as the chain advances', async () => {
    installAppApiHandlers(harness);
    const steps = [];

    await call({ onStep: (phase) => steps.push(phase) });

    // q2 (linked people) reported before q3 (teams); no 'relation'/'ready' here —
    // those are the hook's own bookends, not chain phases.
    expect(steps).toEqual(['linkedPeople', 'teams']);
  });

  it('reports hadLinkedItems:false when the relation column links no items', async () => {
    const noLinks = {
      items: getColumnValueCapture.data.items.map((it) => ({
        ...it,
        column_values: it.column_values.map((cv) =>
          cv.id === 'board_relation_mm56dy57' ? { ...cv, linked_item_ids: [] } : cv,
        ),
      })),
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: noLinks } });

    const result = await call();

    expect(result.hadLinkedItems).toBe(false);
    expect(result.emptyChain).toBe(true);
  });
});

describe('fetchAllowedUsers — structural drift on the source item', () => {
  it('throws AppError RELATION_COLUMN_MISSING when the relation column is absent from the source item', async () => {
    // Real capture with the board_relation column filtered out (column deleted).
    const withoutRelation = {
      items: getColumnValueCapture.data.items.map((it) => ({
        ...it,
        column_values: it.column_values.filter((cv) => cv.id !== 'board_relation_mm56dy57'),
      })),
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: withoutRelation } });

    const err = await call().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RELATION_COLUMN_MISSING');
  });
});

describe('fetchAllowedUsers — monday API soft error', () => {
  it('wraps a GraphQL soft error from the first call into AppError API_ERROR (never swallowed)', async () => {
    installAppApiHandlers(harness);
    harness.failures.apiErrorNext = true; // next api() resolves { errors: [...] }

    const err = await call().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('API_ERROR');
  });
});

describe('fetchAllowedUsers — partial linked-item visibility', () => {
  it('sets partial:true when the linked-people query returns a strict subset of the requested items', async () => {
    // q1 links TWO items (real target + one the caller cannot read); q2 (default
    // capture) returns only the one readable item -> strict subset -> partial.
    const twoLinks = {
      items: getColumnValueCapture.data.items.map((it) => ({
        ...it,
        column_values: it.column_values.map((cv) =>
          cv.id === 'board_relation_mm56dy57'
            ? { ...cv, linked_item_ids: [...cv.linked_item_ids, '999999999'] }
            : cv,
        ),
      })),
    };
    installAppApiHandlers(harness, { GetColumnValue: { data: twoLinks } });

    const result = await call();

    expect(result.partial).toBe(true);
    // The one readable linked item still resolves the full team.
    expect(result.users.map((u) => u.id)).toEqual(['37022703', '48274917', '96863017']);
  });
});

/*
 * dropdownLabels — contract tests for the dropdown-label write paths:
 *   - addManagedDropdownLabel (account-level update_dropdown_managed_column)
 *   - detectManagedColumnId's NEW opts.type filter
 *   - addDropdownLabel (regular board-level path + managed hint + self-heal)
 *
 * Written test-first against the JSDoc contracts (the bodies throw
 * NOT_IMPLEMENTED) using REAL captured fixtures from
 * __fixtures__/dropdownLabels.fixtures.js — variants are derived by cloning
 * fixture objects, never by inventing response shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bake the routing into the hoisted mock (same seam as managedColumns.test.js);
// scenarios are configured via the mutable `state`.
// Dispatch pitfall: check the MANAGED mutation name before anything else so the
// generic 'managed_column' / 'update_dropdown_column' branches never shadow it.
const { api, state } = vi.hoisted(() => {
  const state = {
    boardReads: [],      // queue of `boards` query responses; last one repeats
    managedList: [],     // managed_column(state: active) — account list
    managedRead: [],     // managed_column(id: $id) — read of one managed column
    regularUpdate: null, // response for update_dropdown_column, or { throws }
    managedUpdate: null, // response for update_dropdown_managed_column, or { throws }
  };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      if (s.includes('update_dropdown_managed_column')) {
        const r = state.managedUpdate;
        if (r && r.throws) throw r.throws;
        if (!r) throw new Error('test plumbing: unconfigured update_dropdown_managed_column');
        return r;
      }
      if (s.includes('update_dropdown_column')) {
        const r = state.regularUpdate;
        if (r && r.throws) throw r.throws;
        if (!r) throw new Error('test plumbing: unconfigured update_dropdown_column');
        return r;
      }
      if (s.includes('managed_column')) {
        const byId = !!(vars && (vars.id || vars.ids));
        return { managed_column: byId ? state.managedRead : state.managedList };
      }
      if (s.includes('boards')) {
        return state.boardReads.length > 1 ? state.boardReads.shift() : state.boardReads[0];
      }
      throw new Error(`test plumbing: unrouted query: ${s.slice(0, 80)}`);
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));

import { addManagedDropdownLabel, detectManagedColumnId } from '../managedColumns.js';
import { addDropdownLabel } from '../../../hooks/useDropdownOptions.js';
import { setActiveConfig } from '../board-config-store.js';
import * as FX from '../__fixtures__/dropdownLabels.fixtures.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

// The REAL dropdown-type managed column ("סוג דיון", labels 1-5) from the
// captured account list.
const DROPDOWN_MANAGED_ID = '8bb03419-cca9-422a-b5eb-0727b2c66340';
const dropdownManaged = FX.managedColumnList.managed_column.find((m) => m.id === DROPDOWN_MANAGED_ID);
const FIVE_LABELS = dropdownManaged.settings_json.labels; // ids 1-5, all active

const BOARD_ID = '18416019251';
const COL_ID = 'dropdown_mm4wy44c';

// Board column read (boards → columns) derived from the captured shape, with a
// chosen label set.
function boardRead(labels, extra = {}) {
  const read = clone(FX.regularColumnRead);
  read.boards[0].columns[0].id = COL_ID;
  read.boards[0].columns[0].settings.labels = clone(labels);
  Object.assign(read.boards[0].columns[0], extra);
  return read;
}

// What assertNoGraphQLErrors surfaces to the SUT: a thrown Error carrying the
// soft error's errorCode + raw errors.
const softError = (fxErrors) =>
  Object.assign(new Error(fxErrors[0].message), {
    errorCode: fxErrors[0].extensions.code,
    response: { errors: fxErrors },
  });

// Collect every primitive value nested anywhere in the mutation variables —
// shape-agnostic way to assert "the vars carry this exact id/revision".
function deepPrimitives(v, acc = []) {
  if (v === null || typeof v !== 'object') { acc.push(v); return acc; }
  Object.values(v).forEach((x) => deepPrimitives(x, acc));
  return acc;
}

// Find the settings.labels array nested anywhere in the mutation variables.
function findLabelsArray(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.labels)) return obj.labels;
  for (const v of Object.values(obj)) {
    const r = findLabelsArray(v);
    if (r) return r;
  }
  return null;
}

const managedMutationCalls = () =>
  api.mock.calls.filter(([q]) => String(q).includes('update_dropdown_managed_column'));
const regularMutationCalls = () =>
  api.mock.calls.filter(([q]) =>
    String(q).includes('update_dropdown_column') && !String(q).includes('update_dropdown_managed_column'));

beforeEach(() => {
  api.mockClear();
  state.boardReads = [];
  state.managedList = [];
  state.managedRead = [];
  state.regularUpdate = null;
  state.managedUpdate = null;
  setActiveConfig({
    boards: { discussions: { id: BOARD_ID } },
    columns: { discussions: { discussionTypeID: { id: COL_ID } } },
  });
});

describe('detectManagedColumnId — opts.type filter', () => {
  it('resolves the dropdown-type "סוג דיון" uuid when { type: "dropdown" } is given and the real 3-entry account list is searched', async () => {
    state.boardReads = [boardRead(FIVE_LABELS)];
    state.managedList = clone(FX.managedColumnList.managed_column);

    const id = await detectManagedColumnId(BOARD_ID, COL_ID, { type: 'dropdown' });

    expect(id).toBe(DROPDOWN_MANAGED_ID);
  });

  it('returns null with { type: "dropdown" } when the only signature-matching managed column is of type "color"', async () => {
    state.boardReads = [boardRead(FIVE_LABELS)];
    // Derived from the real dropdown entry: SAME labels (so the signature DOES
    // match) but settings_json.type "color" — the type filter must exclude it.
    const colorTwin = clone(dropdownManaged);
    colorTwin.id = '71c2b145-1b1b-46ca-8aac-19036b45d33d';
    colorTwin.settings_json.type = 'color';
    state.managedList = [colorTwin];

    const id = await detectManagedColumnId(BOARD_ID, COL_ID, { type: 'dropdown' });

    expect(id).toBeNull();
  });
});

describe('addManagedDropdownLabel', () => {
  it('throws the exact missing-args error on falsy managedColumnId and on whitespace-only title, without calling the API', async () => {
    await expect(addManagedDropdownLabel({ managedColumnId: null, title: 'טוויסט' }))
      .rejects.toThrow('addManagedDropdownLabel: missing managedColumnId/title');
    await expect(addManagedDropdownLabel({ managedColumnId: DROPDOWN_MANAGED_ID, title: '   ' }))
      .rejects.toThrow('addManagedDropdownLabel: missing managedColumnId/title');
    expect(api).not.toHaveBeenCalled();
  });

  it('throws the exact not-found error when the managed-column read returns no column', async () => {
    state.managedRead = [];

    await expect(addManagedDropdownLabel({ managedColumnId: DROPDOWN_MANAGED_ID, title: 'טוויסט' }))
      .rejects.toThrow('addManagedDropdownLabel: managed column not found');
    expect(managedMutationCalls()).toHaveLength(0);
  });

  it('returns { duplicateId } for an ACTIVE label matching case-insensitively with surrounding whitespace, and sends no mutation', async () => {
    const mc = clone(dropdownManaged);
    mc.settings_json.labels.push({ id: 6, label: 'VIP', is_deactivated: false });
    state.managedRead = [mc];

    const latin = await addManagedDropdownLabel({ managedColumnId: mc.id, title: '  vip  ' });
    expect(latin).toEqual({ duplicateId: 6 });

    const hebrew = await addManagedDropdownLabel({ managedColumnId: mc.id, title: '  כספים  ' });
    expect(hebrew).toEqual({ duplicateId: 1 });

    expect(managedMutationCalls()).toHaveLength(0);
  });

  it('treats a DEACTIVATED same-text label as NOT a duplicate and resends the FULL label set (deactivated flag preserved) plus an id-less new label at the fresh integer revision', async () => {
    const mc = clone(dropdownManaged);
    mc.revision = 4;
    mc.settings_json.labels.push({ id: 6, label: 'טוויסט', is_deactivated: true });
    state.managedRead = [mc];
    state.managedUpdate = clone(FX.managedUpdateSuccess);

    const r = await addManagedDropdownLabel({ managedColumnId: mc.id, title: 'טוויסט' });
    expect(r).toEqual({ ok: true });

    expect(managedMutationCalls()).toHaveLength(1);
    const vars = managedMutationCalls()[0][1];
    const prims = deepPrimitives(vars);
    expect(prims).toContain(DROPDOWN_MANAGED_ID); // managed column id as a string
    expect(prims).toContain(4);                   // fresh revision as an INTEGER
    expect(prims).not.toContain('4');             // ...not as a string

    const labels = findLabelsArray(vars);
    expect(labels).toHaveLength(7); // 6 existing (incl. deactivated) + the new one
    expect(labels.slice(0, 6)).toEqual([
      { id: 1, label: 'כספים', is_deactivated: false },
      { id: 2, label: 'הנהלה', is_deactivated: false },
      { id: 3, label: 'אסטרטגיה', is_deactivated: false },
      { id: 4, label: 'כוח אדם', is_deactivated: false },
      { id: 5, label: 'משפטי', is_deactivated: false },
      { id: 6, label: 'טוויסט', is_deactivated: true },
    ]);
    const created = labels[6];
    expect(created.id).toBeUndefined(); // server assigns the id
    expect(created.label).toBe('טוויסט');
    expect(created.is_deactivated ?? false).toBe(false);
  });

  it('resolves exactly { ok: true } after a successful managed mutation', async () => {
    state.managedRead = [clone(dropdownManaged)];
    state.managedUpdate = clone(FX.managedUpdateSuccess);

    const r = await addManagedDropdownLabel({ managedColumnId: DROPDOWN_MANAGED_ID, title: 'טוויסט' });

    expect(r).toEqual({ ok: true });
    expect(managedMutationCalls()).toHaveLength(1);
  });
});

describe('addDropdownLabel', () => {
  it('throws the exact missing-args error on blank title and on an unmapped alias, without calling the API', async () => {
    await expect(addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: '   ' }))
      .rejects.toThrow('addDropdownLabel: missing name/board/column');
    await expect(addDropdownLabel({ boardKey: 'discussions', alias: 'notMappedID', title: 'טוויסט' }))
      .rejects.toThrow('addDropdownLabel: missing name/board/column');
    expect(api).not.toHaveBeenCalled();
  });

  it('adds via the managed path only when managedColumnId is given — no board-level update_dropdown_column is sent — and returns the hint as managedColumnId with the re-read id', async () => {
    state.managedRead = [clone(dropdownManaged)];
    state.managedUpdate = clone(FX.managedUpdateSuccess);
    // Post-write re-read: the server-assigned id for 'טוויסט' is 3 (captured).
    state.boardReads = [boardRead(FX.regularUpdateSuccess.update_dropdown_column.settings.labels)];

    const r = await addDropdownLabel({
      boardKey: 'discussions',
      alias: 'discussionTypeID',
      title: 'טוויסט',
      managedColumnId: DROPDOWN_MANAGED_ID,
    });

    expect(r).toEqual({ id: 3, managedColumnId: DROPDOWN_MANAGED_ID });
    expect(regularMutationCalls()).toHaveLength(0);
    expect(managedMutationCalls()).toHaveLength(1);
    expect(deepPrimitives(managedMutationCalls()[0][1])).toContain(DROPDOWN_MANAGED_ID);
  });

  it('regular path sends update_dropdown_column with the string revision from the read and the FULL existing label set (deactivated flag preserved) plus an id-less new label, then resolves the re-read id', async () => {
    const existing = [
      ...FX.regularColumnRead.boards[0].columns[0].settings.labels, // ids 1-2, active
      { id: 9, label: 'ארכיון', is_deactivated: true },
    ];
    state.boardReads = [
      boardRead(existing), // pre-write read (settings + revision)
      boardRead(FX.regularUpdateSuccess.update_dropdown_column.settings.labels), // post-write re-read
    ];
    state.regularUpdate = clone(FX.regularUpdateSuccess);

    const r = await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'טוויסט' });

    expect(r).toEqual({ id: 3, managedColumnId: null });
    expect(managedMutationCalls()).toHaveLength(0);
    expect(regularMutationCalls()).toHaveLength(1);
    const vars = regularMutationCalls()[0][1];
    expect(deepPrimitives(vars)).toContain('f4387564c4dbeff549bffbff32ef978a'); // STRING revision from the read

    const labels = findLabelsArray(vars);
    expect(labels).toHaveLength(4); // 3 existing (incl. deactivated) + the new one
    expect(labels.slice(0, 3)).toEqual([
      { id: 1, label: 'כספים', is_deactivated: false },
      { id: 2, label: 'הנהלה', is_deactivated: false },
      { id: 9, label: 'ארכיון', is_deactivated: true },
    ]);
    expect(labels[3].id).toBeUndefined();
    expect(labels[3].label).toBe('טוויסט');
  });

  it('short-circuits on an ACTIVE duplicate (case-insensitive + surrounding whitespace) returning its existing id with no mutation of any kind', async () => {
    const existing = [
      ...FX.regularColumnRead.boards[0].columns[0].settings.labels,
      { id: 4, label: 'Finance', is_deactivated: false },
    ];
    state.boardReads = [boardRead(existing)];

    const r = await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: '  finance ' });

    expect(r).toEqual({ id: 4, managedColumnId: null });
    expect(regularMutationCalls()).toHaveLength(0);
    expect(managedMutationCalls()).toHaveLength(0);
  });

  it('treats a DEACTIVATED same-text label on the REGULAR path as NOT a duplicate — the label is added (full set resent, deactivated flag preserved)', async () => {
    // Boundary ON the edge: the only same-text label is deactivated. Returning
    // its dead id (instead of writing) would hand the caller an unselectable
    // option. Survivor 001 fix.
    const existing = [
      ...FX.regularColumnRead.boards[0].columns[0].settings.labels, // ids 1-2, active
      { id: 7, label: 'טוויסט', is_deactivated: true },
    ];
    state.boardReads = [
      boardRead(existing),
      boardRead([...clone(existing), { id: 8, label: 'טוויסט', is_deactivated: false }]),
    ];
    state.regularUpdate = clone(FX.regularUpdateSuccess);

    const r = await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'טוויסט' });

    expect(regularMutationCalls()).toHaveLength(1);
    const labels = findLabelsArray(regularMutationCalls()[0][1]);
    expect(labels).toHaveLength(4); // 3 existing (incl. the deactivated twin) + the new one
    expect(labels[2]).toEqual({ id: 7, label: 'טוויסט', is_deactivated: true });
    expect(labels[3].id).toBeUndefined();
    expect(labels[3].label).toBe('טוויסט');
    expect(r.managedColumnId).toBeNull();
  });

  it('self-heals on the managed-structure rejection: detects the dropdown-type managed column, adds via the managed mutation, and returns the RESOLVED uuid so the caller can persist it', async () => {
    const pre = boardRead(FIVE_LABELS); // board signature = the real managed dropdown labels
    const post = boardRead([...clone(FIVE_LABELS), { id: 6, label: 'טוויסט', is_deactivated: false }]);
    state.boardReads = [pre, clone(pre), post]; // regular read, detection read, post-write re-read
    state.regularUpdate = { throws: softError(FX.managedStructureErrors) };
    state.managedList = clone(FX.managedColumnList.managed_column);
    state.managedRead = [clone(dropdownManaged)];
    state.managedUpdate = clone(FX.managedUpdateSuccess);

    const r = await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'טוויסט' });

    expect(r).toEqual({ id: 6, managedColumnId: DROPDOWN_MANAGED_ID });
    // Detection ran: the account-level managed_column list was queried.
    expect(api.mock.calls.some(([q]) =>
      String(q).includes('managed_column') && !String(q).includes('update_dropdown_managed_column'))).toBe(true);
    expect(managedMutationCalls()).toHaveLength(1);
    const vars = managedMutationCalls()[0][1];
    expect(deepPrimitives(vars)).toContain(DROPDOWN_MANAGED_ID);
    const labels = findLabelsArray(vars);
    expect(labels).toHaveLength(6); // full existing set (ids 1-5) + the id-less new label
    expect(labels.slice(0, 5)).toEqual(clone(FIVE_LABELS));
    expect(labels[5].id).toBeUndefined();
    expect(labels[5].label).toBe('טוויסט');
  });

  it('rethrows the ORIGINAL structure error object when self-heal detection finds no managed match', async () => {
    state.boardReads = [boardRead(FX.regularColumnRead.boards[0].columns[0].settings.labels)]; // 2 labels — matches no managed column
    const original = softError(FX.managedStructureErrors);
    state.regularUpdate = { throws: original };
    state.managedList = clone(FX.managedColumnList.managed_column); // real list; none matches the 2-label signature

    let caught;
    try {
      await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'טוויסט' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(original); // the SAME object, not a wrapper
    expect(caught.message).toBe('notices.column.settings.update.error.structure');
    expect(caught.errorCode).toBe('INVALID_ARGUMENT_EXCEPTION');
    expect(managedMutationCalls()).toHaveLength(0);
  });

  it('rethrows a REVISION_MISMATCH error unchanged with NO detection and NO managed mutation attempted', async () => {
    state.boardReads = [boardRead(FX.regularColumnRead.boards[0].columns[0].settings.labels)];
    const original = softError(FX.regularRevisionMismatchErrors);
    state.regularUpdate = { throws: original };

    let caught;
    try {
      await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'טוויסט' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(original);
    expect(caught.message).toBe('Board revision mismatch');
    expect(caught.errorCode).toBe('REVISION_MISMATCH');
    // 'managed_column' is a substring of the managed mutation name too, so this
    // single check pins BOTH "no detection query" and "no managed mutation".
    expect(api.mock.calls.some(([q]) => String(q).includes('managed_column'))).toBe(false);
  });
});

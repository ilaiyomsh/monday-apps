// TDD red phase (v2) — src/services/confirm-service.js dynamic buttons.
// resolveButton / configIsComplete are pure; performAction runs over the REAL
// createAppStorage + in-memory backend with a fake api whose ItemState values
// derive from the probe-captured fixtures (tests/fixtures/README.md).
// v2 semantics under test (owner decisions 2026-07-15): per-button status
// column + target label id, NO from-status guard, NO expiry, and
// already-at-target = silent success (no mutation, no update).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveButton, configIsComplete, performAction } from '../src/services/confirm-service.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemAfterFx from './fixtures/get-item-after-transition.probe.json';
import getItemEmptyFx from './fixtures/get-item-empty.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';
import boardColumnsFx from './fixtures/board-columns-settings.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'
const BOARD_ID = getItemFx.data.items[0].board.id; // '18422009734'

// Status labels from the captured settings: id 0 = 'בעבודה', id 1 = 'בוצע'.
const LABELS = boardColumnsFx.data.boards[0].columns[0].settings.labels;
const WORK = LABELS[0]; // { id: 0, label: 'בעבודה' }
const DONE = LABELS[1]; // { id: 1, label: 'בוצע' }

const BTN_DONE = {
  id: 'b_done0001',
  name: DONE.label,
  statusColumnId: STATUS_COL,
  targetIndex: DONE.id, // 1
  targetLabel: DONE.label, // 'בוצע'
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

// targetIndex 0 — deliberately falsy: naive truthiness checks must not break.
const BTN_WORK = {
  id: 'b_work0002',
  name: WORK.label,
  statusColumnId: STATUS_COL,
  targetIndex: WORK.id, // 0
  targetLabel: WORK.label, // 'בעבודה'
  style: { color: '#fdab3d', icon: '', size: 'sm' },
};

const baseConfig = {
  boardId: BOARD_ID,
  peopleColumnId: PEOPLE_COL,
  buttons: [BTN_DONE, BTN_WORK],
  templates: [],
};

/** Derive an ItemState (the monday-api contract shape) from a probe fixture. */
function itemStateFrom(fixture) {
  const item = fixture.data.items[0];
  if (!item) return { found: false };
  const col = (id) => item.column_values.find((c) => c.id === id);
  return {
    found: true,
    boardId: item.board.id,
    statusLabelId: col(STATUS_COL).index ?? null,
    peopleText: col(PEOPLE_COL).text ?? '',
    deadlineDate: null,
  };
}

const workingItem = () => itemStateFrom(getItemFx); // status 0 ('בעבודה'), person set
const doneItem = () => itemStateFrom(getItemAfterFx); // status 1 ('בוצע')
const unsetItem = () => itemStateFrom(getItemEmptyFx); // status null, people ''
const notFoundItem = () => itemStateFrom(getItemNotFoundFx); // { found: false }

// Service-internal error logging (api_error detail, failed update) is allowed;
// keep the test output clean without asserting its shape here.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// resolveButton
// ---------------------------------------------------------------------------

describe('resolveButton', () => {
  it('returns the matching button object when the id exists (not just the first button)', () => {
    expect(resolveButton(baseConfig, 'b_work0002')).toEqual(BTN_WORK);
  });

  it('returns null for an id that is on no button', () => {
    expect(resolveButton(baseConfig, 'b_nope9999')).toBeNull();
  });

  it('returns null for a null config', () => {
    expect(resolveButton(null, 'b_done0001')).toBeNull();
  });

  it('returns null for a config without a buttons array', () => {
    const { buttons: _dropped, ...noButtons } = baseConfig;
    expect(resolveButton(noButtons, 'b_done0001')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// configIsComplete
// ---------------------------------------------------------------------------

/** baseConfig with its buttons replaced by a single (possibly broken) button. */
function configWithButton(button) {
  return { ...baseConfig, buttons: [button] };
}

/** BTN_DONE minus one required field. */
function buttonWithout(key) {
  const btn = { ...BTN_DONE };
  delete btn[key];
  return btn;
}

describe('configIsComplete', () => {
  it('returns true for a full v2 config that includes a targetIndex 0 button (falsy label id is valid)', () => {
    expect(baseConfig.buttons.some((b) => b.targetIndex === 0)).toBe(true); // fixture sanity
    expect(configIsComplete(baseConfig)).toBe(true);
  });

  it('returns true without templates and without button style — neither is required for /confirm', () => {
    const { templates: _dropped, ...noTemplates } = baseConfig;
    const { style: _style, ...styleLess } = BTN_WORK;
    expect(configIsComplete({ ...noTemplates, buttons: [styleLess] })).toBe(true);
  });

  it('returns false for a null config', () => {
    expect(configIsComplete(null)).toBe(false);
  });

  it('returns false when boardId is missing or empty', () => {
    const { boardId: _dropped, ...noBoard } = baseConfig;
    expect(configIsComplete(noBoard)).toBe(false);
    expect(configIsComplete({ ...baseConfig, boardId: '' })).toBe(false);
  });

  it('returns false when buttons is an empty array or missing', () => {
    expect(configIsComplete({ ...baseConfig, buttons: [] })).toBe(false);
    const { buttons: _dropped, ...noButtons } = baseConfig;
    expect(configIsComplete(noButtons)).toBe(false);
  });

  it('returns false when a button is missing id', () => {
    expect(configIsComplete(configWithButton(buttonWithout('id')))).toBe(false);
  });

  it('returns false when a button is missing name', () => {
    expect(configIsComplete(configWithButton(buttonWithout('name')))).toBe(false);
  });

  it('returns false when a button is missing statusColumnId', () => {
    expect(configIsComplete(configWithButton(buttonWithout('statusColumnId')))).toBe(false);
  });

  it('returns false when a button is missing targetLabel', () => {
    expect(configIsComplete(configWithButton(buttonWithout('targetLabel')))).toBe(false);
  });

  it("returns false when targetIndex is the string '1' (label ids are integers)", () => {
    expect(configIsComplete(configWithButton({ ...BTN_DONE, targetIndex: '1' }))).toBe(false);
  });

  it('returns false when a button is missing targetIndex', () => {
    expect(configIsComplete(configWithButton(buttonWithout('targetIndex')))).toBe(false);
  });

  it('returns false when targetIndex is negative', () => {
    expect(configIsComplete(configWithButton({ ...BTN_DONE, targetIndex: -1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// performAction
// ---------------------------------------------------------------------------

function fakeApi({ itemState, getItemError, changeStatusError, createUpdateError } = {}) {
  return {
    getItemState: vi.fn(async () => {
      if (getItemError) throw getItemError;
      return itemState;
    }),
    changeStatus: vi.fn(async () => {
      if (changeStatusError) throw changeStatusError;
    }),
    createUpdate: vi.fn(async () => {
      if (createUpdateError) throw createUpdateError;
    }),
    fetchMe: vi.fn(async () => ({ id: 'unused', name: 'unused' })),
  };
}

function seededStorage(overrides = {}) {
  const seed = { config: baseConfig, oauth_token: 'tok-1', ...overrides };
  for (const key of Object.keys(seed)) {
    if (seed[key] === undefined) delete seed[key];
  }
  // v3: performAction receives an ACCOUNT-SCOPED storage view — seed keys
  // move under the account prefix and the suite hands the service the same
  // scoped object the route would.
  const prefixed = Object.fromEntries(Object.entries(seed).map(([k, v]) => [`777:${k}`, v]));
  return createAppStorage({ backend: createMemoryBackend(prefixed) }).forAccount('777');
}

function expectNoApiCalls(api) {
  expect(api.getItemState).not.toHaveBeenCalled();
  expect(api.changeStatus).not.toHaveBeenCalled();
  expect(api.createUpdate).not.toHaveBeenCalled();
}

describe('performAction — happy path (button b_done0001, item currently at label 0)', () => {
  it("returns { outcome: 'ok' } with the resolved button whose targetLabel is 'בוצע'", async () => {
    const api = fakeApi({ itemState: workingItem() });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('ok');
    expect(result.button).toEqual(BTN_DONE);
    expect(result.button.targetLabel).toBe('בוצע');
  });

  it("queries the item state with the BUTTON's statusColumnId and the config's peopleColumnId", async () => {
    const api = fakeApi({ itemState: workingItem() });

    await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(api.getItemState).toHaveBeenCalledTimes(1);
    expect(api.getItemState.mock.calls[0][0]).toMatchObject({
      token: 'tok-1',
      itemId: ITEM_ID,
      statusColumnId: STATUS_COL,
      peopleColumnId: PEOPLE_COL,
    });
  });

  it("calls changeStatus exactly once with the button's column and targetIndex as toLabelId", async () => {
    const api = fakeApi({ itemState: workingItem() });

    await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 1,
    });
  });

  it('creates the attribution update with body \'סומן "בוצע" במייל על ידי עילי שלם\' (assignee from people text)', async () => {
    const api = fakeApi({ itemState: workingItem() });

    await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'סומן "בוצע" במייל על ידי עילי שלם',
    });
  });

  it('uses the bare body \'סומן "בוצע" במייל\' when the people column text is empty', async () => {
    // Status/board from the populated capture; the empty people text comes
    // from the captured never-set fixture.
    const itemState = { ...workingItem(), peopleText: unsetItem().peopleText };
    const api = fakeApi({ itemState });

    await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'סומן "בוצע" במייל',
    });
  });

  it("drives toward targetIndex 0 (falsy label id): clicking b_work0002 on a 'בוצע' item mutates toLabelId 0", async () => {
    const api = fakeApi({ itemState: doneItem() }); // status 1 → target 0 is a real change

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_WORK.id,
    });

    expect(result.outcome).toBe('ok');
    expect(result.button).toEqual(BTN_WORK);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 0,
    });
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'סומן "בעבודה" במייל על ידי עילי שלם',
    });
  });
});

describe('performAction — per-button column routing (two buttons on DIFFERENT status columns)', () => {
  const OTHER_COL = 'color_2ndcol001';
  const BTN_OTHER = {
    id: 'b_othr0003',
    name: DONE.label,
    statusColumnId: OTHER_COL,
    targetIndex: DONE.id,
    targetLabel: DONE.label,
    style: { color: '#0073ea', icon: '', size: 'md' },
  };
  const twoColumnConfig = { ...baseConfig, buttons: [BTN_DONE, BTN_OTHER] };

  it("clicking button B queries and mutates B's column, never A's", async () => {
    const api = fakeApi({ itemState: workingItem() }); // status 0 ≠ target 1 → proceeds

    const result = await performAction({
      storage: seededStorage({ config: twoColumnConfig }),
      api,
      itemId: ITEM_ID,
      btnId: BTN_OTHER.id,
    });

    expect(result.outcome).toBe('ok');
    expect(api.getItemState).toHaveBeenCalledTimes(1);
    expect(api.getItemState.mock.calls[0][0]).toMatchObject({ statusColumnId: OTHER_COL });
    expect(api.getItemState.mock.calls[0][0].statusColumnId).not.toBe(STATUS_COL);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: OTHER_COL,
      toLabelId: 1,
    });
  });
});

describe('performAction — NO from-status guard (any current status drives toward the target)', () => {
  it("proceeds to 'ok' when the status column was never set (statusLabelId null)", async () => {
    const api = fakeApi({ itemState: unsetItem() });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('ok');
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 1,
    });
  });

  it("proceeds to 'ok' when the item sits on some THIRD label (id 5) that no button mentions", async () => {
    const api = fakeApi({ itemState: { ...workingItem(), statusLabelId: 5 } });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('ok');
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toMatchObject({ toLabelId: 1 });
  });
});

describe('performAction — already_done (idempotent-by-skip, silent success)', () => {
  it("returns 'already_done' with the button and NO mutation, NO update when status already equals targetIndex 1", async () => {
    const api = fakeApi({ itemState: doneItem() }); // status 1 === BTN_DONE.targetIndex

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('already_done');
    expect(result.button).toEqual(BTN_DONE);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("returns 'already_done' for targetIndex 0 when the item is at label 0 (0 === 0 falsy trap)", async () => {
    const api = fakeApi({ itemState: workingItem() }); // status 0 === BTN_WORK.targetIndex

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_WORK.id,
    });

    expect(result.outcome).toBe('already_done');
    expect(result.button).toEqual(BTN_WORK);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });
});

describe("performAction — 'unknown_button' and 'no_config' (ZERO api calls)", () => {
  it("returns 'unknown_button' for a btnId on no configured button, with zero api calls", async () => {
    const api = fakeApi({ itemState: workingItem() });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: 'b_nope9999',
    });

    expect(result.outcome).toBe('unknown_button');
    expectNoApiCalls(api);
  });

  it("returns 'no_config' with zero api calls when the config key is missing", async () => {
    const api = fakeApi({ itemState: workingItem() });
    const storage = seededStorage({ config: undefined });

    const result = await performAction({ storage, api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(result.outcome).toBe('no_config');
    expectNoApiCalls(api);
  });

  it("returns 'no_config' with zero api calls for an INCOMPLETE config (targetIndex stored as string '1')", async () => {
    const api = fakeApi({ itemState: workingItem() });
    const storage = seededStorage({
      config: { ...baseConfig, buttons: [{ ...BTN_DONE, targetIndex: '1' }] },
    });

    const result = await performAction({ storage, api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(result.outcome).toBe('no_config');
    expectNoApiCalls(api);
  });

  it("returns 'no_config' with zero api calls when the oauth token is missing", async () => {
    const api = fakeApi({ itemState: workingItem() });
    const storage = seededStorage({ oauth_token: undefined });

    const result = await performAction({ storage, api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(result.outcome).toBe('no_config');
    expectNoApiCalls(api);
  });
});

describe('performAction — guard propagation and API failures', () => {
  it("returns 'not_found' for a missing item and never mutates", async () => {
    const api = fakeApi({ itemState: notFoundItem() });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('not_found');
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("returns 'wrong_board' when the item's board differs from config.boardId and never mutates", async () => {
    const api = fakeApi({ itemState: { ...workingItem(), boardId: '99999999999' } });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('wrong_board');
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("still returns 'ok' (with the button) when create_update fails AFTER a successful status change", async () => {
    const api = fakeApi({
      itemState: workingItem(),
      createUpdateError: new MondayApiError('update failed', { status: 500 }),
    });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('ok');
    expect(result.button).toEqual(BTN_DONE);
  });

  it("returns 'api_error' when the item query throws MondayApiError; no mutation attempted", async () => {
    const api = fakeApi({
      getItemError: new MondayApiError('Unauthorized', { status: 401, unauthorized: true }),
    });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('api_error');
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("returns 'api_error' when changeStatus throws; no attribution update attempted", async () => {
    const api = fakeApi({
      itemState: workingItem(),
      changeStatusError: new MondayApiError('boom', { status: 500 }),
    });

    const result = await performAction({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      btnId: BTN_DONE.id,
    });

    expect(result.outcome).toBe('api_error');
    expect(api.createUpdate).not.toHaveBeenCalled();
  });
});

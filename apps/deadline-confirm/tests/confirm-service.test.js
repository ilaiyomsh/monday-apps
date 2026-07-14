// TDD red phase — src/services/confirm-service.js (spec §6 steps 5-9).
// evaluateGuards: guard ORDER pinned (a not_found → b wrong_board → c expired
// → d wrong_status) with fixtures where multiple guards would fail.
// performConfirm: real createAppStorage over the in-memory backend, fake api
// whose ItemState values are derived from the probe-captured fixtures.

import { describe, it, expect, vi } from 'vitest';
import { evaluateGuards, performConfirm } from '../src/services/confirm-service.js';
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
const DATE_COL = 'date_mm58ej61';

const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'
const BOARD_ID = getItemFx.data.items[0].board.id; // '18422009734'

// Status labels from the captured settings: id 0 = 'בעבודה', id 1 = 'בוצע'.
const LABELS = boardColumnsFx.data.boards[0].columns[0].settings.labels;
const FROM = LABELS[0]; // { id: 0, label: 'בעבודה' }
const TO = LABELS[1]; // { id: 1, label: 'בוצע' }

/** Derive an ItemState (the monday-api contract shape) from a probe fixture. */
function itemStateFrom(fixture, { withDeadline = false } = {}) {
  const item = fixture.data.items[0];
  if (!item) return { found: false };
  const col = (id) => item.column_values.find((c) => c.id === id);
  return {
    found: true,
    boardId: item.board.id,
    statusLabelId: col(STATUS_COL).index ?? null,
    peopleText: col(PEOPLE_COL).text ?? '',
    deadlineDate: withDeadline ? col(DATE_COL).date || null : null,
  };
}

const okItem = () => itemStateFrom(getItemFx); // status 0, person set, no expiry column read
const okItemWithDeadline = () => itemStateFrom(getItemFx, { withDeadline: true }); // deadline 2026-07-20
const doneItem = () => itemStateFrom(getItemAfterFx); // status 1 (already transitioned)
const doneItemWithDeadline = () => itemStateFrom(getItemAfterFx, { withDeadline: true });
const unsetItem = () => itemStateFrom(getItemEmptyFx); // status null, people ''
const notFoundItem = () => itemStateFrom(getItemNotFoundFx); // { found: false }

const baseConfig = {
  boardId: BOARD_ID,
  statusColumnId: STATUS_COL,
  fromIndex: FROM.id, // 0 — deliberately falsy: naive truthiness checks must not break
  fromLabel: FROM.label,
  toIndex: TO.id,
  toLabel: TO.label,
  peopleColumnId: PEOPLE_COL,
  expiryDateColumnId: null,
  expiryGraceDays: 0,
};
const expiryConfig = { ...baseConfig, expiryDateColumnId: DATE_COL, expiryGraceDays: 2 };

const TODAY = '2026-07-14';
// Fixture deadline is 2026-07-20; grace 2 → last valid day is 2026-07-22.
const ON_GRACE_EDGE = '2026-07-22';
const PAST_GRACE_EDGE = '2026-07-23';

describe('evaluateGuards — single-guard outcomes', () => {
  it("returns { ok: false, outcome: 'not_found' } for a found:false item", () => {
    expect(evaluateGuards(notFoundItem(), baseConfig, TODAY)).toEqual({
      ok: false,
      outcome: 'not_found',
    });
  });

  it("returns 'wrong_board' when the item's board differs from config.boardId", () => {
    const config = { ...baseConfig, boardId: '99999999999' };
    expect(evaluateGuards(okItem(), config, TODAY)).toEqual({ ok: false, outcome: 'wrong_board' });
  });

  it("returns 'wrong_status' when statusLabelId differs from fromIndex (already transitioned)", () => {
    expect(evaluateGuards(doneItem(), baseConfig, TODAY)).toEqual({
      ok: false,
      outcome: 'wrong_status',
    });
  });

  it("returns 'wrong_status' when the status column was never set (statusLabelId null)", () => {
    expect(evaluateGuards(unsetItem(), baseConfig, TODAY)).toEqual({
      ok: false,
      outcome: 'wrong_status',
    });
  });

  it('returns { ok: true } when all guards pass with fromIndex 0', () => {
    expect(evaluateGuards(okItem(), baseConfig, TODAY)).toEqual({ ok: true });
  });
});

describe('evaluateGuards — guard order pinned (spec §6.7 a→d)', () => {
  it("reports 'not_found' even though the board guard would also fail (a beats b)", () => {
    const config = { ...baseConfig, boardId: '99999999999' };
    expect(evaluateGuards(notFoundItem(), config, TODAY)).toEqual({
      ok: false,
      outcome: 'not_found',
    });
  });

  it("reports 'wrong_board' when both board and status guards fail (b beats d)", () => {
    const config = { ...baseConfig, boardId: '99999999999' };
    expect(evaluateGuards(doneItem(), config, TODAY)).toEqual({
      ok: false,
      outcome: 'wrong_board',
    });
  });

  it("reports 'wrong_board' when both board and expiry guards fail (b beats c)", () => {
    const config = { ...expiryConfig, boardId: '99999999999' };
    expect(evaluateGuards(okItemWithDeadline(), config, PAST_GRACE_EDGE)).toEqual({
      ok: false,
      outcome: 'wrong_board',
    });
  });

  it("reports 'expired' when both expiry and status guards fail (c beats d)", () => {
    expect(evaluateGuards(doneItemWithDeadline(), expiryConfig, PAST_GRACE_EDGE)).toEqual({
      ok: false,
      outcome: 'expired',
    });
  });
});

describe('evaluateGuards — expiry boundaries (spec §4/§6.7c, edges exactly ON the line)', () => {
  it('passes when today equals deadline + graceDays exactly (2026-07-20 + 2 → 2026-07-22)', () => {
    expect(evaluateGuards(okItemWithDeadline(), expiryConfig, ON_GRACE_EDGE)).toEqual({ ok: true });
  });

  it("returns 'expired' one day past deadline + graceDays (2026-07-23)", () => {
    expect(evaluateGuards(okItemWithDeadline(), expiryConfig, PAST_GRACE_EDGE)).toEqual({
      ok: false,
      outcome: 'expired',
    });
  });

  it('treats expiryGraceDays 0 as DISABLED — passes even with a long-past deadline', () => {
    const config = { ...baseConfig, expiryDateColumnId: DATE_COL, expiryGraceDays: 0 };
    expect(evaluateGuards(okItemWithDeadline(), config, '2027-01-01')).toEqual({ ok: true });
  });

  it('treats expiryDateColumnId null as DISABLED even with graceDays > 0 and a past deadline', () => {
    const config = { ...baseConfig, expiryDateColumnId: null, expiryGraceDays: 2 };
    expect(evaluateGuards(okItemWithDeadline(), config, '2027-01-01')).toEqual({ ok: true });
  });

  it('never expires an item whose deadline column has no value (deadlineDate null)', () => {
    expect(evaluateGuards(okItem(), expiryConfig, '2027-01-01')).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// performConfirm
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
  return createAppStorage({ backend: createMemoryBackend(seed) });
}

function expectNoApiCalls(api) {
  expect(api.getItemState).not.toHaveBeenCalled();
  expect(api.changeStatus).not.toHaveBeenCalled();
  expect(api.createUpdate).not.toHaveBeenCalled();
}

describe('performConfirm — happy path', () => {
  it("returns { outcome: 'ok', toLabel: 'בוצע' } (toLabel from config)", async () => {
    const api = fakeApi({ itemState: okItem() });

    const result = await performConfirm({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      todayIso: TODAY,
    });

    expect(result).toEqual({ outcome: 'ok', toLabel: TO.label });
  });

  it('queries the item and calls changeStatus with the exact token/board/item/column/toLabelId', async () => {
    const api = fakeApi({ itemState: okItem() });

    await performConfirm({ storage: seededStorage(), api, itemId: ITEM_ID, todayIso: TODAY });

    expect(api.getItemState).toHaveBeenCalledTimes(1);
    expect(api.getItemState.mock.calls[0][0]).toMatchObject({
      token: 'tok-1',
      itemId: ITEM_ID,
      statusColumnId: STATUS_COL,
      peopleColumnId: PEOPLE_COL,
    });
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: TO.id,
    });
  });

  it("creates the attribution update with body 'אושר במייל על ידי עילי שלם' (assignee from people text)", async () => {
    const api = fakeApi({ itemState: okItem() });

    await performConfirm({ storage: seededStorage(), api, itemId: ITEM_ID, todayIso: TODAY });

    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'אושר במייל על ידי עילי שלם',
    });
  });

  it("uses the bare body 'אושר במייל' when the people column text is empty", async () => {
    // Status/board from the populated capture; the empty people text comes
    // from the captured never-set fixture.
    const itemState = { ...okItem(), peopleText: unsetItem().peopleText };
    const api = fakeApi({ itemState });

    await performConfirm({ storage: seededStorage(), api, itemId: ITEM_ID, todayIso: TODAY });

    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'אושר במייל',
    });
  });

  it("still returns 'ok' when create_update fails AFTER a successful status change (spec §6.9)", async () => {
    const api = fakeApi({
      itemState: okItem(),
      createUpdateError: new MondayApiError('update failed', { status: 500 }),
    });

    const result = await performConfirm({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      todayIso: TODAY,
    });

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'ok', toLabel: TO.label });
  });
});

describe("performConfirm — 'no_config' (zero API calls)", () => {
  it("returns 'no_config' and makes zero api calls when the config key is missing", async () => {
    const api = fakeApi({ itemState: okItem() });
    const storage = seededStorage({ config: undefined });

    const result = await performConfirm({ storage, api, itemId: ITEM_ID, todayIso: TODAY });

    expect(result).toEqual({ outcome: 'no_config' });
    expectNoApiCalls(api);
  });

  it("returns 'no_config' and makes zero api calls when config lacks fromIndex", async () => {
    const { fromIndex: _dropped, ...incomplete } = baseConfig;
    const api = fakeApi({ itemState: okItem() });
    const storage = seededStorage({ config: incomplete });

    const result = await performConfirm({ storage, api, itemId: ITEM_ID, todayIso: TODAY });

    expect(result).toEqual({ outcome: 'no_config' });
    expectNoApiCalls(api);
  });

  it("returns 'no_config' and makes zero api calls when the oauth token is missing", async () => {
    const api = fakeApi({ itemState: okItem() });
    const storage = seededStorage({ oauth_token: undefined });

    const result = await performConfirm({ storage, api, itemId: ITEM_ID, todayIso: TODAY });

    expect(result).toEqual({ outcome: 'no_config' });
    expectNoApiCalls(api);
  });
});

describe("performConfirm — 'api_error' and guard propagation", () => {
  it("returns 'api_error' when the item query throws MondayApiError; no mutation attempted", async () => {
    const api = fakeApi({
      getItemError: new MondayApiError('Unauthorized', { status: 401, unauthorized: true }),
    });

    const result = await performConfirm({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      todayIso: TODAY,
    });

    expect(result).toEqual({ outcome: 'api_error' });
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("returns 'api_error' when changeStatus throws; no attribution update attempted", async () => {
    const api = fakeApi({
      itemState: okItem(),
      changeStatusError: new MondayApiError('boom', { status: 500 }),
    });

    const result = await performConfirm({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      todayIso: TODAY,
    });

    expect(result).toEqual({ outcome: 'api_error' });
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it("propagates 'wrong_status' for an already-transitioned item and never mutates", async () => {
    const api = fakeApi({ itemState: doneItem() });

    const result = await performConfirm({
      storage: seededStorage(),
      api,
      itemId: ITEM_ID,
      todayIso: TODAY,
    });

    expect(result).toEqual({ outcome: 'wrong_status' });
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });
});

// test-guard gate for the NEW `audit` field on performAction's success result.
// Contract: the user-facing `outcome` stays 'ok' whether or not the attribution
// update succeeds (the locked /confirm attempt-line contract in
// confirm-service.test.js / confirm-route.test.js is unchanged), but a failed
// create_update is now surfaced on result.audit = 'failed' (vs 'ok' on success)
// so the caller can emit the partial-failure signal without masking it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performAction } from '../src/services/confirm-service.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

import getItemFx from './fixtures/get-item.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id;
const BOARD_ID = getItemFx.data.items[0].board.id;

const BTN_DONE = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: STATUS_COL,
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const baseConfig = {
  boardId: BOARD_ID,
  peopleColumnId: PEOPLE_COL,
  buttons: [BTN_DONE],
  templates: [],
};

// Item currently at label 0 (from the populated capture) → clicking b_done0001
// (target 1) is a real transition that then attempts the attribution update.
const workingItem = {
  found: true,
  boardId: BOARD_ID,
  statusLabelId: 0,
  peopleText: 'עילי שלם',
  deadlineDate: null,
};

function fakeApi({ createUpdateError } = {}) {
  return {
    getItemState: vi.fn(async () => workingItem),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {
      if (createUpdateError) throw createUpdateError;
    }),
    fetchMe: vi.fn(async () => ({ id: 'x', name: 'x' })),
  };
}

function seededStorage() {
  const seed = { '777:config': baseConfig, '777:oauth_token': 'tok-1' };
  return createAppStorage({ backend: createMemoryBackend(seed) }).forAccount('777');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("performAction — audit field surfaces the attribution-update outcome (outcome stays 'ok')", () => {
  it("returns audit:'ok' when the attribution create_update SUCCEEDS", async () => {
    const api = fakeApi();

    const result = await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(result.outcome).toBe('ok'); // locked contract unchanged
    expect(result.audit).toBe('ok');
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
  });

  it("returns audit:'failed' (but outcome STILL 'ok') when create_update throws AFTER the status change", async () => {
    const api = fakeApi({ createUpdateError: new MondayApiError('update failed', { status: 500 }) });

    const result = await performAction({ storage: seededStorage(), api, itemId: ITEM_ID, btnId: BTN_DONE.id });

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('ok'); // status change succeeded — user still sees success
    expect(result.audit).toBe('failed'); // …but the partial failure is surfaced, not masked
    expect(result.button).toEqual(BTN_DONE);
  });
});

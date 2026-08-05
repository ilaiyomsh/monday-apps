// TDD — the reply a SINGLE-ROW submission renders inside the email.
//
// Since 2026-08-04 every row is its own form, so essentially every real POST
// carries exactly one selection and its `message` is read next to that one task.
// The bulk phrasing was built for a batch and misreads there — worst of all
// `phrase(1, …)` produced "משימה אחת היו מעודכנות כבר", plural verb on a
// singular subject, which a per-row digest shows on every already-done row.
//
// The batch wording is NOT dropped: a hand-crafted POST may still carry several
// items, and those replies must keep counting.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemAfterFx from './fixtures/get-item-after-transition.probe.json';
import boardColumnsFx from './fixtures/board-columns-settings.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id;
const ITEM_ID_2 = '12532634010';
const BOARD_ID = getItemFx.data.items[0].board.id;

const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT_ID = '777';
const SENDER = 'deadline@twyst.co.il';
const CLIENT_IP = '203.0.113.9';
const PERSON_ID = String(boardColumnsFx.data.me.id);

const NOW_DATE = new Date('2026-07-28T09:00:00Z');
const NOW = () => NOW_DATE;
const SLOT = currentSlot({ sendHour: 8, now: NOW_DATE });

const BTN_DONE = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: STATUS_COL,
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d' },
};

const CONFIG = {
  boardId: BOARD_ID,
  peopleColumnId: PEOPLE_COL,
  buttons: [BTN_DONE],
  digest: null,
};

const ENV = {
  clientId: 'ci',
  clientSecret: 'cs',
  allowedAccountIds: [],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [SENDER],
};

function itemStateFrom(fixture) {
  const item = fixture.data.items[0];
  const col = (id) => item.column_values.find((c) => c.id === id);
  const peopleText = col(PEOPLE_COL).text ?? '';
  return {
    found: true,
    boardId: item.board.id,
    statusLabelId: col(STATUS_COL).index ?? null,
    peopleText,
    peoplePersonIds: peopleText ? [PERSON_ID] : [],
    deadlineDate: null,
  };
}
const workingItem = () => itemStateFrom(getItemFx); // status 0 → a real transition
const doneItem = () => itemStateFrom(getItemAfterFx); // status 1 → already_done

function buildApp({ itemStates = { [ITEM_ID]: workingItem() } } = {}) {
  const backend = createMemoryBackend({
    [`${ACCOUNT_ID}:oauth_token`]: 'tok-1',
    [`${ACCOUNT_ID}:config`]: CONFIG,
    [`${ACCOUNT_ID}:link_secret`]: SECRET,
  });
  const storage = createAppStorage({ backend });
  const api = {
    getItemState: vi.fn(async ({ itemId }) => itemStates[itemId] ?? { found: false }),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
    fetchMe: vi.fn(async () => ({ id: 'x', name: 'x' })),
  };
  return {
    app: createApp({
      storage,
      api,
      rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
      env: ENV,
      now: NOW,
    }),
    api,
  };
}

function postRow(app, pairs) {
  const m = buildManifest(pairs);
  const sig = signManifest({
    secret: SECRET,
    accountId: ACCOUNT_ID,
    personId: PERSON_ID,
    slot: SLOT,
    manifest: m,
  });
  const body = {
    a: ACCOUNT_ID,
    p: PERSON_ID,
    s: SLOT,
    sig,
    m,
    ...Object.fromEntries(pairs.map(({ itemId, btnId }) => [`item_${itemId}`, btnId])),
  };
  return request(app)
    .post('/amp/confirm')
    .set('AMP-Email-Sender', SENDER)
    .set('X-Forwarded-For', CLIENT_IP)
    .type('form')
    .send(body);
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /amp/confirm — the reply of a one-row submission', () => {
  it('confirms a single updated task without counting it', async () => {
    const { app } = buildApp();
    const res = await postRow(app, [{ itemId: ITEM_ID, btnId: BTN_DONE.id }]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(1);
    expect(res.body.message).toBe('עודכן');
  });

  it('says an already-done task was already updated, in the singular', async () => {
    const { app } = buildApp({ itemStates: { [ITEM_ID]: doneItem() } });
    const res = await postRow(app, [{ itemId: ITEM_ID, btnId: BTN_DONE.id }]);

    expect(res.status).toBe(200);
    expect(res.body.already).toBe(1);
    expect(res.body.message).toBe('היה מעודכן כבר');
    // The plural verb on a singular subject was the actual defect.
    expect(res.body.message).not.toContain('היו');
  });

  it('keeps the counting phrasing when a body really carries several items', async () => {
    const { app } = buildApp({
      itemStates: { [ITEM_ID]: workingItem(), [ITEM_ID_2]: workingItem() },
    });
    const res = await postRow(app, [
      { itemId: ITEM_ID, btnId: BTN_DONE.id },
      { itemId: ITEM_ID_2, btnId: BTN_DONE.id },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.message).toBe('עודכנו 2 משימות');
  });

  // A MIXED batch is what actually pins the "one row only" condition: with two
  // tasks of the same outcome the counting path is reached anyway, by
  // fall-through. Here one was written and one was already done, so a reply that
  // collapsed to the single-row wording would hide half of what happened.
  it('counts both outcomes when a batch is mixed — never collapses to one line', async () => {
    const { app } = buildApp({
      itemStates: { [ITEM_ID]: workingItem(), [ITEM_ID_2]: doneItem() },
    });
    const res = await postRow(app, [
      { itemId: ITEM_ID, btnId: BTN_DONE.id },
      { itemId: ITEM_ID_2, btnId: BTN_DONE.id },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.already).toBe(1);
    expect(res.body.message).toContain('עודכנה משימה אחת');
    expect(res.body.message).toContain('מעודכנות כבר');
    expect(res.body.message).not.toBe('עודכן');
  });

  // A row that failed must still land in the error template, not silently read
  // as success — the reader has no other signal that nothing was written.
  it('answers 502 with the generic failure line when the single row fails', async () => {
    const { app } = buildApp();
    // Signed, in-manifest, but no such button in the config → the write cannot
    // be performed.
    const res = await postRow(app, [{ itemId: ITEM_ID, btnId: 'b_nosuchbtn' }]);

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.failed).toBe(1);
    expect(res.body.message).toMatch(/^\[E10\]/);
  });
});

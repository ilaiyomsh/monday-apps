// test-guard gate for the POST /confirm usage-signal refinement: when the status
// change succeeds but the attribution create_update fails, the ATTEMPT line stays
// 'ok' (locked contract) while the usage track() signal reports 'ok_no_audit'.
// Full pipeline via createApp + supertest; the monday api is a fake whose
// createUpdate can be made to throw.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

import getItemFx from './fixtures/get-item.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id;
const BOARD_ID = getItemFx.data.items[0].board.id;
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT_ID = '777';

const ENV = { clientId: 'ci', clientSecret: 'cs', allowedAccountIds: [], baseUrl: 'https://app.example' };
const BTN_DONE = {
  id: 'b_done0001', name: 'בוצע', statusColumnId: STATUS_COL,
  targetIndex: 1, targetLabel: 'בוצע', style: { color: '#00854d', icon: '✓', size: 'md' },
};
const V2_CONFIG = { boardId: BOARD_ID, peopleColumnId: PEOPLE_COL, buttons: [BTN_DONE], templates: [] };

// Item at label 0 → clicking target-1 is a real transition, then attribution update.
const workingItem = { found: true, boardId: BOARD_ID, statusLabelId: 0, peopleText: 'עילי שלם', deadlineDate: null };

function buildApp({ createUpdateError } = {}) {
  const backend = createMemoryBackend({
    [`${ACCOUNT_ID}:config`]: V2_CONFIG,
    [`${ACCOUNT_ID}:link_secret`]: SECRET,
    [`${ACCOUNT_ID}:oauth_token`]: 'tok-1',
  });
  const storage = createAppStorage({ backend });
  const api = {
    getItemState: vi.fn(async () => workingItem),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {
      if (createUpdateError) throw createUpdateError;
    }),
    fetchMe: vi.fn(async () => ({ id: 'x', name: 'x' })),
  };
  return { app: createApp({ storage, api, rateLimiter: { allow: () => true }, env: ENV }), api };
}

let logSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const jsonLines = () =>
  logSpy.mock.calls
    .map((a) => a.map(String).join(' '))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const attemptLine = () => jsonLines().find((e) => 'outcome' in e && 'itemId' in e);
const usageLine = () => jsonLines().find((e) => e.tag === 'usage');

const post = (app) =>
  request(app).post('/confirm').type('form').send({ itemId: ITEM_ID, k: SECRET, btn: BTN_DONE.id, a: ACCOUNT_ID });

describe('POST /confirm — usage signal reflects attribution failure without touching the attempt line', () => {
  it("attribution SUCCESS: attempt outcome 'ok' AND usage signal outcome=ok", async () => {
    const { app } = buildApp();

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(attemptLine().outcome).toBe('ok');
    expect(usageLine().message).toBe('confirm method=POST outcome=ok');
  });

  it("attribution FAILURE: attempt outcome STAYS 'ok', but usage signal outcome=ok_no_audit", async () => {
    const { app } = buildApp({ createUpdateError: new MondayApiError('update failed', { status: 500 }) });

    const res = await post(app);

    expect(res.status).toBe(200);
    // locked /confirm attempt-line contract is untouched:
    expect(attemptLine().outcome).toBe('ok');
    // …the partial failure surfaces ONLY in the usage/health signal:
    expect(usageLine().message).toBe('confirm method=POST outcome=ok_no_audit');
  });
});

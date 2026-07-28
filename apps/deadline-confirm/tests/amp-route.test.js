// TDD red phase (V6) — POST/OPTIONS /amp/confirm, the Gmail dynamic-email
// endpoint, now the app's ONLY public write path.
//
// V6 replaces the V5 static-secret wire format (`k` + `btn` + `item[]`) with a
// SIGNED MANIFEST: each digest message carries a canonical manifest of exactly
// the (item, button) pairs it displays, HMAC-signed together with the account,
// the recipient person and the send slot. Verification order is a security
// contract (spec §3 "Verification order — security contract") — every gate has
// a test that pins WHERE in the order it runs, not just THAT it runs:
//
//   1. AMP CORS sender gate (unchanged from V5) — pure header work, rejection
//      carries NO CORS headers and touches NO storage.
//   2. rate-limit bucket A: perIp.allow(<bare client ip>) — 429 BEFORE any
//      storage read and BEFORE field validation.
//   3. parse a/p/s/sig/m — regex → 400 bad_fields; non-canonical m → 400
//      bad_manifest. Each failure carries a distinct `[E…]` Hebrew message.
//   4. load link_secret via storage.forAccount(a) — missing → 403 no_config.
//   5. slot check: s === currentSlot({ sendHour }) — NO grace for the previous
//      slot; sendHour comes from config.digest.sendHour (default 8) → 403 bad_slot.
//   6. signature over `${a}|${p}|${s}|${m}` — verified BEFORE selections are
//      even parsed (a bad_sig masks a would-be-400 selections error).
//   7. selections: item_<id>=<btnId> fields — every pair must be inside the
//      verified manifest (else 403 manifest_violation), all-or-nothing.
//   8. any 3-7 failure → ZERO monday API calls.
//   9. rate-limit bucket B: perAccount.allow(`${a}:${ip}`) — only AFTER
//      verification → 429 rate_limited_account (distinct from bucket A's
//      rate_limited; an unauthenticated caller cannot drain an account bucket).
//  10. execution: one performAction per selection with expectedPersonId = p.
//
// Manifests and signatures are built with the REAL (pure, already-tested)
// manifest-signature module, so the suite pins the route against the same
// crypto the sender uses. Time is injected (`now`) so slot math is
// deterministic. monday-facing doubles derive from the probe fixtures
// (tests/fixtures/README.md).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemAfterFx from './fixtures/get-item-after-transition.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';
import boardColumnsFx from './fixtures/board-columns-settings.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'
const BOARD_ID = getItemFx.data.items[0].board.id; // '18422009734'
const ITEM_ID_2 = '12532634010'; // second task in the same digest section

const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const OTHER_SECRET = 'a-completely-different-account-link-secret-000';
const ACCOUNT_ID = '777';
const SENDER = 'deadline@twyst.co.il';
const GMAIL_ORIGIN = 'https://mail.google.com';
const CLIENT_IP = '203.0.113.9';

// The recipient — the captured assignee's person id (see confirm-service.test.js).
const PERSON_ID = String(boardColumnsFx.data.me.id); // '48274917'

// Fixed clock: 2026-07-28T09:00:00Z = 12:00 Asia/Jerusalem (IDT). With the
// default sendHour 8 the current slot is TODAY, 20260728.
const NOW_DATE = new Date('2026-07-28T09:00:00Z');
const NOW = () => NOW_DATE;
const SLOT = currentSlot({ sendHour: 8, now: NOW_DATE }); // '20260728'
// 12:00 is before a 15:00 send → still yesterday's slot. Doubles as the
// "previous slot" date for the no-grace pin.
const PREV_SLOT = currentSlot({ sendHour: 15, now: NOW_DATE }); // '20260727'

const BTN_DONE = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: STATUS_COL,
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const BTN_WORK = {
  id: 'b_work0002',
  name: 'בעבודה',
  statusColumnId: STATUS_COL,
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#fdab3d', icon: '', size: 'sm' },
};

const CONFIG = {
  boardId: BOARD_ID,
  peopleColumnId: PEOPLE_COL,
  buttons: [BTN_DONE, BTN_WORK],
  digest: null, // no digest config → sendHour defaults to 8
};

const ENV = {
  clientId: 'ci',
  clientSecret: 'cs',
  allowedAccountIds: [],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [SENDER],
};

/** Derive an ItemState double (monday-api contract shape) from a probe fixture. */
function itemStateFrom(fixture) {
  const item = fixture.data.items[0];
  if (!item) return { found: false };
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

const workingItem = () => itemStateFrom(getItemFx); // status 0, assignee 48274917
const doneItem = () => itemStateFrom(getItemAfterFx); // status 1, assignee 48274917
const notFoundItem = () => itemStateFrom(getItemNotFoundFx); // { found: false }

function buildApp({
  config = CONFIG,
  secret = SECRET,
  perIpAllow = true,
  perAccountAllow = true,
  env = ENV,
  itemStates = { [ITEM_ID]: workingItem(), [ITEM_ID_2]: workingItem() },
  now = NOW,
} = {}) {
  const seed = { [`${ACCOUNT_ID}:oauth_token`]: 'tok-1' };
  if (config !== undefined) seed[`${ACCOUNT_ID}:config`] = config;
  if (secret !== null) seed[`${ACCOUNT_ID}:link_secret`] = secret;
  const inner = createMemoryBackend(seed);
  let backendGets = 0;
  const backend = {
    get: async (key) => {
      backendGets += 1;
      return inner.get(key);
    },
    set: (key, value) => inner.set(key, value),
    delete: (key) => inner.delete(key),
  };
  const storage = createAppStorage({ backend });
  const api = {
    getItemState: vi.fn(async ({ itemId }) => itemStates[itemId] ?? { found: false }),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
    fetchMe: vi.fn(async () => ({ id: 'x', name: 'x' })),
  };
  const perIp = { allow: vi.fn(() => perIpAllow) };
  const perAccount = { allow: vi.fn(() => perAccountAllow) };
  return {
    app: createApp({ storage, api, rateLimiters: { perIp, perAccount }, env, now }),
    api,
    perIp,
    perAccount,
    gets: () => backendGets,
  };
}

/**
 * Build a V6 wire body: a, p, s, sig, m + one item_<id>=<btnId> selection per
 * pair. Any part can be overridden to tamper with exactly one thing.
 */
function signedBody({
  a = ACCOUNT_ID,
  p = PERSON_ID,
  slot = SLOT,
  pairs = [{ itemId: ITEM_ID, btnId: BTN_DONE.id }],
  manifest,
  secret = SECRET,
  sig,
  selections,
} = {}) {
  const m = manifest ?? buildManifest(pairs);
  const signature = sig ?? signManifest({ secret, accountId: a, personId: p, slot, manifest: m });
  const sel =
    selections ?? Object.fromEntries(pairs.map(({ itemId, btnId }) => [`item_${itemId}`, btnId]));
  return { a, p, s: slot, sig: signature, m, ...sel };
}

/** urlencoded serializer that supports REPEATED field names (entry list input). */
function encodeForm(entries) {
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** POST as Gmail's CORS v2 client (AMP-Email-Sender) unless overridden. */
function postAmp(app, body, { sender = SENDER, origin, sourceOrigin } = {}) {
  let req = request(app).post(
    sourceOrigin ? `/amp/confirm?__amp_source_origin=${sourceOrigin}` : '/amp/confirm'
  );
  if (sender) req = req.set('AMP-Email-Sender', sender);
  if (origin) req = req.set('Origin', origin);
  req = req.set('X-Forwarded-For', CLIENT_IP); // trust proxy → req.ip === CLIENT_IP
  const payload = typeof body === 'string' ? body : encodeForm(Object.entries(body));
  return req.type('form').send(payload);
}

function expectNoApiCalls(api) {
  expect(api.getItemState).not.toHaveBeenCalled();
  expect(api.changeStatus).not.toHaveBeenCalled();
  expect(api.createUpdate).not.toHaveBeenCalled();
}

let logSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const call of logSpy.mock.calls) {
    expect(call.map(String).join(' ')).not.toContain(SECRET);
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Slot sanity — the fixed clock must mean what the comments claim.
// ---------------------------------------------------------------------------

describe('slot fixtures (sanity)', () => {
  it('the fixed clock (12:00 Jerusalem) yields slot 20260728 at sendHour 8 and 20260727 at sendHour 15', () => {
    expect(SLOT).toBe('20260728');
    expect(PREV_SLOT).toBe('20260727');
  });
});

// ---------------------------------------------------------------------------
// Gate 1 — AMP CORS sender gate (unchanged V5 semantics)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 1: the CORS sender gate runs before anything else', () => {
  it('rejects an unlisted sender with 403 sender_not_allowed [E1b], NO CORS headers, no storage read and no API call', async () => {
    const { app, api, gets } = buildApp();
    const res = await postAmp(app, signedBody(), { sender: 'attacker@evil.example' });

    expect(res.status).toBe(403);
    expect(res.headers['amp-email-allow-sender']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body.error).toBe('sender_not_allowed');
    expect(res.body.message).toMatch(/^\[E1b\]/);
    expect(gets()).toBe(0);
    expectNoApiCalls(api);
  });

  it('rejects a request carrying neither CORS mechanism with error no_amp_headers [E1d] and no storage read', async () => {
    const { app, gets } = buildApp();
    const res = await postAmp(app, signedBody(), { sender: null });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_amp_headers');
    expect(res.body.message).toMatch(/^\[E1d\]/);
    expect(gets()).toBe(0);
  });

  it('rejects EVERY sender while the allowlist is empty (default deny) with not_configured [E1a]', async () => {
    const { app, gets } = buildApp({ env: { ...ENV, ampAllowedSenders: [] } });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_configured');
    expect(res.body.message).toMatch(/^\[E1a\]/);
    expect(gets()).toBe(0);
  });

  it('answers a valid v1 request (Origin + __amp_source_origin) with all three legacy headers', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody(), {
      sender: null,
      origin: GMAIL_ORIGIN,
      sourceOrigin: SENDER,
    });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(GMAIL_ORIGIN);
    expect(res.headers['amp-access-control-allow-source-origin']).toBe(SENDER);
    expect(res.headers['access-control-expose-headers']).toBe(
      'AMP-Access-Control-Allow-Source-Origin'
    );
  });
});

describe('OPTIONS /amp/confirm — preflight under the same sender gate', () => {
  it("answers an allowed sender's preflight 200 with Access-Control-Allow-Methods 'POST, OPTIONS'", async () => {
    const { app } = buildApp();
    const res = await request(app).options('/amp/confirm').set('AMP-Email-Sender', SENDER);

    expect(res.status).toBe(200);
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
    expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
  });

  it("refuses an unlisted sender's preflight with 403 and no CORS headers", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .options('/amp/confirm')
      .set('AMP-Email-Sender', 'attacker@evil.example');

    expect(res.status).toBe(403);
    expect(res.headers['amp-email-allow-sender']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — rate-limit bucket A (per-IP, pre-everything)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 2: per-IP bucket A runs before storage and validation', () => {
  it('answers 429 rate_limited [E2] with ZERO storage reads and ZERO API calls when bucket A is empty', async () => {
    const { app, api, gets, perAccount } = buildApp({ perIpAllow: false });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.body.message).toMatch(/^\[E2\]/);
    expect(gets()).toBe(0);
    expectNoApiCalls(api);
    expect(perAccount.allow).not.toHaveBeenCalled();
  });

  it('keys bucket A by the BARE client ip (no account prefix)', async () => {
    const { app, perIp } = buildApp();
    await postAmp(app, signedBody());

    expect(perIp.allow).toHaveBeenCalledTimes(1);
    expect(perIp.allow).toHaveBeenCalledWith(CLIENT_IP);
  });

  it('answers 429 (not 400) for a completely malformed body when bucket A is empty', async () => {
    const { app } = buildApp({ perIpAllow: false });
    const res = await postAmp(app, { garbage: 'yes' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — field parsing (a, p, s, sig, m) → 400 bad_fields / bad_manifest
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 3: field validation answers 400 with distinct codes and zero API calls', () => {
  async function expectGate3(body, { error, tag }) {
    const { app, api } = buildApp();
    const res = await postAmp(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(res.body.message).toMatch(new RegExp(`^\\[${tag}\\]`));
    expectNoApiCalls(api);
    return res;
  }

  it('rejects a missing sig with bad_fields [E3a]', async () => {
    const body = signedBody();
    delete body.sig;
    await expectGate3(body, { error: 'bad_fields', tag: 'E3a' });
  });

  it('rejects a missing manifest (m) with bad_fields [E3a]', async () => {
    const body = signedBody();
    delete body.m;
    await expectGate3(body, { error: 'bad_fields', tag: 'E3a' });
  });

  it('rejects a non-numeric account id (a) with bad_fields [E3a]', async () => {
    await expectGate3({ ...signedBody(), a: '77x' }, { error: 'bad_fields', tag: 'E3a' });
  });

  it('rejects a non-numeric person id (p) with bad_fields [E3a]', async () => {
    await expectGate3({ ...signedBody(), p: 'me' }, { error: 'bad_fields', tag: 'E3a' });
  });

  it('rejects a slot that is not exactly 8 digits with bad_fields [E3a]', async () => {
    await expectGate3({ ...signedBody(), s: '2026-07-28' }, { error: 'bad_fields', tag: 'E3a' });
  });

  it('rejects a NON-CANONICAL manifest (descending items) with bad_manifest [E3b]', async () => {
    const m = `${ITEM_ID_2}:${BTN_DONE.id};${ITEM_ID}:${BTN_DONE.id}`;
    await expectGate3(signedBody({ manifest: m }), { error: 'bad_manifest', tag: 'E3b' });
  });

  it('rejects a manifest with a duplicate button id on one item with bad_manifest [E3b]', async () => {
    const m = `${ITEM_ID}:${BTN_DONE.id},${BTN_DONE.id}`;
    await expectGate3(signedBody({ manifest: m }), { error: 'bad_manifest', tag: 'E3b' });
  });

  it('rejects a manifest containing spaces with bad_manifest [E3b]', async () => {
    const m = `${ITEM_ID}: ${BTN_DONE.id}`;
    await expectGate3(signedBody({ manifest: m }), { error: 'bad_manifest', tag: 'E3b' });
  });

  it('rejects a manifest of 51 items with bad_manifest [E3b] even when the signature over it is valid', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => String(10000001 + i));
    const m = ids.map((id) => `${id}:${BTN_DONE.id}`).join(';');
    const selections = Object.fromEntries(ids.map((id) => [`item_${id}`, BTN_DONE.id]));
    await expectGate3(signedBody({ manifest: m, selections }), { error: 'bad_manifest', tag: 'E3b' });
  });
});

// ---------------------------------------------------------------------------
// Gate 4 — link_secret lookup
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 4: missing account link_secret', () => {
  it('answers 403 no_config [E4] with zero API calls when the account has no stored link_secret', async () => {
    const { app, api } = buildApp({ secret: null });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_config');
    expect(res.body.message).toMatch(/^\[E4\]/);
    expectNoApiCalls(api);
  });
});

// ---------------------------------------------------------------------------
// Gate 5 — slot check (no grace window, per-account sendHour)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 5: slot must equal currentSlot for the account sendHour', () => {
  it("rejects YESTERDAY's slot with 403 bad_slot [E5] even when validly signed (no grace window)", async () => {
    const { app, api } = buildApp(); // digest null → sendHour 8, current slot = SLOT (today)
    const res = await postAmp(app, signedBody({ slot: PREV_SLOT }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_slot');
    expect(res.body.message).toMatch(/^\[E5\]/);
    expectNoApiCalls(api);
  });

  it('accepts the current slot when config.digest is null (sendHour defaults to 8)', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody({ slot: SLOT }));

    expect(res.status).toBe(200);
  });

  it("honors digest.sendHour 15: at 10:00 Jerusalem TODAY's slot is rejected 403 bad_slot [E5]", async () => {
    // 2026-07-28T07:00:00Z = 10:00 Jerusalem, before the 15:00 send →
    // currentSlot is YESTERDAY (20260727); a "today" slot must not pass.
    const at10 = new Date('2026-07-28T07:00:00Z');
    const { app, api } = buildApp({
      config: { ...CONFIG, digest: { sendHour: 15 } },
      now: () => at10,
    });
    const res = await postAmp(app, signedBody({ slot: '20260728' }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_slot');
    expect(res.body.message).toMatch(/^\[E5\]/);
    expectNoApiCalls(api);
  });

  it("honors digest.sendHour 15: at 10:00 Jerusalem YESTERDAY's slot proceeds to 200", async () => {
    const at10 = new Date('2026-07-28T07:00:00Z');
    const { app } = buildApp({
      config: { ...CONFIG, digest: { sendHour: 15 } },
      now: () => at10,
    });
    const slot = currentSlot({ sendHour: 15, now: at10 }); // '20260727'
    expect(slot).toBe('20260727'); // sanity: the clock means what we claim
    const res = await postAmp(app, signedBody({ slot }));

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Gate 6 — signature verification (before selections)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 6: HMAC signature over a|p|s|m', () => {
  it('rejects a manifest tampered AFTER signing (item appended) with 403 bad_sig [E6] and zero API calls', async () => {
    const { app, api } = buildApp();
    const signedM = buildManifest([{ itemId: ITEM_ID, btnId: BTN_DONE.id }]);
    const sig = signManifest({
      secret: SECRET,
      accountId: ACCOUNT_ID,
      personId: PERSON_ID,
      slot: SLOT,
      manifest: signedM,
    });
    // Canonical (so it passes parse), but NOT what was signed.
    const tamperedM = buildManifest([
      { itemId: ITEM_ID, btnId: BTN_DONE.id },
      { itemId: ITEM_ID_2, btnId: BTN_DONE.id },
    ]);
    const res = await postAmp(app, signedBody({ manifest: tamperedM, sig }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_sig');
    expect(res.body.message).toMatch(/^\[E6\]/);
    expectNoApiCalls(api);
  });

  it('rejects a tampered person id (signed for one person, sent as another) with 403 bad_sig [E6]', async () => {
    const { app, api } = buildApp();
    const body = signedBody(); // signed for PERSON_ID
    const res = await postAmp(app, { ...body, p: '999999' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_sig');
    expect(res.body.message).toMatch(/^\[E6\]/);
    expectNoApiCalls(api);
  });

  it("rejects a signature produced with ANOTHER account's secret with 403 bad_sig [E6]", async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, signedBody({ secret: OTHER_SECRET }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_sig');
    expect(res.body.message).toMatch(/^\[E6\]/);
    expectNoApiCalls(api);
  });

  it('ORDER pin: a bad_sig masks a would-be-400 selections error — 403 bad_sig, not 400', async () => {
    // The duplicated item_ field with two DIFFERENT btn values is a 400
    // conflict_item under gate 7 — but the signature is checked FIRST, so the
    // response must be 403 bad_sig and selections must never be parsed.
    const { app, api, perAccount } = buildApp();
    const base = signedBody({ selections: {} });
    const raw = encodeForm([
      ['a', base.a],
      ['p', base.p],
      ['s', base.s],
      ['sig', 'bogus-signature'],
      ['m', base.m],
      [`item_${ITEM_ID}`, BTN_DONE.id],
      [`item_${ITEM_ID}`, BTN_WORK.id],
    ]);
    const res = await postAmp(app, raw);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_sig');
    expect(res.body.message).toMatch(/^\[E6\]/);
    expectNoApiCalls(api);
    expect(perAccount.allow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Gate 7 — selections parsing (only after a valid signature)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 7: selections against the verified manifest', () => {
  it('answers 400 no_items [E7a] when the body carries zero item_ fields', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, signedBody({ selections: {} }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_items');
    expect(res.body.message).toMatch(/^\[E7a\]/);
    expectNoApiCalls(api);
  });

  it('skips empty select values (no-change) and answers 400 no_items [E7a] when every item_ is empty', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, signedBody({ selections: { [`item_${ITEM_ID}`]: '' } }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_items');
    expect(res.body.message).toMatch(/^\[E7a\]/);
    expectNoApiCalls(api);
  });

  it('applies only non-empty selections when some selects are left on the empty option', async () => {
    const { app, api } = buildApp({
      itemStates: { [ITEM_ID]: workingItem(), [ITEM_ID_2]: workingItem() },
    });
    const body = signedBody({
      pairs: [
        { itemId: ITEM_ID, btnId: BTN_DONE.id },
        { itemId: ITEM_ID_2, btnId: BTN_DONE.id },
      ],
      selections: {
        [`item_${ITEM_ID}`]: BTN_DONE.id,
        [`item_${ITEM_ID_2}`]: '',
      },
    });
    const res = await postAmp(app, body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ITEM_ID, toLabelId: BTN_DONE.targetIndex })
    );
  });

  it('answers 400 too_many_items [E7c] for more than 50 selections', async () => {
    const { app, api } = buildApp();
    const selections = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`item_${60000001 + i}`, BTN_DONE.id])
    );
    const res = await postAmp(app, signedBody({ selections }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_many_items');
    expect(res.body.message).toMatch(/^\[E7c\]/);
    expectNoApiCalls(api);
  });

  it('answers 400 conflict_item [E7b] when the same item_ field carries two DIFFERENT btn values', async () => {
    const { app, api } = buildApp();
    const base = signedBody({
      pairs: [
        { itemId: ITEM_ID, btnId: BTN_DONE.id },
        { itemId: ITEM_ID, btnId: BTN_WORK.id },
      ],
      selections: {},
    });
    const raw = encodeForm([
      ['a', base.a],
      ['p', base.p],
      ['s', base.s],
      ['sig', base.sig],
      ['m', base.m],
      [`item_${ITEM_ID}`, BTN_DONE.id],
      [`item_${ITEM_ID}`, BTN_WORK.id],
    ]);
    const res = await postAmp(app, raw);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('conflict_item');
    expect(res.body.message).toMatch(/^\[E7b\]/);
    expectNoApiCalls(api);
  });

  it('collapses duplicate IDENTICAL (item, btn) pairs silently into ONE performAction call', async () => {
    const { app, api } = buildApp();
    const base = signedBody({ selections: {} });
    const raw = encodeForm([
      ['a', base.a],
      ['p', base.p],
      ['s', base.s],
      ['sig', base.sig],
      ['m', base.m],
      [`item_${ITEM_ID}`, BTN_DONE.id],
      [`item_${ITEM_ID}`, BTN_DONE.id],
    ]);
    const res = await postAmp(app, raw);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(api.getItemState).toHaveBeenCalledTimes(1);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects a selection whose itemId is NOT in the manifest with 403 manifest_violation [E8] and ZERO API calls, even when its batch-mate is valid', async () => {
    const { app, api } = buildApp();
    const body = signedBody(); // manifest covers ITEM_ID only
    const res = await postAmp(app, { ...body, item_999999: BTN_DONE.id });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('manifest_violation');
    expect(res.body.message).toMatch(/^\[E8\]/);
    expectNoApiCalls(api); // all-or-nothing: the VALID selection is not executed either
  });

  it('rejects a selection naming a btnId not offered for that item in the manifest with 403 manifest_violation [E8] and zero API calls', async () => {
    const { app, api } = buildApp();
    // Manifest offers only BTN_DONE for ITEM_ID; the selection picks BTN_WORK.
    const body = signedBody({ selections: { [`item_${ITEM_ID}`]: BTN_WORK.id } });
    const res = await postAmp(app, body);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('manifest_violation');
    expect(res.body.message).toMatch(/^\[E8\]/);
    expectNoApiCalls(api);
  });

  it('ignores field names that do not match item_<digits> (no error, valid selections proceed)', async () => {
    const { app, api } = buildApp();
    const body = { ...signedBody(), foo: 'bar', item_abc: 'zzz' };
    const res = await postAmp(app, body);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Gate 9 — rate-limit bucket B (per account+ip, post-verification)
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 9: per-account bucket B runs only after verification', () => {
  it('keys bucket B as `${accountId}:${ip}` exactly', async () => {
    const { app, perAccount } = buildApp();
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(200);
    expect(perAccount.allow).toHaveBeenCalledTimes(1);
    expect(perAccount.allow).toHaveBeenCalledWith(`${ACCOUNT_ID}:${CLIENT_IP}`);
  });

  it('never consults bucket B for a request whose signature is invalid', async () => {
    const { app, perAccount } = buildApp();
    const res = await postAmp(app, signedBody({ sig: 'not-a-valid-signature' }));

    expect(res.status).toBe(403);
    expect(perAccount.allow).not.toHaveBeenCalled();
  });

  it('answers 429 rate_limited_account [E9] with zero API calls when bucket B is empty (after a VALID signature)', async () => {
    const { app, api } = buildApp({ perAccountAllow: false });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited_account');
    expect(res.body.message).toMatch(/^\[E9\]/);
    expectNoApiCalls(api);
  });
});

// ---------------------------------------------------------------------------
// Gate 10 — execution + response shape
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — gate 10: execution and response', () => {
  const TWO_PAIRS = [
    { itemId: ITEM_ID, btnId: BTN_DONE.id },
    { itemId: ITEM_ID_2, btnId: BTN_DONE.id },
  ];

  it('updates every selection and answers 200 { ok:true, updated:2, already:0, failed:0 } with a Hebrew message', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, signedBody({ pairs: TWO_PAIRS }));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(2);
    expect(res.body.already).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.message).toMatch(/[\u0590-\u05FF]/);
    expect(api.changeStatus).toHaveBeenCalledTimes(2);
    expect(api.createUpdate).toHaveBeenCalledTimes(2);
  });

  it('accepts a JSON body as well as urlencoded', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/amp/confirm')
      .set('AMP-Email-Sender', SENDER)
      .set('X-Forwarded-For', CLIENT_IP)
      .send(signedBody()); // superagent defaults to application/json

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
  });

  it("routes each selection through ITS OWN button: item1→b_done (toLabelId 1), item2→b_work (toLabelId 0)", async () => {
    const { app, api } = buildApp({
      // item2 currently at label 1 so BTN_WORK's target 0 is a real change
      itemStates: { [ITEM_ID]: workingItem(), [ITEM_ID_2]: doneItem() },
    });
    const res = await postAmp(
      app,
      signedBody({
        pairs: [
          { itemId: ITEM_ID, btnId: BTN_DONE.id },
          { itemId: ITEM_ID_2, btnId: BTN_WORK.id },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(api.changeStatus).toHaveBeenCalledTimes(2);
    const calls = api.changeStatus.mock.calls.map(([arg]) => arg);
    expect(calls).toContainEqual(
      expect.objectContaining({ itemId: ITEM_ID, columnId: STATUS_COL, toLabelId: 1 })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ itemId: ITEM_ID_2, columnId: STATUS_COL, toLabelId: 0 })
    );
  });

  it('counts an already-at-target item into `already` with no write: 200 { ok:true, already:1 }', async () => {
    const { app, api } = buildApp({ itemStates: { [ITEM_ID]: doneItem() } });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(0);
    expect(res.body.already).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(api.changeStatus).not.toHaveBeenCalled();
  });

  it('passes p as expectedPersonId: an item whose assignees do NOT include p fails (D11), 502 all-failed', async () => {
    const { app, api } = buildApp({
      itemStates: { [ITEM_ID]: { ...workingItem(), peoplePersonIds: ['999999'] } },
    });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.failed).toBe(1);
    expect(res.body.message).toMatch(/^\[E10\]/);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
  });

  it('answers 502 { ok:false, updated:0, failed:1, message:[E10] } when the only selection fails (item not found)', async () => {
    const { app } = buildApp({ itemStates: { [ITEM_ID]: notFoundItem() } });
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.updated).toBe(0);
    expect(res.body.already).toBe(0);
    expect(res.body.failed).toBe(1);
    expect(res.body.message).toMatch(/^\[E10\]/);
  });

  it('a per-item STATE failure does not fail its batch-mates: one ok + one not_found → 200 { ok:false, updated:1, failed:1 }', async () => {
    const { app, api } = buildApp({
      itemStates: { [ITEM_ID]: workingItem(), [ITEM_ID_2]: notFoundItem() },
    });
    const res = await postAmp(app, signedBody({ pairs: TWO_PAIRS }));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.updated).toBe(1);
    expect(res.body.already).toBe(0);
    expect(res.body.failed).toBe(1);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('carries Cache-Control: no-store and the sender CORS header on a success response', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody());

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
  });

  it('carries Cache-Control: no-store and the sender CORS header on a post-CORS error response too', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody({ selections: {} })); // 400 no_items

    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
  });

  it('leaks no board id and no secret in any response body', async () => {
    const { app } = buildApp({ itemStates: { [ITEM_ID]: notFoundItem() } });
    const res = await postAmp(app, signedBody());

    expect(JSON.stringify(res.body)).not.toContain(BOARD_ID);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// AMP email body — failure `detail` is rendered via submit-error mustache
// ---------------------------------------------------------------------------

describe('POST /amp/confirm — failure detail for AMP email body', () => {
  it('includes detail=missing_or_invalid_fields on a 400 bad_request (missing sig)', async () => {
    const body = signedBody();
    delete body.sig;
    const { app } = buildApp();
    const res = await postAmp(app, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[\u0590-\u05FF]/);
    expect(res.body.detail).toBe('missing_or_invalid_fields');
  });

  it('includes detail with bad_slot got/expected/sendHour when the slot is stale', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody({ slot: PREV_SLOT }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/[\u0590-\u05FF]/);
    expect(res.body.detail).toBe(`bad_slot got=${PREV_SLOT} expected=${SLOT} sendHour=8`);
  });

  it('includes detail=bad_sig when the HMAC does not match', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody({ secret: OTHER_SECRET }));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('bad_sig');
  });

  it('includes detail=no_items when no item_ fields are selected', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, signedBody({ selections: {} }));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('no_items');
  });
});

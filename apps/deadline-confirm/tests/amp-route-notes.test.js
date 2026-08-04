// TDD — POST /amp/confirm with per-task required notes. Real Express pipeline
// via createApp; real signatures; api + storage are doubles.
//
// The AMP document disables its submit button while a marked row has an empty
// note, but the endpoint is public: this suite pins what happens when a caller
// posts anyway. A missing note is a PER-ITEM refusal — it must not take its
// batch-mates down, because the reader who filled two rows correctly should
// still get those two updated.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { buildManifest, signManifest, currentSlot } from '../src/services/manifest-signature.js';
import { MAX_NOTE_LENGTH } from '../src/services/digest-notes.js';

const ACCOUNT_ID = '777';
const PERSON_ID = '501';
const SECRET = 'SECRET43';
const SENDER = 'deadline@twyst.co.il';
const NOW = new Date('2026-08-03T10:00:00+03:00');
const SLOT = currentSlot({ sendHour: 8, now: NOW });

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [SENDER],
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;

const BUTTONS = [
  {
    id: 'b_note0001',
    name: 'סיימתי',
    statusColumnId: 'status_a',
    targetIndex: 2,
    targetLabel: 'בוצע',
    style: { color: '#00854d', icon: '✓', size: 'sm' },
  },
  {
    id: 'b_plain001',
    name: 'התחלתי',
    statusColumnId: 'status_b',
    targetIndex: 1,
    targetLabel: 'בעבודה',
    style: { color: '#0073ea', icon: '▶', size: 'sm' },
  },
];

/** Cluster 1 maps a text column (notes required); cluster 2 maps none. */
const CONFIG = {
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: BUTTONS,
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך',
    sendHour: 8,
    sections: [
      {
        id: 's_note0001',
        title: 'לסיים:',
        dateColumnId: 'date_end',
        dateColumnTitle: 'תאריך יעד',
        buttonId: 'b_note0001',
        buttonIds: ['b_note0001'],
        includeStatusLabelIds: [0],
        noteColumnId: 'text_note',
        noteColumnTitle: 'סיכום ביצוע',
      },
      {
        id: 's_plain001',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך התחלה',
        buttonId: 'b_plain001',
        buttonIds: ['b_plain001'],
        includeStatusLabelIds: [0],
      },
    ],
  },
};

const PAIRS = [
  { itemId: '9001', btnId: 'b_note0001' },
  { itemId: '9002', btnId: 'b_note0001' },
  { itemId: '9003', btnId: 'b_plain001' },
];
const MANIFEST = buildManifest(PAIRS);
const SIG = signManifest({
  secret: SECRET,
  accountId: ACCOUNT_ID,
  personId: PERSON_ID,
  slot: SLOT,
  manifest: MANIFEST,
});

function harness() {
  const backend = createMemoryBackend({
    [scoped('config')]: CONFIG,
    [scoped('link_secret')]: SECRET,
    [scoped('oauth_token')]: 'tok-1',
  });
  const api = {
    getItemState: vi.fn(async () => ({
      found: true,
      boardId: '111',
      statusLabelId: 0,
      peopleText: 'דנה כהן',
      peoplePersonIds: [PERSON_ID],
    })),
    changeStatus: vi.fn(async () => {}),
    changeColumns: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
  };
  const app = createApp({
    storage: createAppStorage({ backend }),
    api,
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    now: () => NOW,
  });
  return { app, api };
}

const post = (app, fields) =>
  request(app)
    .post('/amp/confirm')
    .set('AMP-Email-Sender', SENDER)
    .set('Origin', 'https://mail.google.com')
    .query({ __amp_source_origin: 'https://mail.google.com' })
    .type('form')
    .send({ a: ACCOUNT_ID, p: PERSON_ID, s: SLOT, sig: SIG, m: MANIFEST, ...fields });

describe('POST /amp/confirm — per-task required notes', () => {
  it('writes status + note together for a marked task in a note-mapped cluster', async () => {
    const { app, api } = harness();
    const res = await post(app, { item_9001: 'b_note0001', note_9001: 'הושלם מול הספק' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: 1, failed: 0 });
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.changeColumns).toHaveBeenCalledTimes(1);
    expect(api.changeColumns.mock.calls[0][0].values).toEqual({
      status_a: { index: 2 },
      text_note: 'הושלם מול הספק',
    });
  });

  it('refuses a marked task with NO note — nothing is written for it', async () => {
    const { app, api } = harness();
    const res = await post(app, { item_9001: 'b_note0001' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, updated: 0, failed: 1 });
    expect(api.changeColumns).not.toHaveBeenCalled();
    expect(api.changeStatus).not.toHaveBeenCalled();
    // The reader must be told WHY, or an empty box looks like a broken button.
    expect(res.body.message).toContain('טקסט');
  });

  it('treats a whitespace-only note as missing', async () => {
    const { app, api } = harness();
    const res = await post(app, { item_9001: 'b_note0001', note_9001: '    ' });

    expect(res.body.failed).toBe(1);
    expect(api.changeColumns).not.toHaveBeenCalled();
  });

  it('refuses ONLY the noteless task — its batch-mates still go through', async () => {
    const { app, api } = harness();
    const res = await post(app, {
      item_9001: 'b_note0001',
      note_9001: 'יש טקסט',
      item_9002: 'b_note0001', // marked, no note
      item_9003: 'b_plain001', // cluster without a note column
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 2, failed: 1, ok: false });
    expect(api.changeColumns).toHaveBeenCalledTimes(1); // only 9001
    expect(api.changeColumns.mock.calls[0][0].itemId).toBe('9001');
    expect(api.changeStatus).toHaveBeenCalledTimes(1); // only 9003
    expect(api.changeStatus.mock.calls[0][0].itemId).toBe('9003');
  });

  it('a cluster with no mapped column needs no note at all', async () => {
    const { app, api } = harness();
    const res = await post(app, { item_9003: 'b_plain001' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: 1 });
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeColumns).not.toHaveBeenCalled();
  });

  it('a note for an UNMARKED task is ignored — no selection, no write', async () => {
    const { app, api } = harness();
    const res = await post(app, { item_9001: 'b_note0001', note_9001: 'א', note_9002: 'הערה יתומה' });

    expect(res.body.updated).toBe(1);
    expect(api.changeColumns).toHaveBeenCalledTimes(1);
    expect(api.changeColumns.mock.calls[0][0].itemId).toBe('9001');
  });

  it('refuses a note past the length cap instead of silently truncating it', async () => {
    const { app, api } = harness();
    const res = await post(app, {
      item_9001: 'b_note0001',
      note_9001: 'x'.repeat(MAX_NOTE_LENGTH + 1),
    });

    expect(res.body.failed).toBe(1);
    expect(api.changeColumns).not.toHaveBeenCalled();
  });

  it('accepts a note exactly at the cap', async () => {
    const { app, api } = harness();
    const res = await post(app, {
      item_9001: 'b_note0001',
      note_9001: 'x'.repeat(MAX_NOTE_LENGTH),
    });

    expect(res.body.updated).toBe(1);
    expect(api.changeColumns.mock.calls[0][0].values.text_note.length).toBe(MAX_NOTE_LENGTH);
  });

  it('a note field alone, with no selection, is still no_items — notes never act on their own', async () => {
    const { app, api } = harness();
    const res = await post(app, { note_9001: 'רק טקסט' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_items');
    expect(api.changeColumns).not.toHaveBeenCalled();
  });
});

// TDD — PUT /api/config accepts the per-cluster note-column mapping
// (noteColumnId + noteColumnTitle) and normalizes its absence, so every config
// saved before this feature keeps loading unchanged.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};
const scoped = (key) => `${ACCOUNT_ID}:${key}`;
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');

function makeHarness() {
  const backend = createMemoryBackend();
  const app = createApp({
    storage: createAppStorage({ backend }),
    api: { fetchMe: vi.fn(), getBoardItems: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
  });
  return { app, backend };
}

const section = (over = {}) => ({
  id: 's_start001',
  title: 'להתחיל:',
  dateColumnId: 'date_start',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: 'b_start001',
  buttonIds: ['b_start001'],
  includeStatusLabelIds: [0],
  ...over,
});

const payload = (sectionOver = {}) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [
    {
      id: 'b_start001',
      name: 'התחלתי',
      statusColumnId: 'status_a',
      targetIndex: 1,
      targetLabel: 'בעבודה',
      style: { color: '#0073ea', icon: '✓', size: 'sm' },
    },
  ],
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך',
    sendHour: 8,
    sections: [section(sectionOver)],
  },
});

const put = (app, body) => request(app).put('/api/config').set('Authorization', authHeader()).send(body);

describe('PUT /api/config — per-cluster note column', () => {
  it('persists noteColumnId + noteColumnTitle when both are supplied', async () => {
    const { app, backend } = makeHarness();
    const res = await put(app, payload({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' }));

    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections[0]).toMatchObject({
      noteColumnId: 'text_note',
      noteColumnTitle: 'סיכום ביצוע',
    });
    const stored = await backend.get(scoped('config'));
    expect(stored.digest.sections[0].noteColumnId).toBe('text_note');
    expect(stored.digest.sections[0].noteColumnTitle).toBe('סיכום ביצוע');
  });

  it('a section without the fields normalizes to no mapping (legacy configs keep working)', async () => {
    const { app } = makeHarness();
    const res = await put(app, payload());

    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections[0].noteColumnId).toBeNull();
    expect(res.body.config.digest.sections[0].noteColumnTitle).toBe('');
  });

  it.each([
    ['explicit null', { noteColumnId: null, noteColumnTitle: '' }],
    ['empty string id', { noteColumnId: '', noteColumnTitle: '' }],
  ])('%s clears the mapping rather than half-saving it', async (_label, over) => {
    const { app } = makeHarness();
    const res = await put(app, payload(over));
    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections[0].noteColumnId).toBeNull();
    expect(res.body.config.digest.sections[0].noteColumnTitle).toBe('');
  });

  it.each([
    ['a mapped column with no title', { noteColumnId: 'text_note' }],
    ['a mapped column with an empty title', { noteColumnId: 'text_note', noteColumnTitle: '' }],
    ['a non-string column id', { noteColumnId: 42, noteColumnTitle: 'כותרת' }],
    ['a non-string title', { noteColumnId: 'text_note', noteColumnTitle: 7 }],
  ])('400 invalid_config for %s — a header-less column would render a blank email column', async (_l, over) => {
    const { app } = makeHarness();
    const res = await put(app, payload(over));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_config', field: 'digest.sections' });
  });
});

// TDD red phase (0.14.0) — the server side of the digest BLOCK model:
//
//   PUT /api/config   accepts digest.blocks (text | cluster), validates every
//                     style value (a font name reaches a stylesheet — it is an
//                     allowlist, not free text) and DERIVES the stored
//                     `sections` from the cluster blocks IN BLOCK ORDER, which
//                     is what makes the mail's order the priority order.
//   GET  /api/state   always answers with blocks, reconstructing them for a
//                     config saved before this feature, so the SPA needs no
//                     migration logic of its own.
//   GET  /api/digest/preview  renders through the blocks.
//
// Legacy shape (a body with `sections` and no `blocks`) must keep working: the
// admin SPA and every stored config are upgraded at different times.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { LEGACY_TEXTS } from '../src/services/digest-blocks.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');

const buttons = () => [
  {
    id: 'b_start001',
    name: 'עדכן: התחלתי',
    statusColumnId: 'status_a',
    targetIndex: 0,
    targetLabel: 'בעבודה',
    style: { color: '#0073ea', icon: '✓', size: 'sm' },
  },
  {
    id: 'b_done0001',
    name: 'עדכן: בוצע',
    statusColumnId: 'status_b',
    targetIndex: 1,
    targetLabel: 'בוצע',
    style: { color: '#00854d', icon: '✓', size: 'sm' },
  },
];

const clusterBlock = (over = {}) => ({
  type: 'cluster',
  id: 's_start001',
  title: 'להתחיל:',
  dateColumnId: 'date_start',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: 'b_start001',
  buttonIds: ['b_start001'],
  includeStatusLabelIds: [0],
  ...over,
});

const textBlock = (over = {}) => ({
  type: 'text',
  id: 'x_hello001',
  text: 'שלום {{שם}},',
  direction: 'rtl',
  font: 'Default',
  fontSize: 18,
  align: 'right',
  color: '#323338',
  bold: true,
  ...over,
});

const digestWithBlocks = (blocks, over = {}) => ({
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך {{שם}}',
  blocks,
  ...over,
});

const configWith = (digest) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: buttons(),
  digest,
});

/** Legacy stored config: sections, no blocks — the pre-0.14.0 shape. */
const legacyStoredConfig = () => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: buttons(),
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך',
    sendHour: 8,
    sections: [
      {
        id: 's_start001',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך התחלה',
        buttonId: 'b_start001',
        buttonIds: ['b_start001'],
        includeStatusLabelIds: [0],
      },
    ],
  },
});

function boardItemsDouble() {
  const tasks = [
    {
      id: '9001',
      name: 'גיבוש תכנית עבודה',
      columns: {
        people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
        status_a: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
      },
    },
  ];
  const users = [
    {
      id: 'u1',
      name: 'דנה כהן',
      columns: {
        people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
      },
    },
  ];
  return vi.fn(async ({ boardId }) => {
    if (boardId === '111') return { items: tasks, truncated: false };
    if (boardId === '222') return { items: users, truncated: false };
    throw new Error(`unexpected boardId ${boardId}`);
  });
}

function harness({ seed = {} } = {}) {
  const backend = createMemoryBackend(seed);
  const storage = createAppStorage({ backend });
  const api = { fetchMe: vi.fn(async () => ({ name: 'Op' })), getBoardItems: boardItemsDouble() };
  const app = createApp({
    storage,
    api,
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    todayIso: TODAY,
  });
  return { app, backend };
}

const put = (app, config) =>
  request(app).put('/api/config').set('Authorization', authHeader()).send(config);

describe('PUT /api/config — digest.blocks', () => {
  it('persists the blocks and derives `sections` from the cluster blocks', async () => {
    const { app, backend } = harness();
    const res = await put(app, configWith(digestWithBlocks([textBlock(), clusterBlock()])));
    expect(res.status).toBe(200);
    expect(res.body.config.digest.blocks).toHaveLength(2);
    expect(res.body.config.digest.sections).toHaveLength(1);
    expect(res.body.config.digest.sections[0]).toMatchObject({
      id: 's_start001',
      dateColumnId: 'date_start',
      includeStatusLabelIds: [0],
    });
    expect(res.body.config.digest.sections[0].type).toBeUndefined();
    expect((await backend.get(scoped('config'))).digest.blocks).toHaveLength(2);
  });

  it('derives section ORDER from block order — the mail order IS the priority', async () => {
    const { app } = harness();
    const res = await put(
      app,
      configWith(
        digestWithBlocks([
          clusterBlock({ id: 's_done0001', buttonId: 'b_done0001', buttonIds: ['b_done0001'] }),
          textBlock(),
          clusterBlock(),
        ])
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections.map((s) => s.id)).toEqual(['s_done0001', 's_start001']);
  });

  it('generates a missing text-block id', async () => {
    const { app } = harness();
    const block = textBlock();
    delete block.id;
    const res = await put(app, configWith(digestWithBlocks([block, clusterBlock()])));
    expect(res.status).toBe(200);
    expect(res.body.config.digest.blocks[0].id).toMatch(/^x_[A-Za-z0-9_-]{4,16}$/);
  });

  it('still accepts the legacy body (sections, no blocks) and fills blocks in', async () => {
    const { app } = harness();
    const legacy = legacyStoredConfig();
    const res = await put(app, legacy);
    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections).toHaveLength(1);
    const texts = res.body.config.digest.blocks.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts[0]).toContain('{{שם}}');
    expect(texts).toContain(LEGACY_TEXTS.footer);
  });

  it.each([
    ['no cluster block at all', [textBlock()]],
    ['a cluster block naming an unknown button', [clusterBlock({ buttonIds: ['b_ghost001'], buttonId: 'b_ghost001' })]],
    ['a cluster block with no status condition', [clusterBlock({ includeStatusLabelIds: [] })]],
    ['a cluster block with no date column', [clusterBlock({ dateColumnId: '' })]],
    ['a text block with empty text', [textBlock({ text: '   ' }), clusterBlock()]],
    ['a text block over 2000 chars', [textBlock({ text: 'א'.repeat(2001) }), clusterBlock()]],
    ['a font that is not on the allowlist', [textBlock({ font: 'Comic Sans MS' }), clusterBlock()]],
    ['a font carrying CSS', [textBlock({ font: 'Arial; } body {' }), clusterBlock()]],
    ['a colour that is not a 6-digit hex', [textBlock({ color: 'red' }), clusterBlock()]],
    ['a font size below 10', [textBlock({ fontSize: 9 }), clusterBlock()]],
    ['a font size above 32', [textBlock({ fontSize: 33 }), clusterBlock()]],
    ['a non-integer font size', [textBlock({ fontSize: 12.5 }), clusterBlock()]],
    ['an unknown direction', [textBlock({ direction: 'auto' }), clusterBlock()]],
    ['an unknown alignment', [textBlock({ align: 'justify' }), clusterBlock()]],
    ['a non-boolean bold', [textBlock({ bold: 'yes' }), clusterBlock()]],
    ['an unknown block type', [{ type: 'image', url: 'https://x/y.png' }, clusterBlock()]],
    ['a fifth cluster block', [clusterBlock({ id: 's_c000001' }), clusterBlock({ id: 's_c000002' }), clusterBlock({ id: 's_c000003' }), clusterBlock({ id: 's_c000004' }), clusterBlock({ id: 's_c000005' })]],
    ['duplicate block ids', [textBlock(), textBlock(), clusterBlock()]],
  ])('rejects %s → 400 naming digest.blocks', async (_label, blocks) => {
    const { app } = harness();
    const res = await put(app, configWith(digestWithBlocks(blocks)));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_config');
    expect(res.body.field).toBe('digest.blocks');
  });

  it('rejects more than 20 blocks', async () => {
    const { app } = harness();
    const many = Array.from({ length: 20 }, (_, i) => textBlock({ id: `x_text${String(i).padStart(4, '0')}` }));
    const res = await put(app, configWith(digestWithBlocks([...many, clusterBlock()])));
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('digest.blocks');
  });

  it('accepts a cluster block that maps a required-note column', async () => {
    const { app } = harness();
    const res = await put(
      app,
      configWith(
        digestWithBlocks([clusterBlock({ noteColumnId: 'text_note', noteColumnTitle: 'הערה' })])
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.config.digest.sections[0].noteColumnId).toBe('text_note');
    expect(res.body.config.digest.blocks[0].noteColumnTitle).toBe('הערה');
  });
});

describe('GET /api/state — blocks are always present', () => {
  it('reconstructs blocks for a config stored before 0.14.0', async () => {
    const { app } = harness({ seed: { [scoped('config')]: legacyStoredConfig() } });
    const res = await request(app).get('/api/state').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    const blocks = res.body.config.digest.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.filter((b) => b.type === 'cluster').map((b) => b.id)).toEqual(['s_start001']);
    expect(blocks.filter((b) => b.type === 'text').map((b) => b.text)).toContain(LEGACY_TEXTS.footer);
  });

  it('leaves a config with no digest alone', async () => {
    const stored = legacyStoredConfig();
    stored.digest = null;
    const { app } = harness({ seed: { [scoped('config')]: stored } });
    const res = await request(app).get('/api/state').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.config.digest).toBeNull();
  });
});

describe('GET /api/digest/preview — renders through the blocks', () => {
  it('a legacy config still previews the legacy greeting and footer', async () => {
    const { app } = harness({
      seed: {
        [scoped('config')]: legacyStoredConfig(),
        [scoped('link_secret')]: 'SECRET43',
        [scoped('oauth_token')]: 'tok-1',
      },
    });
    const res = await request(app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.plain).toContain('שלום דנה כהן,');
    expect(res.body.plain).toContain(LEGACY_TEXTS.footer);
    expect(res.body.amp).toContain('שלום דנה כהן,');
  });

  it('an authored config previews ONLY the authored text', async () => {
    const stored = configWith(
      digestWithBlocks([textBlock({ text: 'בוקר טוב {{שם}}' }), clusterBlock()], { sendHour: 8 })
    );
    const { app } = harness({
      seed: {
        [scoped('config')]: stored,
        [scoped('link_secret')]: 'SECRET43',
        [scoped('oauth_token')]: 'tok-1',
      },
    });
    const res = await request(app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.plain).toContain('בוקר טוב דנה כהן');
    expect(res.body.plain).not.toContain(LEGACY_TEXTS.footer);
    expect(res.body.amp).toContain('בוקר טוב דנה כהן');
    expect(res.body.amp).toContain('גיבוש תכנית עבודה');
  });
});

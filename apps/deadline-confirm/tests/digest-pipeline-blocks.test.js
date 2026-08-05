// TDD red phase (0.15.0) — the pipeline side of the block model:
//
//   digest-service.digestSections()  the clusters come from `blocks` when the
//       digest has them; the stored `sections` array is only a projection, so a
//       stale copy must NEVER win. That is what keeps classification order (=
//       priority) identical to render order.
//   digest-run                       passes the blocks to both renderers and
//       resolves the name token in the SUBJECT — the one place a token value
//       reaches a mail header, so a CR/LF in a users-board row name must not.

import { describe, it, expect, vi } from 'vitest';
import { buildDigest, digestSections, digestTaskColumnIds } from '../src/services/digest-service.js';
import { runDigestForAccount } from '../src/services/digest-run.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { LEGACY_TEXTS } from '../src/services/digest-blocks.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00');

const BUTTONS = [
  {
    id: 'b_start001',
    name: 'התחלתי',
    statusColumnId: 'status_a',
    targetIndex: 0,
    targetLabel: 'בעבודה',
    style: { color: '#0073ea', icon: '✓', size: 'sm' },
  },
  {
    id: 'b_done0001',
    name: 'בוצע',
    statusColumnId: 'status_a',
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
  noteColumnId: null,
  noteColumnTitle: '',
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

const digest = (over = {}) => ({
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך',
  sendHour: 8,
  ...over,
});

const config = (over = {}) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: BUTTONS,
  ...over,
});

describe('digestSections — blocks are the source of truth', () => {
  it('reads the clusters out of the blocks, in block order', () => {
    const out = digestSections(
      digest({
        blocks: [
          clusterBlock({ id: 's_second01' }),
          textBlock(),
          clusterBlock({ id: 's_first001' }),
        ],
      })
    );
    expect(out.map((s) => s.id)).toEqual(['s_second01', 's_first001']);
    expect(out.every((s) => s.type === undefined)).toBe(true);
  });

  it('ignores a stale `sections` copy that disagrees with the blocks', () => {
    const out = digestSections(
      digest({
        blocks: [clusterBlock({ id: 's_fromblk1' })],
        sections: [clusterBlock({ id: 's_stale001' })],
      })
    );
    expect(out.map((s) => s.id)).toEqual(['s_fromblk1']);
  });

  it('falls back to `sections` for a digest saved before blocks existed', () => {
    const out = digestSections(digest({ sections: [{ id: 's_legacy01', title: 'x' }] }));
    expect(out.map((s) => s.id)).toEqual(['s_legacy01']);
  });

  it('answers [] for no digest at all', () => {
    expect(digestSections(null)).toEqual([]);
    expect(digestSections(undefined)).toEqual([]);
  });
});

describe('digestTaskColumnIds — reads the board columns the blocks name', () => {
  it('collects date + status columns from cluster blocks (not from a stale sections copy)', () => {
    const ids = digestTaskColumnIds(
      config({
        digest: digest({
          blocks: [
            textBlock(),
            clusterBlock({ dateColumnId: 'date_start', buttonIds: ['b_start001'] }),
            clusterBlock({ id: 's_done0001', dateColumnId: 'date_due', buttonIds: ['b_done0001'], buttonId: 'b_done0001' }),
          ],
          sections: [clusterBlock({ id: 's_stale001', dateColumnId: 'date_stale' })],
        }),
      })
    );
    expect(ids).toContain('people_t');
    expect(ids).toContain('date_start');
    expect(ids).toContain('date_due');
    expect(ids).toContain('status_a');
    expect(ids).not.toContain('date_stale');
  });
});

describe('buildDigest — block order is the cluster priority', () => {
  const tasks = [
    {
      id: '9001',
      name: 'משימה כפולה',
      columns: {
        people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
        date_due: { text: '', statusLabelId: null, date: '2026-07-11', personIds: [] },
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

  /** Both clusters match the task; only the FIRST block may claim it. */
  const twoClusters = (first, second) =>
    buildDigest({
      config: config({
        digest: digest({
          blocks: [
            clusterBlock({ id: first, dateColumnId: 'date_start' }),
            clusterBlock({ id: second, dateColumnId: 'date_due' }),
          ],
        }),
      }),
      tasks,
      users,
      today: TODAY,
    });

  it('gives the task to the first cluster block', () => {
    const { recipients } = twoClusters('s_aaa00001', 's_bbb00001');
    expect(recipients[0].sections.map((s) => s.sectionId)).toEqual(['s_aaa00001']);
  });

  it('moves it when the operator reorders the blocks', () => {
    const { recipients } = twoClusters('s_bbb00001', 's_aaa00001');
    expect(recipients[0].sections.map((s) => s.sectionId)).toEqual(['s_bbb00001']);
  });
});

describe('runDigestForAccount — blocks and the subject token', () => {
  const boardItems = ({ userName = 'דנה כהן' } = {}) =>
    vi.fn(async ({ boardId }) => {
      if (boardId === '111') {
        return {
          items: [
            {
              id: '9001',
              name: 'גיבוש תכנית עבודה',
              columns: {
                people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
                date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
                status_a: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
              },
            },
          ],
          truncated: false,
        };
      }
      return {
        items: [
          {
            id: 'u1',
            name: userName,
            columns: {
              people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
              email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
            },
          },
        ],
        truncated: false,
      };
    });

  async function run({ storedConfig, userName }) {
    const storage = createAppStorage({ backend: createMemoryBackend() });
    const scoped = storage.forAccount(ACCOUNT_ID);
    await scoped.setConfig(storedConfig);
    await scoped.setLinkSecret('s'.repeat(32));
    await scoped.setOauthToken('tok');
    const send = vi.fn(async () => ({ id: 'msg-1' }));
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api: { getBoardItems: boardItems({ userName }) },
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    return { out, send };
  }

  it('sends the authored text — and only it', async () => {
    const { out, send } = await run({
      storedConfig: config({
        digest: digest({
          blocks: [textBlock({ text: 'היי {{שם}}' }), clusterBlock()],
        }),
      }),
    });
    expect(out.sent).toBe(1);
    const sent = send.mock.calls[0][0];
    expect(sent.plain).toContain('היי דנה כהן');
    expect(sent.amp).toContain('היי דנה כהן');
    expect(sent.plain).not.toContain(LEGACY_TEXTS.footer);
  });

  it('reconstructs the legacy mail for a config stored before blocks', async () => {
    const { send } = await run({
      storedConfig: config({ digest: digest({ sections: [clusterBlock()] }) }),
    });
    const sent = send.mock.calls[0][0];
    expect(sent.plain).toContain('שלום דנה כהן,');
    expect(sent.plain).toContain(LEGACY_TEXTS.footer);
  });

  it('resolves the name token in the subject, per recipient', async () => {
    const { send } = await run({
      storedConfig: config({
        digest: digest({ subject: 'המשימות של {{שם}}', blocks: [clusterBlock()] }),
      }),
    });
    expect(send.mock.calls[0][0].subject).toBe('המשימות של דנה כהן');
  });

  it('never lets a row name break the Subject header', async () => {
    const { send } = await run({
      storedConfig: config({
        digest: digest({ subject: 'משימות {{שם}}', blocks: [clusterBlock()] }),
      }),
      userName: 'דנה\r\nBcc: attacker@example.com',
    });
    const { subject } = send.mock.calls[0][0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('דנה');
  });
});

// Unit tests for runDigestForAccount — the shared send pipeline used by
// manual send, resend-today, and the scheduler (T10/T12). Pins: skip reasons
// for incomplete tenants, MIME plain+amp (no /confirm html), live slot via now.

import { describe, it, expect, vi } from 'vitest';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';
import { runDigestForAccount, hourInJerusalem } from '../src/services/digest-run.js';
import { currentSlot } from '../src/services/manifest-signature.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00'); // Sunday 08:05 Jerusalem

function buttons() {
  return [
    {
      id: 'b_start001',
      name: 'עדכן: התחלתי',
      statusColumnId: 'status_a',
      targetIndex: 0,
      targetLabel: 'בעבודה',
      style: { color: '#0073ea', icon: '✓', size: 'sm' },
    },
  ];
}

function fullConfig(overrides = {}) {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: buttons(),
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'המשימות שלך — נדרש עדכון',
      sendHour: 8,
      sections: [
        {
          id: 's_start001',
          title: 'להתחיל:',
          dateColumnId: 'date_start',
          dateColumnTitle: 'תאריך התחלה',
          buttonId: 'b_start001',
          includeStatusLabelIds: [0],
        },
      ],
      ...overrides.digest,
    },
    ...overrides,
  };
}

function boardItemsDouble() {
  return vi.fn(async ({ boardId }) => {
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
          name: 'דנה כהן',
          columns: {
            people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
            email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
      ],
      truncated: false,
    };
  });
}

async function seeded({ emailSender, getBoardItems, config, secret = 's'.repeat(32), token = 'tok' } = {}) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  const scoped = storage.forAccount(ACCOUNT_ID);
  if (config !== null) await scoped.setConfig(config ?? fullConfig());
  if (secret) await scoped.setLinkSecret(secret);
  if (token) await scoped.setOauthToken(token);
  const api = { getBoardItems: getBoardItems ?? boardItemsDouble() };
  return { storage, api, emailSender };
}

describe('hourInJerusalem', () => {
  it('reads the Asia/Jerusalem wall-clock hour from a fixed instant', () => {
    expect(hourInJerusalem(FIXED_NOW)).toBe(8);
  });
});

describe('runDigestForAccount', () => {
  it('requests the recipient label gate column on the users-board read when configured (round348 §E)', async () => {
    // Regression guard: forgetting to add the gate column to columnIds makes
    // digest-service.js read it as unset on every row, silently excluding
    // everyone — a bug this file's own double (which ignores columnIds and
    // returns full rows regardless of what was asked for) would not otherwise
    // catch, since the double answers the same rows either way.
    const send = vi.fn().mockResolvedValue({ id: 'em' });
    const inner = boardItemsDouble();
    const getBoardItems = vi.fn((args) => inner(args));
    // fullConfig's outer `...overrides` spread replaces `digest` wholesale, so a
    // partial `{ digest: {...} }` override would drop usersBoardId etc. — set the
    // gate fields directly on the default digest instead.
    const gatedConfig = fullConfig();
    gatedConfig.digest.recipientGateColumnId = 'status_gate';
    gatedConfig.digest.recipientGateLabelId = 1;
    const { storage } = await seeded({ emailSender: { send }, getBoardItems, config: gatedConfig });
    await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api: { getBoardItems },
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    const usersCall = getBoardItems.mock.calls.map(([p]) => p).find((p) => p.boardId === '222');
    expect(usersCall.columnIds).toContain('status_gate');
  });

  it('returns skip email_not_configured when no sender is wired', async () => {
    const { storage, api } = await seeded({ emailSender: undefined });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api,
      baseUrl: 'https://app.example',
      emailSender: undefined,
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out).toEqual({ skip: 'email_not_configured' });
  });

  it('returns skip digest_not_configured when config has no digest block', async () => {
    const send = vi.fn();
    const { storage, api } = await seeded({
      emailSender: { send },
      config: { boardId: '111', peopleColumnId: 'people_t', buttons: buttons() },
    });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api,
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out).toEqual({ skip: 'digest_not_configured' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns skip no_secret when the link secret is missing', async () => {
    const send = vi.fn();
    const { storage, api } = await seeded({ emailSender: { send }, secret: null });
    // seeded still wrote a secret — clear it
    await storage.forAccount(ACCOUNT_ID).setLinkSecret(null);
    // memory backend may not accept null; delete via backend key
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage: {
        forAccount: (id) => ({
          getConfig: () => storage.forAccount(id).getConfig(),
          getLinkSecret: async () => null,
          getOauthToken: () => storage.forAccount(id).getOauthToken(),
        }),
      },
      api,
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out).toEqual({ skip: 'no_secret' });
  });

  it('sends one MIME message per recipient with plain+amp (no /confirm html) and reports the live slot', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_1' });
    const { storage, api } = await seeded({ emailSender: { send } });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api,
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out.skip).toBeUndefined();
    expect(out.slot).toBe(currentSlot({ sendHour: 8, now: FIXED_NOW }));
    expect(out.sent).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.results).toEqual([
      { email: 'dana@example.com', name: 'דנה כהן', taskCount: 1, ok: true },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    // T9: the Gmail sender resolves the tenant's own mailbox and OAuth client
    // from this id. Omit it and every send has no sending identity to
    // authenticate as, so nothing goes out.
    expect(payload.accountId).toBe(ACCOUNT_ID);
    expect(payload.to).toBe('dana@example.com');
    expect(payload.subject).toBe('המשימות שלך — נדרש עדכון');
    expect(payload.plain).toContain('דנה כהן');
    expect(payload.plain).not.toContain('/confirm');
    expect(payload.amp).toContain('amp4email');
    expect(payload.mime.contentType).toMatch(/^multipart\/alternative/);
    expect(payload.mime.body).toContain('text/plain');
    expect(payload.mime.body).toContain('text/x-amp-html');
    expect(payload).not.toHaveProperty('html');
  });

  it('threads real board label colors from the TASKS-board read into the rendered AMP', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_1' });
    const inner = boardItemsDouble();
    // Hex from tests/fixtures/board-columns-settings.probe.json (label 0 → #fdab3d);
    // deliberately different from the config button's style.color (#0073ea).
    const getBoardItems = vi.fn(async (args) =>
      args.boardId === '111'
        ? { ...(await inner(args)), statusColumnColors: { status_a: { 0: '#fdab3d' } } }
        : inner(args)
    );
    const { storage } = await seeded({ emailSender: { send }, getBoardItems });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api: { getBoardItems },
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out.sent).toBe(1);
    const amp = send.mock.calls[0][0].amp;
    // Option pill: real board color, not the configured guess.
    expect(amp).toMatch(/class="dd-opt" style="background:#fdab3d"/);
    expect(amp).not.toMatch(/class="dd-opt" style="background:#0073ea"/);
    // Current-status chip: task 9001 carries label 0 → board color class.
    expect(amp).toContain('"c9001":"bg_fdab3d"');
    expect(amp).toContain('.dd-trig.bg_fdab3d { background:#fdab3d; }');
  });

  it('one failing recipient → ok:false on that result; siblings still sent', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid `to`'))
      .mockResolvedValueOnce({ id: 'em_2' });
    // two recipients
    const getBoardItems = vi.fn(async ({ boardId }) => {
      if (boardId === '111') {
        return {
          items: [
            {
              id: '9001',
              name: 'א',
              columns: {
                people_t: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
                date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
                status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
              },
            },
            {
              id: '9002',
              name: 'ב',
              columns: {
                people_t: { text: '', statusLabelId: null, date: null, personIds: ['502'] },
                date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
                status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
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
            name: 'דנה',
            columns: {
              people_u: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
              email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
            },
          },
          {
            id: 'u2',
            name: 'יוסי',
            columns: {
              people_u: { text: '', statusLabelId: null, date: null, personIds: ['502'] },
              email_u: { text: 'yossi@example.com', statusLabelId: null, date: null, personIds: [] },
            },
          },
        ],
        truncated: false,
      };
    });
    const { storage } = await seeded({ emailSender: { send }, getBoardItems });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api: { getBoardItems },
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out.sent).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.failedAddresses).toEqual(['dana@example.com']);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[1].ok).toBe(true);
  });

  it('monday API failure → skip monday_api_failed (never throws)', async () => {
    const send = vi.fn();
    const { storage } = await seeded({
      emailSender: { send },
      getBoardItems: vi.fn().mockRejectedValue(new MondayApiError('boom', { status: 200 })),
    });
    const out = await runDigestForAccount({
      accountId: ACCOUNT_ID,
      storage,
      api: { getBoardItems: vi.fn().mockRejectedValue(new MondayApiError('boom', { status: 200 })) },
      baseUrl: 'https://app.example',
      emailSender: { send },
      todayIso: TODAY,
      now: () => FIXED_NOW,
    });
    expect(out).toEqual({ skip: 'monday_api_failed' });
    expect(send).not.toHaveBeenCalled();
  });
});

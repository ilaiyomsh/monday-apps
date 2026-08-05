// TDD — the recipient label gate (round348 §E) survives the draft round-trip.
// The SPA edits a draft and PUTs a config; a field dropped anywhere along that
// path silently re-widens (mails everyone again) or breaks the gate, with no
// error anywhere to say so.

import { describe, it, expect } from 'vitest';
import { defaultDigestDraft, digestFromConfig, draftToConfig, draftFromConfig } from './draft';
import type { ActionButton, AppConfig, DigestConfig } from './types';

const BUTTON: ActionButton = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status_a',
  targetIndex: 2,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

const digestConfig = (over: Partial<DigestConfig> = {}): DigestConfig => ({
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך',
  sendHour: 8,
  sections: [
    {
      id: 's_done0001',
      title: 'לסיים:',
      dateColumnId: 'date_end',
      dateColumnTitle: 'תאריך יעד',
      buttonId: 'b_done0001',
      buttonIds: ['b_done0001'],
      includeStatusLabelIds: [0],
    },
  ],
  ...over,
});

const appConfig = (digest: DigestConfig): AppConfig => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [BUTTON],
  templates: [],
  digest,
});

describe('defaultDigestDraft', () => {
  it('starts with no recipient gate mapped — the digest goes to everyone, as before', () => {
    const draft = defaultDigestDraft();
    expect(draft.recipientGateColumnId).toBeNull();
    expect(draft.recipientGateLabelId).toBeNull();
  });
});

describe('digestFromConfig — recipient gate', () => {
  it('loads a mapped recipient gate into the draft', () => {
    const draft = digestFromConfig(
      digestConfig({ recipientGateColumnId: 'status_gate', recipientGateLabelId: 1 })
    );
    expect(draft.recipientGateColumnId).toBe('status_gate');
    expect(draft.recipientGateLabelId).toBe(1);
  });

  it('loads label id 0 as 0, never null — 0 is a valid label id', () => {
    const draft = digestFromConfig(
      digestConfig({ recipientGateColumnId: 'status_gate', recipientGateLabelId: 0 })
    );
    expect(draft.recipientGateLabelId).toBe(0);
  });

  it('backfills a config saved before the feature — null, never undefined', () => {
    const draft = digestFromConfig(digestConfig());
    expect(draft.recipientGateColumnId).toBeNull();
    expect(draft.recipientGateLabelId).toBeNull();
  });
});

describe('draftToConfig — recipient gate', () => {
  it('emits the gate so the server can persist it', () => {
    const draft = draftFromConfig(
      appConfig(digestConfig({ recipientGateColumnId: 'status_gate', recipientGateLabelId: 1 }))
    );
    const config = draftToConfig(draft);
    expect(config?.digest?.recipientGateColumnId).toBe('status_gate');
    expect(config?.digest?.recipientGateLabelId).toBe(1);
  });

  it('emits null for an unmapped gate rather than omitting the keys', () => {
    const config = draftToConfig(draftFromConfig(appConfig(digestConfig())));
    expect(config?.digest?.recipientGateColumnId).toBeNull();
    expect(config?.digest?.recipientGateLabelId).toBeNull();
  });

  it('label id 0 survives draftToConfig — never dropped as falsy', () => {
    const draft = draftFromConfig(
      appConfig(digestConfig({ recipientGateColumnId: 'status_gate', recipientGateLabelId: 0 }))
    );
    const config = draftToConfig(draft);
    expect(config?.digest?.recipientGateLabelId).toBe(0);
  });

  it('survives a full round-trip unchanged (config → draft → config)', () => {
    const original = appConfig(
      digestConfig({ recipientGateColumnId: 'status_gate', recipientGateLabelId: 1 })
    );
    const roundTripped = draftToConfig(draftFromConfig(original));
    expect(roundTripped?.digest).toMatchObject({
      recipientGateColumnId: 'status_gate',
      recipientGateLabelId: 1,
    });
  });
});

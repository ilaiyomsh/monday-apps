// v4 digest draft model — enabled-flag semantics: a DISABLED digest never
// blocks saving (payload digest: null); an ENABLED digest must be complete
// before draftToConfig resolves.
//
// 0.15.0: the draft's clusters live in `blocks` (one ordered list of text and
// cluster blocks), so the assertions below read them through digestClusters().
// The completeness rules themselves are unchanged — plus two new ones for text
// blocks, which the server also enforces.

import { describe, it, expect } from 'vitest';
import {
  defaultDigestDraft,
  digestClusters,
  digestFromConfig,
  digestIsComplete,
  draftFromConfig,
  draftToConfig,
  newDigestCluster,
  newDigestSection,
  newDigestTextBlock,
  type ConfigDraft,
  type DigestClusterDraft,
} from './draft';
import type { ActionButton, DigestConfig } from './types';

/** A cluster block draft from the plain section fields the cases below use. */
const cluster = (over: Partial<DigestClusterDraft> = {}): DigestClusterDraft => ({
  ...newDigestCluster('א'),
  dateColumnId: 'd',
  dateColumnTitle: 'ת',
  buttonId: 'b_done0001',
  buttonIds: ['b_done0001'],
  includeStatusLabelIds: [0],
  ...over,
});

const BUTTON: ActionButton = {
  id: 'b_done0001',
  name: 'עדכן: בוצע',
  statusColumnId: 'status_b',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const DIGEST_CONFIG: DigestConfig = {
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך',
  sendHour: 8,
  sections: [
    {
      id: 's_done0001',
      title: 'לסיים:',
      dateColumnId: 'date_due',
      dateColumnTitle: 'תאריך סיום',
      noteColumnId: null,
      noteColumnTitle: '',
      buttonId: 'b_done0001',
      buttonIds: ['b_done0001'],
      includeStatusLabelIds: [0],
    },
  ],
};

function completeDraft(digest?: Partial<ConfigDraft['digest']>): ConfigDraft {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: [BUTTON],
    templates: [],
    digest: { ...digestFromConfig(DIGEST_CONFIG), ...digest },
  };
}

describe('defaultDigestDraft', () => {
  it('starts disabled, with a default subject and the two mock clusters (empty picks)', () => {
    const d = defaultDigestDraft();
    expect(d.enabled).toBe(false);
    expect(d.subject.length).toBeGreaterThan(0);
    expect(d.sendHour).toBe(8);
    const clusters = digestClusters(d);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].id).toMatch(/^s_/);
    expect(clusters[0].dateColumnId).toBeNull();
    expect(clusters[0].dateColumnTitle).toBe('');
    expect(clusters[0].buttonId).toBeNull();
    expect(clusters[0].buttonIds).toEqual([]);
    expect(clusters[0].includeStatusLabelIds).toEqual([]);
    // two distinct generated ids
    expect(clusters[0].id).not.toBe(clusters[1].id);
  });

  // The default body is not empty: with no pre-written text left in the
  // renderers, an operator who never opens the block list would otherwise send a
  // mail with nothing but tables.
  it('seeds the body with greeting + clusters + closing, in that order', () => {
    const types = defaultDigestDraft().blocks.map((b) => b.type);
    expect(types).toEqual(['text', 'text', 'cluster', 'cluster', 'text']);
  });
});

describe('newDigestSection', () => {
  it('generates a fresh s_ id and empty picks', () => {
    const s = newDigestSection('כותרת');
    expect(s.id).toMatch(/^s_[A-Za-z0-9_-]{4,16}$/);
    expect(s.title).toBe('כותרת');
    expect(s.dateColumnId).toBeNull();
    expect(s.dateColumnTitle).toBe('');
    expect(s.buttonId).toBeNull();
    expect(s.buttonIds).toEqual([]);
    expect(s.includeStatusLabelIds).toEqual([]);
  });
});

describe('digestFromConfig / draftFromConfig', () => {
  it('a saved digest loads enabled with its fields', () => {
    const d = digestFromConfig(DIGEST_CONFIG);
    expect(d.enabled).toBe(true);
    expect(d.usersBoardId).toBe('222');
    expect(d.sendHour).toBe(8);
    expect(digestClusters(d)).toEqual([
      {
        type: 'cluster',
        id: 's_done0001',
        title: 'לסיים:',
        dateColumnId: 'date_due',
        dateColumnTitle: 'תאריך סיום',
        noteColumnId: null,
        noteColumnTitle: '',
        buttonId: 'b_done0001',
        buttonIds: ['b_done0001'],
        includeStatusLabelIds: [0],
      },
    ]);
  });

  it('legacy section with only buttonId (no buttonIds) fills buttonIds from buttonId', () => {
    const legacy: DigestConfig = {
      ...DIGEST_CONFIG,
      sections: [
        {
          id: 's_done0001',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          buttonId: 'b_done0001',
          includeStatusLabelIds: [0],
        },
      ],
    };
    const d = digestFromConfig(legacy);
    expect(digestClusters(d)[0].buttonIds).toEqual(['b_done0001']);
    expect(digestClusters(d)[0].buttonId).toBe('b_done0001');
    expect(digestIsComplete(d)).toBe(true);
  });

  it('a null/absent digest loads as the disabled default', () => {
    expect(digestFromConfig(null).enabled).toBe(false);
    expect(digestFromConfig(undefined).enabled).toBe(false);
    const draft = draftFromConfig({
      boardId: '111',
      peopleColumnId: 'people_t',
      buttons: [BUTTON],
      templates: [],
      digest: null,
    });
    expect(draft.digest.enabled).toBe(false);
  });
});

describe('digestIsComplete', () => {
  it('true for a fully-picked enabled digest', () => {
    expect(digestIsComplete(digestFromConfig(DIGEST_CONFIG))).toBe(true);
  });

  it('false when buttonIds is empty even if legacy buttonId is set', () => {
    const d = digestFromConfig(DIGEST_CONFIG);
    const target = digestClusters(d)[0];
    target.buttonIds = [];
    target.buttonId = 'b_done0001';
    expect(digestIsComplete(d)).toBe(false);
  });

  it.each([
    ['no users board', { usersBoardId: null }],
    ['no people column', { usersPeopleColumnId: null }],
    ['no email column', { usersEmailColumnId: null }],
    ['empty subject', { subject: '  ' }],
    ['no blocks at all', { blocks: [] }],
    ['text blocks only — no cluster', { blocks: [newDigestTextBlock('שלום')] }],
    ['cluster without date column', { blocks: [cluster({ dateColumnId: null, dateColumnTitle: '' })] }],
    ['cluster without button', { blocks: [cluster({ buttonId: null, buttonIds: [] })] }],
    ['cluster with empty title', { blocks: [cluster({ title: ' ' })] }],
    ['cluster with no include statuses', { blocks: [cluster({ includeStatusLabelIds: [] })] }],
    ['an empty text block beside a valid cluster', { blocks: [newDigestTextBlock('   '), cluster()] }],
    ['a text block over the length cap', { blocks: [newDigestTextBlock('א'.repeat(2001)), cluster()] }],
    ['a fifth cluster', { blocks: [cluster({ id: 's_c00001' }), cluster({ id: 's_c00002' }), cluster({ id: 's_c00003' }), cluster({ id: 's_c00004' }), cluster({ id: 's_c00005' })] }],
  ])('false when %s', (_name, patch) => {
    expect(digestIsComplete({ ...digestFromConfig(DIGEST_CONFIG), ...patch })).toBe(false);
  });
});

describe('draftToConfig digest resolution', () => {
  it('DISABLED digest → payload resolves with digest: null (never blocks saving)', () => {
    const payload = draftToConfig(completeDraft({ enabled: false, usersBoardId: null }));
    expect(payload).not.toBeNull();
    expect(payload?.digest).toBeNull();
  });

  // 0.15.0: the payload carries BOTH — `blocks` (what the server validates and
  // stores) and the `sections` projection derived from them, sent so a rolled-back
  // server still finds the clusters. The server re-derives sections from the
  // blocks either way, so storage cannot end up with the two disagreeing.
  it('ENABLED + complete → payload carries the clusters as sections AND as blocks', () => {
    const payload = draftToConfig(completeDraft());
    expect(payload?.digest?.sections).toEqual(DIGEST_CONFIG.sections);
    expect(payload?.digest?.subject).toBe(DIGEST_CONFIG.subject);
    expect(payload?.digest?.sendHour).toBe(DIGEST_CONFIG.sendHour);
    // digestFromConfig reconstructed the legacy text around the single cluster,
    // so the body is: greeting, lead, the cluster, footer.
    expect(payload?.digest?.blocks?.map((b) => b.type)).toEqual([
      'text',
      'text',
      'cluster',
      'text',
    ]);
    expect(payload?.digest?.blocks?.filter((b) => b.type === 'cluster')).toEqual([
      { type: 'cluster', ...DIGEST_CONFIG.sections[0] },
    ]);
  });

  it('ENABLED + incomplete → the whole payload is null (save disabled)', () => {
    expect(draftToConfig(completeDraft({ usersEmailColumnId: null }))).toBeNull();
  });
});

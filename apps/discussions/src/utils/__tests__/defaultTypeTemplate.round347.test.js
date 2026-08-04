import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round347 (owner spec) — an install ships with ONE discussion type, "דיון כללי", and its
 * agenda template, with the installing user as BOTH מנהל and מרכז הדיון.
 *
 * Before this, a new account landed on an empty type list and an empty template list: the
 * first thing anyone had to do was invent both before the app did anything useful.
 *
 * The seeding rule that matters most is the one that says NO: it writes only into an EMPTY
 * type-template store. Anything else would overwrite the types an account built itself the
 * next time someone re-ran the wizard to top up columns.
 */

const storage = { getItem: vi.fn(), setItem: vi.fn(async () => ({})) };
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: { storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) } },
  api: vi.fn(),
  formatValue: vi.fn(),
}));
vi.mock('../mondayApi/board-config-store.js', () => ({ getBoardId: () => null, getColumns: () => ({}) }));

import {
  DEFAULT_DISCUSSION_TYPE,
  DEFAULT_TYPE_TEMPLATE_TOPICS,
  buildDefaultTypeTemplate,
  seedDefaultTypeTemplate,
} from '../defaultTypeTemplate.js';

const ME = { id: '7', name: 'עידו' };
const CTX = { instanceId: 'i1' };
const stored = () => JSON.parse(storage.setItem.mock.calls[0][1]).templates;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set BOTH implementations, not just calls: `clearAllMocks` keeps a mockReturnValue, so a
  // never-settling promise from the timeout tests below would leak into the next test and make
  // it hang for the full bound — a false slow-green of exactly the kind this suite guards against.
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
  storage.setItem.mockImplementation(async () => ({}));
});

describe('round347 — the agenda, verbatim from the spec', () => {
  it('carries the three topics and their points, in order', () => {
    const t = buildDefaultTypeTemplate(ME);
    expect(t.discussionType).toBe(DEFAULT_DISCUSSION_TYPE);
    expect(t.topics.map((x) => x.name)).toEqual(['פתיחה', 'עיקרי הדיון', 'סיכום']);
    expect(t.topics[0].points).toEqual(['עדכוני מנהל', 'מעבר על החלטות/משימות מדיון קודם', 'תודות']);
    expect(t.topics[1].points).toEqual([
      'סקירת עמידה בתוכניות עבודה', 'לו"ז 3 חודשים קדימה', 'לקחים מהשבוע החולף', 'עדכוני מטה',
    ]);
    expect(t.topics[2].points).toEqual(['סדר עדיפויות להמשך', 'תיאום הדיון הבא']);
  });

  // Both roles, not one: they are the two that carry the discussion-tier permissions, so an
  // install is immediately usable by whoever set it up.
  it('puts the installing user in BOTH lead and coordinator', () => {
    const t = buildDefaultTypeTemplate(ME);
    expect(t.lead).toEqual([{ id: '7', kind: 'person', name: 'עידו' }]);
    expect(t.coordinator).toEqual([{ id: '7', kind: 'person', name: 'עידו' }]);
    expect(t.participants).toEqual([]);
  });

  /*
   * No installer (context still loading, or a token with no `me`) must NOT produce a person
   * with an undefined id: these lists are written to real people columns later, where an
   * id-less entry is a write that silently does nothing or errors.
   */
  it('leaves the roles EMPTY rather than inventing a person', () => {
    for (const bad of [null, undefined, {}, { name: 'ללא מזהה' }]) {
      const t = buildDefaultTypeTemplate(bad);
      expect(t.lead).toEqual([]);
      expect(t.coordinator).toEqual([]);
    }
  });

  // The template goes through the same sanitizer TemplatesContext reads back with, so the
  // stored shape cannot drift from what the app expects.
  it('produces the canonical stored shape', () => {
    const t = buildDefaultTypeTemplate(ME, 'fixed-id');
    expect(Object.keys(t).sort()).toEqual([
      'coordinator', 'deciderIsLead', 'discussionType', 'exportTemplate', 'id', 'lead', 'participants', 'topics',
    ]);
    expect(t.id).toBe('fixed-id');
    // The "decider = lead" default is a GLOBAL preference; the per-type flag stays off so the
    // two cannot disagree.
    expect(t.deciderIsLead).toBe(false);
  });
});

describe('round347 — seeding only ever fills an EMPTY store', () => {
  it('writes the template under the type-templates key of the instance', async () => {
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('seeded');
    expect(storage.setItem.mock.calls[0][0]).toBe('discussions_type_templates_i1');
    expect(stored()).toHaveLength(1);
    expect(stored()[0].discussionType).toBe(DEFAULT_DISCUSSION_TYPE);
    expect(stored()[0].topics).toHaveLength(DEFAULT_TYPE_TEMPLATE_TOPICS.length);
  });

  /*
   * The guard. A top-up run of the wizard on a configured account must not touch its types —
   * this is the difference between a seed and a destructive migration.
   */
  it('does NOTHING when the store already holds a type template', async () => {
    storage.getItem.mockResolvedValue({
      data: { value: JSON.stringify({ templates: [{ id: 'x', discussionType: 'הנהלה', topics: [] }] }) },
    });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('skipped-existing');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  // A legacy store held a BARE ARRAY rather than { templates }. It still counts as existing —
  // reading it as empty would wipe those types.
  it('respects a legacy bare-array store', async () => {
    storage.getItem.mockResolvedValue({
      data: { value: JSON.stringify([{ id: 'x', discussionType: 'כספים', topics: [] }]) },
    });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('skipped-existing');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  // An empty list is genuinely empty — seed it.
  it('seeds over an empty stored list', async () => {
    storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ templates: [] }) } });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('seeded');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  // Storage unavailable (local dev, or a transient failure) is reported, never thrown: the
  // install it runs at the end of has already succeeded.
  it('reports a storage failure instead of failing the install', async () => {
    storage.getItem.mockRejectedValue(new Error('storage down'));
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('failed');
  });

  /*
   * round347 (review finding) — the storage calls are BOUNDED, like the rest of the storage
   * layer. `monday.storage` is an iframe bridge: a call that never settles would leave the
   * install awaiting this function forever, stuck on "מקים את המערכת עבורך…", which is
   * precisely the case the fail-soft catch is supposed to cover.
   */
  it('gives up on a storage call that never settles', async () => {
    vi.useFakeTimers();
    try {
      storage.getItem.mockReturnValue(new Promise(() => {}));
      const p = seedDefaultTypeTemplate(CTX, ME);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toBe('failed');
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a WRITE that never settles', async () => {
    vi.useFakeTimers();
    try {
      storage.setItem.mockReturnValue(new Promise(() => {}));
      const p = seedDefaultTypeTemplate(CTX, ME);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the boardId, then to default, for the key', async () => {
    await seedDefaultTypeTemplate({ boardId: 'B9' }, ME);
    expect(storage.setItem.mock.calls[0][0]).toBe('discussions_type_templates_B9');
    vi.clearAllMocks();
    storage.getItem.mockResolvedValue({ data: { value: null } });
    await seedDefaultTypeTemplate(null, ME);
    expect(storage.setItem.mock.calls[0][0]).toBe('discussions_type_templates_default');
  });
});

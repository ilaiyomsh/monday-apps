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
  hasDefaultTypeTemplate,
  readStoredTypeTemplates,
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

/*
 * round348 (review finding) — `skipped-existing` used to cover two very different states, and
 * conflating them stranded an install: if the LABEL mutation failed once after the template was
 * written, every later wizard run read "skipped" and never retried the label, leaving an agenda
 * with no selectable type until someone recreated the label by hand with the exact same name.
 *
 * They are now distinct answers: OUR default already present ⇒ `already-default` (the label is
 * worth reconciling), the account's OWN types with ours absent ⇒ `skipped-existing` (leave the
 * established installation alone).
 */
describe('round348 — "our default is already there" is not "this account has its own types"', () => {
  it('answers already-default when the seeded type is in the store', async () => {
    storage.getItem.mockResolvedValue({
      data: { value: JSON.stringify({ templates: [{ id: 'x', discussionType: DEFAULT_DISCUSSION_TYPE, topics: [] }] }) },
    });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('already-default');
    // ...and still writes nothing: the template exists, only the label may be missing.
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('still answers skipped-existing for an account with only its OWN types', async () => {
    storage.getItem.mockResolvedValue({
      data: { value: JSON.stringify({ templates: [{ id: 'x', discussionType: 'הנהלה', topics: [] }] }) },
    });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('skipped-existing');
  });

  // Mixed store: ours among others still means "reconcile the label", not "leave it alone".
  it('finds our default among other types', async () => {
    storage.getItem.mockResolvedValue({
      data: { value: JSON.stringify({ templates: [
        { id: 'a', discussionType: 'הנהלה', topics: [] },
        { id: 'b', discussionType: DEFAULT_DISCUSSION_TYPE, topics: [] },
      ] }) },
    });
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('already-default');
  });

  it('hasDefaultTypeTemplate matches on the trimmed label text only', () => {
    expect(hasDefaultTypeTemplate([{ discussionType: `  ${DEFAULT_DISCUSSION_TYPE}  ` }])).toBe(true);
    expect(hasDefaultTypeTemplate([{ discussionType: 'דיון' }])).toBe(false);
    expect(hasDefaultTypeTemplate(null)).toBe(false);
    expect(hasDefaultTypeTemplate([{}, null])).toBe(false);
  });
});

/*
 * round349 (review finding) — "the list is empty" and "we could not read the list" must never be
 * the same answer. This is the shared primitive that keeps them apart, so neither seeding path can
 * mistake a timeout for an empty store and overwrite an account's real types.
 */
describe('round349 — readStoredTypeTemplates reports whether the READ succeeded', () => {
  it('ok with the stored list', async () => {
    storage.getItem.mockImplementation(async () => ({
      data: { value: JSON.stringify({ templates: [{ id: 'x', discussionType: 'הנהלה' }] }) },
    }));
    expect(await readStoredTypeTemplates(CTX)).toEqual({ ok: true, list: [{ id: 'x', discussionType: 'הנהלה' }] });
  });

  it('ok with an EMPTY list when there is genuinely nothing stored', async () => {
    expect(await readStoredTypeTemplates(CTX)).toEqual({ ok: true, list: [] });
  });

  // The distinction that matters: a failure is ok:false, never an empty ok:true.
  it('NOT ok when the read throws', async () => {
    storage.getItem.mockRejectedValue(new Error('storage down'));
    expect(await readStoredTypeTemplates(CTX)).toEqual({ ok: false, list: [] });
  });

  it('NOT ok on malformed stored JSON', async () => {
    storage.getItem.mockImplementation(async () => ({ data: { value: '{not json' } }));
    expect((await readStoredTypeTemplates(CTX)).ok).toBe(false);
  });

  // And the seed refuses to write on an unprovable read.
  it('seedDefaultTypeTemplate writes nothing when the read is unprovable', async () => {
    storage.getItem.mockRejectedValue(new Error('storage down'));
    expect(await seedDefaultTypeTemplate(CTX, ME)).toBe('failed');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

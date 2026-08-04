/*
 * round347 (owner spec) — the ONE discussion type an install ships with, and its template.
 *
 * A fresh install used to land with an empty type list and no template, so the first thing
 * every new account had to do was invent both. The owner's spec is a concrete starting point:
 * one type, "דיון כללי", with a three-topic agenda, and the installing user pre-filled as
 * BOTH מנהל הדיון and מרכז הדיון — the two roles that carry the discussion-tier permissions,
 * so an install is immediately usable by the person who set it up.
 *
 * TWO separate places have to agree for a type to exist, which is why this is its own module:
 *   1. the LABEL on the account-level managed "סוג דיון" dropdown (that is what a discussion
 *      actually stores), added via the app's own `addDropdownLabel`;
 *   2. the TYPE TEMPLATE in monday.storage (topics/points/roles), keyed by the label TEXT.
 * Seeding one without the other gives a type with no agenda, or an agenda for a type nobody
 * can select.
 *
 * Deliberately NOT a migration: seeding only ever runs when the type-template store is EMPTY,
 * so it cannot overwrite an account that already built its own types.
 */
import { monday } from './mondayApi/monday-client.js';
import { sanitizeTypeTemplate } from './templates.js';
import logger from './logger.js';

const MODULE = 'defaultTypeTemplate';

// Must match TemplatesContext's TYPE_STORAGE_KEY_BASE + key fallback order.
const TYPE_STORAGE_KEY_BASE = 'discussions_type_templates';

/*
 * round347 (review finding) — the SAME 5s bound the rest of the storage layer uses.
 * `monday.storage` is an iframe bridge: a call that never settles leaves this function
 * awaited forever, and with it the install's "מקים את המערכת עבורך…" phase — so the
 * fail-soft catch below could never actually run. A bound is what makes it fail-soft.
 */
const STORAGE_TIMEOUT_MS = 5000;

function withTimeout(promise, ms = STORAGE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('storage timeout')), ms)),
  ]);
}

export const DEFAULT_DISCUSSION_TYPE = 'דיון כללי';

/*
 * The agenda, verbatim from the owner's spec. Order matters — it is the order the topics and
 * points are created in, i.e. the agenda a new discussion of this type opens with.
 */
export const DEFAULT_TYPE_TEMPLATE_TOPICS = [
  {
    name: 'פתיחה',
    points: ['עדכוני מנהל', 'מעבר על החלטות/משימות מדיון קודם', 'תודות'],
  },
  {
    name: 'עיקרי הדיון',
    points: [
      'סקירת עמידה בתוכניות עבודה',
      'לו"ז 3 חודשים קדימה',
      'לקחים מהשבוע החולף',
      'עדכוני מטה',
    ],
  },
  {
    name: 'סיכום',
    points: ['סדר עדיפויות להמשך', 'תיאום הדיון הבא'],
  },
];

function typeStorageKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${TYPE_STORAGE_KEY_BASE}_${instanceId}`;
}

/**
 * The seed type template. `installer` is the user running the install — placed in BOTH
 * `lead` and `coordinator` per the owner's spec. A missing/anonymous installer yields empty
 * role lists rather than a junk person: a template with `{id: undefined}` in a people list
 * would be written to a real board column later.
 *
 * Pure. Runs through `sanitizeTypeTemplate` so the stored shape can never drift from what
 * TemplatesContext reads back.
 */
export function buildDefaultTypeTemplate(installer, id = 'seed-default-type') {
  const person = installer?.id != null
    ? [{ id: installer.id, kind: 'person', name: installer.name || '' }]
    : [];
  return sanitizeTypeTemplate({
    discussionType: DEFAULT_DISCUSSION_TYPE,
    lead: person,
    coordinator: person,
    participants: [],
    // The "decider = discussion lead" default is a GLOBAL preference (round340 §6); leaving
    // the per-type flag off keeps one source of truth instead of two that can disagree.
    deciderIsLead: false,
    exportTemplate: null,
    topics: DEFAULT_TYPE_TEMPLATE_TOPICS,
  }, id);
}

/** Does this stored list already contain OUR default type? Matched by the label TEXT — that is
 * the key a type template is stored under. */
export function hasDefaultTypeTemplate(list) {
  return (Array.isArray(list) ? list : [])
    .some((t) => String(t?.discussionType || '').trim() === DEFAULT_DISCUSSION_TYPE);
}

/**
 * Write the seed template — ONLY into an empty store.
 *
 * @returns {Promise<'seeded'|'already-default'|'skipped-existing'|'failed'>} what happened.
 *   The caller needs all four apart (round348 review finding): `already-default` means the
 *   template is there but the LABEL may still be missing — if the label mutation failed once,
 *   every later run used to read `skipped-existing` and never retry, leaving an orphaned agenda
 *   with no selectable type. `skipped-existing` (the account's OWN types, ours absent) must
 *   still leave an established installation alone.
 */
export async function seedDefaultTypeTemplate(context, installer) {
  const key = typeStorageKey(context);
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.value) {
      const saved = JSON.parse(res.data.value);
      const list = Array.isArray(saved) ? saved : saved?.templates || [];
      // Any existing type template means this account already has types — never clobber. But
      // OUR default being among them is a different answer: see the return contract above.
      if (list.length) return hasDefaultTypeTemplate(list) ? 'already-default' : 'skipped-existing';
    }
    const template = buildDefaultTypeTemplate(installer);
    await withTimeout(monday.storage.setItem(key, JSON.stringify({ templates: [template] })));
    logger.info(MODULE, 'נזרעה תבנית סוג הדיון "דיון כללי"', {
      topics: template.topics.length,
      lead: template.lead.length,
    });
    return 'seeded';
  } catch (err) {
    // The install itself is fine without it — the owner can build the template by hand — so
    // this reports and moves on rather than failing a completed install.
    logger.warn(MODULE, 'זריעת תבנית סוג הדיון נכשלה — ניתן ליצור אותה ידנית בתבניות', err);
    return 'failed';
  }
}

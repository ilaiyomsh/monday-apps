// The summary email's BLOCK MODEL (0.15.0, owner decisions 2026-08-05) — pure,
// no I/O, shared by both renderers, the config validator and the admin state.
//
// WHAT CHANGED. Until 0.13.x the digest body was hard-coded: a greeting, an
// instruction paragraph, the clusters, a footer — the operator could only choose
// the clusters. Now the body is an ORDERED list of blocks the operator authors:
//
//   text block     — free text with block-level formatting (direction, font,
//                    size, alignment, color, bold), exactly the controls the
//                    single (non-digest) email's template editor offers.
//   cluster block  — one מקבץ: the date column, the action buttons, the status
//                    condition and the optional required-note column. Same
//                    settings the old `sections` array held, now carried by the
//                    block itself.
//
// The renderers emit NOTHING of their own beyond operational chrome (column
// headers, the status caption, amp-form's submitting/✓/error strips). Every
// sentence in the mail comes from a block.
//
// THREE INVARIANTS THIS MODULE OWNS:
//
// 1. BLOCK ORDER IS CLUSTER PRIORITY. `sections` remains the projection the
//    digest pipeline consumes (digest-service classifies and dedups per
//    section), and it is derived from the cluster blocks IN BLOCK ORDER — so
//    the ↑/↓ arrows that reorder the mail also reorder priority, with no second
//    field that could disagree. Never derive it from a stored `sections` copy
//    when blocks exist: that copy is a projection, not a source.
//
// 2. A LEGACY CONFIG KEEPS SENDING THE SAME MAIL. A config stored before this
//    feature has no `blocks` key at all, and the scheduler may send it for
//    months before the operator ever opens the admin. Reading one therefore
//    reconstructs the blocks that reproduce the 0.13.x email verbatim —
//    including the note hint, which appeared only when some cluster mapped a
//    note column. The generated ids are FIXED strings, not random: normalizing
//    the same legacy config twice must not produce two different documents.
//
// 3. A TOKEN VALUE IS DATA, NEVER MARKUP OR HEADERS. applyTokens substitutes
//    once (no re-scan, so a name containing a token cannot expand again) and
//    strips CR/LF, because the same function fills the SUBJECT line, where a
//    newline would be header injection. HTML escaping stays the renderer's job.

/** The one dynamic field, insertable in any text block and in the subject. */
export const NAME_TOKEN = '{{שם}}';
/** ASCII alias — survives a hand-edited settings export and bidi-mangled paste. */
export const NAME_TOKEN_ALIAS = '{{name}}';
const TOKEN_RE = /\{\{\s*(שם|name)\s*\}\}/g;

/**
 * Fonts offered for a text block. 'Default' is the sentinel for the document's
 * own stack (Figtree/Roboto/Noto Sans Hebrew) — what every pre-0.15.0 mail was
 * rendered in, so it has to stay reachable or the migration would restyle the
 * text it is meant to preserve. The renderer maps it; storage keeps the token.
 *
 * This list is also the SERVER-SIDE ALLOWLIST: a font name reaches the amp
 * document's <style> element, so an unvalidated one is CSS injection.
 */
export const DIGEST_FONTS = Object.freeze([
  'Default',
  'Arial',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
]);
export const DEFAULT_FONT = 'Default';
export const TEXT_DIRECTIONS = Object.freeze(['rtl', 'ltr']);
export const TEXT_ALIGNS = Object.freeze(['right', 'center', 'left']);

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;
/** Total blocks in one digest. A ceiling on the amp document, not a product rule. */
export const MAX_BLOCKS = 20;
/** Unchanged from 0.13.x — clusters drive board reads and the complexity budget. */
export const MAX_CLUSTER_BLOCKS = 4;
export const MAX_TEXT_LENGTH = 2000;

export const TEXT_BLOCK_ID_RE = /^x_[A-Za-z0-9_-]{4,16}$/;

const DEFAULT_TEXT_COLOR = '#323338';
const MUTED_TEXT_COLOR = '#676879';
const FOOTER_TEXT_COLOR = '#9699A6';

/**
 * The 0.13.x hard-coded body, as text. Kept here (and only here) so the
 * renderers can stop carrying content: reconstructing a legacy config is the
 * ONLY thing that still reads these.
 */
export const LEGACY_TEXTS = Object.freeze({
  greeting: `שלום ${NAME_TOKEN},`,
  lead: 'בכל משימה: לחצו על תגית הסטטוס ובחרו מהתפריט. העדכון נשמר בלוח מיד — בלי כפתור שליחה ובלי לצאת מהמייל — וליד המשימה יופיע סימון אישור.',
  noteHint:
    'בשורות שיש בהן שדה טקסט — קודם ממלאים את השדה. לא ניתן לבחור סטטוס לפני שיש בו טקסט: התגית נעולה, ומשתחררת ברגע שהשדה מולא.',
  footer:
    'מייל אוטומטי · משימות שלא בחרתם בהן סטטוס לא משתנות · כל משימה מופיעה פעם אחת, במקבץ בעל העדיפות הגבוהה · אם הטופס אינו מוצג, עדכנו ישירות ב‑monday.com.',
});

/**
 * @param {unknown} block
 * @returns {boolean}
 */
export function isTextBlock(block) {
  return Boolean(block) && typeof block === 'object' && block.type === 'text';
}

/**
 * @param {unknown} block
 * @returns {boolean}
 */
export function isClusterBlock(block) {
  return Boolean(block) && typeof block === 'object' && block.type === 'cluster';
}

/**
 * Build a text block with every style field filled. Used for the legacy
 * reconstruction and as the tolerant read path for a stored block.
 * @param {object} p
 * @returns {object}
 */
function textBlock({ id, text, fontSize, color, bold = false, font = DEFAULT_FONT, direction = 'rtl', align = 'right' }) {
  return { type: 'text', id, text, direction, font, fontSize, align, color, bold };
}

/**
 * Normalize one stored text block: unknown/missing style fields fall back to
 * the defaults rather than reaching a renderer as undefined. The server
 * validator is the gate; this is the belt that keeps a hand-edited or
 * partially-migrated record renderable.
 * @param {object} raw
 * @param {number} index
 * @returns {object}
 */
function normalizeTextBlock(raw, index) {
  const fontSize = Number(raw.fontSize);
  return textBlock({
    id: typeof raw.id === 'string' && TEXT_BLOCK_ID_RE.test(raw.id) ? raw.id : `x_block${index}`,
    text: typeof raw.text === 'string' ? raw.text : '',
    direction: TEXT_DIRECTIONS.includes(raw.direction) ? raw.direction : 'rtl',
    font: DIGEST_FONTS.includes(raw.font) ? raw.font : DEFAULT_FONT,
    fontSize: Number.isFinite(fontSize)
      ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)))
      : 14,
    align: TEXT_ALIGNS.includes(raw.align) ? raw.align : 'right',
    color: /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : DEFAULT_TEXT_COLOR,
    bold: raw.bold === true,
  });
}

/**
 * Normalize one cluster block / stored section into a cluster block.
 * @param {object} raw
 * @returns {object}
 */
function normalizeClusterBlock(raw) {
  const buttonIds =
    Array.isArray(raw.buttonIds) && raw.buttonIds.length > 0
      ? [...raw.buttonIds]
      : raw.buttonId
        ? [raw.buttonId]
        : [];
  return {
    type: 'cluster',
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    dateColumnId: raw.dateColumnId ?? null,
    dateColumnTitle: raw.dateColumnTitle ?? '',
    noteColumnId: raw.noteColumnId ?? null,
    noteColumnTitle: raw.noteColumnTitle ?? '',
    buttonId: buttonIds[0] ?? raw.buttonId ?? null,
    buttonIds,
    includeStatusLabelIds: Array.isArray(raw.includeStatusLabelIds)
      ? [...raw.includeStatusLabelIds]
      : [],
  };
}

/**
 * Reconstruct the 0.13.x email as blocks: greeting, lead, [note hint], the
 * clusters in stored order, footer. The note hint is conditional exactly as the
 * renderer's was — a tenant that maps no note column never saw it, and must not
 * start seeing it now.
 *
 * @param {Array<object>} sections stored digest sections
 * @returns {Array<object>}
 */
export function legacyBlocksFromSections(sections) {
  const clusters = (Array.isArray(sections) ? sections : []).map(normalizeClusterBlock);
  const notesInPlay = clusters.some(
    (c) => typeof c.noteColumnId === 'string' && c.noteColumnId.length > 0
  );
  return [
    // 18px bold #323338 — the .hi rule of the 0.13.x document.
    textBlock({ id: 'x_legacyhi', text: LEGACY_TEXTS.greeting, fontSize: 18, color: DEFAULT_TEXT_COLOR, bold: true }),
    // 14px #676879 — .lead
    textBlock({ id: 'x_legacylead', text: LEGACY_TEXTS.lead, fontSize: 14, color: MUTED_TEXT_COLOR }),
    ...(notesInPlay
      ? [textBlock({ id: 'x_legacynote', text: LEGACY_TEXTS.noteHint, fontSize: 14, color: MUTED_TEXT_COLOR })]
      : []),
    ...clusters,
    // 12px #9699A6 — .foot (its hairline separator is chrome, and is not a block)
    textBlock({ id: 'x_legacyfoot', text: LEGACY_TEXTS.footer, fontSize: 12, color: FOOTER_TEXT_COLOR }),
  ];
}

/**
 * The digest body as an ordered block list.
 *
 * A digest that carries `blocks` is authoritative — including an EMPTY array,
 * which is a legal (if bare) email and must not silently regrow the legacy
 * text. Only the absence of the key means "never migrated".
 *
 * @param {object|null|undefined} digest stored digest config
 * @returns {Array<object>} normalized blocks (text | cluster)
 */
export function normalizeDigestBlocks(digest) {
  if (Array.isArray(digest?.blocks)) {
    const out = [];
    digest.blocks.forEach((raw, index) => {
      if (isTextBlock(raw)) out.push(normalizeTextBlock(raw, index));
      else if (isClusterBlock(raw)) out.push(normalizeClusterBlock(raw));
      // Anything else is a block type this version does not know how to render.
      // Dropping it is the safe read: an unrenderable block must not reach the
      // document, and a config it came from is not ours to rewrite.
    });
    return out;
  }
  return legacyBlocksFromSections(digest?.sections);
}

/**
 * @param {Array<object>} blocks
 * @returns {Array<object>} cluster blocks only, in order
 */
export function clusterBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter(isClusterBlock);
}

/**
 * The `sections` projection the digest pipeline consumes — cluster blocks in
 * BLOCK ORDER, with the discriminator dropped and the fields picked explicitly
 * (a block must never smuggle an unknown key into stored config).
 *
 * @param {Array<object>} blocks
 * @returns {Array<object>}
 */
export function sectionsFromBlocks(blocks) {
  return clusterBlocks(blocks).map((c) => ({
    id: c.id,
    title: c.title,
    dateColumnId: c.dateColumnId,
    dateColumnTitle: c.dateColumnTitle,
    noteColumnId: c.noteColumnId ?? null,
    noteColumnTitle: c.noteColumnTitle ?? '',
    buttonId: c.buttonId,
    buttonIds: [...c.buttonIds],
    includeStatusLabelIds: [...c.includeStatusLabelIds],
  }));
}

/**
 * Substitute the dynamic field(s) in one authored string.
 *
 * Single pass by construction (a replacer function, so the substituted value is
 * never re-scanned) and CR/LF-stripped, because this same call fills the Subject
 * header where a newline is header injection. Escaping for the target medium is
 * the caller's job — this returns TEXT.
 *
 * @param {string} text
 * @param {{ name?: string }} ctx
 * @returns {string}
 */
export function applyTokens(text, ctx) {
  if (typeof text !== 'string' || text.length === 0) return '';
  const value = String(ctx?.name ?? '').replace(/[\r\n]+/g, ' ');
  return text.replace(TOKEN_RE, () => value);
}

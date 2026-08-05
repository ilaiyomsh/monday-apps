// Client-side mirror of the digest BLOCK model (0.14.0).
//
// WHY A MIRROR AND NOT AN IMPORT. The authority is
// `src/services/digest-blocks.js` — server code, plain ESM, no Node APIs, so it
// COULD be bundled here. It is not, for the same reason the error-kit copies are
// not: pulling server source into the SPA's typed graph would need `allowJs` on
// the shared tsconfig and would leave this boundary untyped. Instead the two
// stay behaviorally identical and `tests/digest-blocks-client-drift.test.js`
// fails the build if they drift — the house pattern
// (packages/error-kit/test/drift.test.ts).
//
// What lives here is only what the ADMIN needs: the token (insert button +
// preview), the caps the editor enforces before the server does, and the legacy
// reconstruction — needed because importing a settings export taken before
// 0.14.0 hands this code a digest with `sections` and no `blocks` (GET
// /api/state never does: the server normalizes on the way out).

import type { DigestBlock, DigestSectionConfig, DigestTextBlock } from './types';

/** The one dynamic field. Insertable in any text block and in the subject. */
export const NAME_TOKEN = '{{שם}}';
const TOKEN_RE = /\{\{\s*(שם|name)\s*\}\}/g;

export const DEFAULT_FONT = 'Default';
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;
export const MAX_DIGEST_BLOCKS = 20;
export const MAX_DIGEST_CLUSTERS = 4;
export const MAX_DIGEST_TEXT_LENGTH = 2000;

export const DEFAULT_TEXT_COLOR = '#323338';
const MUTED_TEXT_COLOR = '#676879';
const FOOTER_TEXT_COLOR = '#9699A6';

/** The 0.13.x hard-coded email, as text (see the server module's LEGACY_TEXTS). */
export const LEGACY_TEXTS = {
  greeting: `שלום ${NAME_TOKEN},`,
  lead: 'בכל משימה: לחצו על תגית הסטטוס ובחרו מהתפריט. העדכון נשמר בלוח מיד — בלי כפתור שליחה ובלי לצאת מהמייל — וליד המשימה יופיע סימון אישור.',
  noteHint:
    'בשורות שיש בהן שדה טקסט — קודם ממלאים את השדה. לא ניתן לבחור סטטוס לפני שיש בו טקסט: התגית נעולה, ומשתחררת ברגע שהשדה מולא.',
  footer:
    'מייל אוטומטי · משימות שלא בחרתם בהן סטטוס לא משתנות · כל משימה מופיעה פעם אחת, במקבץ בעל העדיפות הגבוהה · אם הטופס אינו מוצג, עדכנו ישירות ב‑monday.com.',
} as const;

/**
 * Resolve the dynamic field for a PREVIEW. Single pass (the substituted value is
 * never re-scanned) and CR/LF-stripped, matching the server exactly — the admin
 * must not show a subject the send path would not produce.
 */
export function applyTokens(text: string, ctx: { name?: string }): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const value = String(ctx?.name ?? '').replace(/[\r\n]+/g, ' ');
  return text.replace(TOKEN_RE, () => value);
}

/**
 * True when the string carries the dynamic field (drives the editor's hint).
 *
 * Its own NON-GLOBAL regex on purpose: `RegExp.test` on a /g pattern advances
 * `lastIndex` on the shared object, so reusing TOKEN_RE here made every second
 * call on the same text answer false — measured, not theorized (the test that
 * calls it twice is exactly that case).
 */
const TOKEN_TEST_RE = /\{\{\s*(שם|name)\s*\}\}/;
export function hasNameToken(text: string): boolean {
  return TOKEN_TEST_RE.test(text);
}

/**
 * Insert `token` over the selection [start, end) — the "הוסף שם משתמש" button.
 * Returns the new text and where the caret belongs, so the caller can restore it
 * (a React-controlled textarea otherwise jumps to the end).
 */
export function insertAt(
  text: string,
  start: number,
  end: number,
  token: string = NAME_TOKEN
): { text: string; caret: number } {
  const len = text.length;
  // Clamp defensively: a detached/unfocused field reports null selections, which
  // callers turn into whatever they have — appending is the sane fallback.
  const from = Number.isInteger(start) ? Math.min(Math.max(start, 0), len) : len;
  const to = Number.isInteger(end) ? Math.min(Math.max(end, from), len) : from;
  return {
    text: `${text.slice(0, from)}${token}${text.slice(to)}`,
    caret: from + token.length,
  };
}

const textBlock = (
  id: string,
  text: string,
  fontSize: number,
  color: string,
  bold = false
): DigestTextBlock => ({
  type: 'text',
  id,
  text,
  direction: 'rtl',
  font: DEFAULT_FONT,
  fontSize,
  align: 'right',
  color,
  bold,
});

/**
 * Rebuild the 0.13.x email as blocks: greeting, lead, [note hint], the clusters
 * in stored order, footer. Ids are FIXED, not random — two reads of the same
 * legacy config must produce the same blocks.
 */
export function legacyBlocksFromSections(sections: DigestSectionConfig[] | undefined): DigestBlock[] {
  const clusters: DigestBlock[] = (sections ?? []).map((s) => ({ ...s, type: 'cluster' as const }));
  const notesInPlay = (sections ?? []).some(
    (s) => typeof s.noteColumnId === 'string' && s.noteColumnId.length > 0
  );
  return [
    textBlock('x_legacyhi', LEGACY_TEXTS.greeting, 18, DEFAULT_TEXT_COLOR, true),
    textBlock('x_legacylead', LEGACY_TEXTS.lead, 14, MUTED_TEXT_COLOR),
    ...(notesInPlay ? [textBlock('x_legacynote', LEGACY_TEXTS.noteHint, 14, MUTED_TEXT_COLOR)] : []),
    ...clusters,
    textBlock('x_legacyfoot', LEGACY_TEXTS.footer, 12, FOOTER_TEXT_COLOR),
  ];
}

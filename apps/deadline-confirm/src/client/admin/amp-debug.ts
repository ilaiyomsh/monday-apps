// Pure rules behind the AMP debug editor in DigestSection (owner ask
// 2026-08-02): the preview hands over the exact amp4email document the server
// built, the admin edits it in place, and POST /api/digest/send-raw ships those
// bytes. These helpers are what the component asks before it lets a send go.
//
// The size rule is not cosmetic: Gmail rejects a text/x-amp-html part over
// 100KB outright, and that rejection looks exactly like the INTERNAL_ERROR
// we are trying to bisect — so the editor says it out loud instead.

/** Gmail's documented ceiling for the amp4email part. */
export const AMP_PART_LIMIT_BYTES = 100_000;

/** Same shape the server's `to` guard uses — one @, no spaces, no header break. */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** UTF-8 byte length — Hebrew content makes the character count a lie. */
export function ampByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Hebrew warning when the document exceeds Gmail's AMP-part ceiling, else null. */
export function ampSizeWarning(text: string): string | null {
  const bytes = ampByteLength(text);
  if (bytes <= AMP_PART_LIMIT_BYTES) return null;
  return `המסמך שוקל ${(bytes / 1024).toFixed(1)}KB — מעל תקרת ה-AMP של ג׳ימייל (100KB). ג׳ימייל ידחה את החלק הדינמי.`;
}

/** Client-side guard before POST /api/digest/send-raw. Returns Hebrew text or null. */
export function validateRawSend({ amp, to }: { amp: string; to: string }): string | null {
  if (amp.trim().length === 0) return 'תיבת הקוד ריקה — אין מה לשלוח.';
  if (!EMAIL_RE.test(to.trim())) return 'כתובת נמען לא תקינה.';
  return null;
}

/** Subject for a debug send: the configured digest subject, or a marked fallback. */
export function defaultDebugSubject(configured: string | null | undefined): string {
  const trimmed = (configured ?? '').trim();
  return trimmed.length > 0 ? trimmed : '[AMP debug] מייל מסכם';
}

/**
 * MIME part orders the debug lane can send (mirrors PART_ORDERS on the server,
 * which REFUSES anything it does not recognize — a drifted string here shows up
 * as a 400 on a send the operator believed was a valid variant).
 *
 * These exist for ONE experiment: the message Gmail was observed to render
 * differed from ours in both the part order and the sending identity, so the
 * current order is a hypothesis with two variables in it. Sending the same
 * document from the same mailbox in all three structures is what separates them.
 * `plain-amp-html` is the default and the only order production uses.
 */
export const PART_ORDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'plain-amp-html', label: 'plain → amp → html (ברירת מחדל — מה שנתפס כמרנדר)' },
  { value: 'plain-html-amp', label: 'plain → html → amp (הטענה הנגדית: AMP אחרון)' },
  { value: 'plain-amp', label: 'plain → amp (שני חלקים — הביקורת שקיבלה INTERNAL_ERROR)' },
];

export const DEFAULT_PART_ORDER = 'plain-amp-html';

/** True for a value the server will accept as an order. */
export function isPartOrder(value: string): boolean {
  return PART_ORDER_OPTIONS.some((o) => o.value === value);
}

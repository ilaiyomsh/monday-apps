// V6 §5 MIME assembly — multipart/alternative with THREE parts as of 0.10.3:
// text/plain → text/x-amp-html → text/html. Pure: no network, no storage. The
// Gmail send funnel (T9) wraps this body into an RFC822 message; this helper
// only builds the alternative parts.
//
// THE ORDER IS EVIDENCE, NOT TASTE. It mirrors the one message we have ever
// observed Gmail render our AMP document from — the AMP playground's send of
// the identical document, captured 2026-07-29 — which came through as
// plain, then x-amp-html, then html. Our own 2-part message (plain + amp, no
// text/html) was answered with INTERNAL_ERROR, Gmail's documented catch-all
// ("Something unexpected happened in Gmail").
//
// Google's docs say the html part should not be required: MALFORMED is defined
// as "more than one text/x-amp-html part OR no fallback text/html or
// text/plain part", so text/plain alone satisfies the written rule. The html
// part is therefore a HYPOTHESIS UNDER TEST for the INTERNAL_ERROR — do not
// remove it as dead weight without re-running that experiment. It also earns
// its place independently: per Gmail's tips page the inbox preheader is taken
// from the text/html or text/plain part.
//
// The html part is DERIVED from the plain part (digest-html-fallback.js) and is
// inert — no anchors, forms, scripts or remote images. V6's D1/D2 bans an
// ACTIONABLE text/html body (the /confirm link family that put a secret in a
// URL), not an html body.
//
// Both parts are BASE64, not 8bit. That is load-bearing, not tidiness — it is
// the fix for Gmail answering INTERNAL_ERROR on the dynamic part while the
// fallback rendered fine (0.10.1):
//
//  1. The rendered AMP document comes from a template literal, so its line
//     endings are bare LF. RFC 5322 requires CRLF in a message body, so an
//     8bit part shipped a body that was not syntactically a valid body. The
//     plain-text fallback survived it — short, and clients are forgiving —
//     while Gmail's amp4email parser refused the AMP part.
//  2. The content is Hebrew. `8bit` declares raw octets above 127, which needs
//     8BITMIME support along the entire delivery path.
//
// Base64 closes both at once: 7-bit safe, wrapped at 76 octets with real CRLF,
// and — the property that actually matters — it carries the AMP document's
// bytes through UNCHANGED. Nothing downstream can rewrite a line ending inside
// a base64 payload, so what Gmail decodes is exactly what was rendered.

import crypto from 'node:crypto';
import { renderHtmlFallback } from './digest-html-fallback.js';

/** RFC 2045 §6.8: base64 lines are at most 76 characters. */
const BASE64_LINE_LENGTH = 76;

/**
 * Selectable part orders — a DEBUG-lane knob, not a production setting.
 *
 * The order above is a hypothesis with TWO variables in it: the message that
 * rendered differed from ours in the part order AND in the sending identity /
 * DKIM. A competing claim says the AMP part must come LAST, which is also the
 * more literal reading of multipart/alternative (the last part is the most
 * preferred). Settling that needs the same document sent from the same mailbox
 * with only the order changed — that is what these are for.
 *
 * `plain-amp-html` stays the DEFAULT and the only order production sending uses,
 * because it is the one backed by the captured message. Nothing here changes
 * that until an experiment says otherwise.
 *
 * - plain-amp-html — current default; the captured, rendering order.
 * - plain-html-amp — the competing claim: AMP last.
 * - plain-amp      — the 2-part message that got INTERNAL_ERROR (control).
 */
export const PART_ORDERS = ['plain-amp-html', 'plain-html-amp', 'plain-amp'];

export const DEFAULT_PART_ORDER = 'plain-amp-html';

/**
 * UTF-8 → base64, wrapped at 76 characters with CRLF separators.
 * @param {string} text
 * @returns {string}
 */
function encodeBase64Body(text) {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  const lines = [];
  for (let offset = 0; offset < encoded.length; offset += BASE64_LINE_LENGTH) {
    lines.push(encoded.slice(offset, offset + BASE64_LINE_LENGTH));
  }
  return lines.join('\r\n');
}

/**
 * @param {{ plain: string, amp: string, order?: string }} p
 *   `order` is a debug-lane knob (see PART_ORDERS); omit it for production.
 * @returns {{ contentType: string, body: string }}
 */
export function buildMultipartAlternative({ plain, amp, order = DEFAULT_PART_ORDER }) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('buildMultipartAlternative: plain part is required');
  }
  if (typeof amp !== 'string' || amp.length === 0) {
    throw new Error('buildMultipartAlternative: amp part is required');
  }
  // Never fall back to the default on an unknown value: an experiment that
  // silently reported the wrong variant is worse than no experiment, because
  // the conclusion would look supported.
  if (!PART_ORDERS.includes(order)) {
    throw new Error(`buildMultipartAlternative: unknown part order "${order}"`);
  }
  const boundary = `dc_${crypto.randomBytes(12).toString('hex')}`;
  /** @param {string} contentType @param {string} payload */
  const part = (contentType, payload) =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64Body(payload),
      '',
    ].join('\r\n');
  const plainPart = part('text/plain', plain);
  const ampPart = part('text/x-amp-html', amp);
  const htmlPart = part('text/html', renderHtmlFallback(plain));
  const bodyParts =
    order === 'plain-html-amp'
      ? [plainPart, htmlPart, ampPart]
      : order === 'plain-amp'
        ? [plainPart, ampPart]
        : [plainPart, ampPart, htmlPart];
  const parts = [...bodyParts, `--${boundary}--\r\n`];
  return {
    contentType: `multipart/alternative; boundary="${boundary}"`,
    body: parts.join(''),
  };
}

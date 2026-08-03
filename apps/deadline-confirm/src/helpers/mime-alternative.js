// V6 §5 MIME assembly — multipart/alternative with THREE parts as of 0.10.3:
// text/plain → text/x-amp-html → text/html. Pure: no network, no storage. The
// Gmail send funnel (T9) wraps this body into an RFC822 message; this helper
// only builds the alternative parts.
//
// THE ORDER IS NOT THE INTERNAL_ERROR FIX — that hypothesis was DISPROVEN by
// live sends on 2026-08-03 (docs/amp-email-verified-findings.md). A 5-variant
// matrix — no extensions / 2 parts only / quoted-printable / `⚡4email` spelling
// / amp-before-plain — failed IDENTICALLY, which is what a sender-side condition
// looks like, not a MIME one. The real causes were the send channel (the Gmail
// API strips the text/x-amp-html part on external delivery) and the sender
// domain's SPF. Do not re-litigate the ordering as an INTERNAL_ERROR remedy.
//
// The order and the html part still earn their place on their own merits:
// Google's docs define MALFORMED as "more than one text/x-amp-html part OR no
// fallback text/html or text/plain part", so text/plain alone satisfies the
// written rule — but per Gmail's tips page the inbox preheader is taken from the
// text/html or text/plain part, and some clients render only the LAST part, which
// is why the inert html part goes last. Keep it.
//
// The html part is DERIVED from the plain part (digest-html-fallback.js) and is
// inert — no anchors, forms, scripts or remote images. V6's D1/D2 bans an
// ACTIONABLE text/html body (the /confirm link family that put a secret in a
// URL), not an html body.
//
// Both parts are BASE64, not 8bit. This too was once believed to be the
// INTERNAL_ERROR fix (0.10.1) and is NOT — quoted-printable failed identically in
// the 2026-08-03 matrix. Base64 stays because the reasons below are correct on
// their own terms, independent of that error:
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
 * @param {{ plain: string, amp: string }} p
 * @returns {{ contentType: string, body: string }}
 */
export function buildMultipartAlternative({ plain, amp }) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('buildMultipartAlternative: plain part is required');
  }
  if (typeof amp !== 'string' || amp.length === 0) {
    throw new Error('buildMultipartAlternative: amp part is required');
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
  const parts = [
    part('text/plain', plain),
    part('text/x-amp-html', amp),
    part('text/html', renderHtmlFallback(plain)),
    `--${boundary}--\r\n`,
  ];
  return {
    contentType: `multipart/alternative; boundary="${boundary}"`,
    body: parts.join(''),
  };
}

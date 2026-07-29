// V6 §5 MIME assembly — multipart/alternative with text/plain first and
// text/x-amp-html second. No text/html part (actionable HTML is retired).
// Pure: no network, no storage. The Gmail send funnel (T9) wraps this body
// into an RFC822 message; this helper only builds the alternative parts.
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
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64Body(plain),
      '',
    ].join('\r\n'),
    [
      `--${boundary}`,
      'Content-Type: text/x-amp-html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64Body(amp),
      '',
    ].join('\r\n'),
    `--${boundary}--\r\n`,
  ];
  return {
    contentType: `multipart/alternative; boundary="${boundary}"`,
    body: parts.join(''),
  };
}

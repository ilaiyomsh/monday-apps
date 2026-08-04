// RFC822 message assembly + header-injection refusal, extracted VERBATIM from
// services/gmail-sender.js so the SMTP XOAUTH2 channel (the wired send path —
// docs/amp-email-verified-findings.md §2) and the kept-for-reference Gmail API
// sender build byte-identical messages. Pure: no network, no storage.
//
// The extraction preserves two load-bearing behaviors, both characterized by
// tests/gmail-sender*.test.js:
//  - the multipart body (helpers/mime-alternative.js) passes through
//    BYTE-FOR-BYTE — the AMP part must not be re-encoded or re-wrapped, or
//    Gmail rejects it as invalid AMP;
//  - no mime → a text/plain-only message (the D8 operator summary), NEVER a
//    single-part multipart, which some clients render as an attachment.
//
// One addition over the extraction source: an OPTIONAL `date` parameter emits
// a `Date:` header (RFC5322). The Gmail API stamped Date itself, so the Gmail
// sender omits it (keeping its output byte-identical to before the
// extraction); raw SMTP stamps nothing, so the SMTP sender passes it — a
// missing Date is a spam signal and Gmail appends its own at delivery,
// outside our control.

/** CR/LF in a header value is header injection — never sanitize, always refuse. */
const HEADER_UNSAFE_RE = /[\r\n]/;

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Refuse header injection through the two caller-controlled header values.
 * Error codes are seam contract: invalid_recipient / invalid_subject.
 * @param {{ to: unknown, subject: unknown }} p
 * @returns {string} the subject to use (a non-string subject becomes '')
 */
export function assertHeaderSafe({ to, subject }) {
  if (typeof to !== 'string' || to.length === 0 || HEADER_UNSAFE_RE.test(to)) {
    throw fail('invalid_recipient', 'recipient address is missing or contains a header break');
  }
  const subjectText = typeof subject === 'string' ? subject : '';
  if (HEADER_UNSAFE_RE.test(subjectText)) {
    throw fail('invalid_subject', 'subject contains a header break');
  }
  return subjectText;
}

/**
 * RFC2047 base64 word for a header value that is not pure ASCII. Raw 8-bit
 * bytes in a header are illegal and Gmail renders them as mojibake — Hebrew
 * subjects hit this on every message.
 * @param {string} value
 * @returns {string}
 */
function encodeHeaderValue(value) {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * RFC5322 §3.3 date-time, always UTC (`+0000`, not the obsolete `GMT` that
 * Date.toUTCString() emits).
 * @param {Date} d
 * @returns {string}
 */
function rfc5322Date(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
  );
}

/**
 * Assemble the RFC822 message. The multipart body arrives already built by
 * helpers/mime-alternative.js and is passed through BYTE-FOR-BYTE.
 * @param {{ from: string, to: string, subject: string,
 *          mime?: { contentType: string, body: string }, plain?: string,
 *          date?: Date }} p - `date` emits a Date: header when present
 *          (SMTP channel: on; Gmail API channel: off — Gmail stamps its own).
 * @returns {string}
 */
export function buildRfc822({ from, to, subject, mime, plain, date }) {
  // No multipart → a plain-text-only message. The operator summary (D8) takes
  // this path: it has no AMP part, so wrapping it in multipart/alternative
  // would be a single-part multipart, which some clients render as an
  // attachment.
  const contentType = mime ? mime.contentType : 'text/plain; charset=UTF-8';
  const body = mime ? mime.body : String(plain ?? '');
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
  ];
  if (date) headers.push(`Date: ${rfc5322Date(date)}`);
  headers.push('MIME-Version: 1.0', `Content-Type: ${contentType}`);
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

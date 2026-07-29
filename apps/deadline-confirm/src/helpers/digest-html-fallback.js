// Non-actionable text/html fallback for the digest (0.10.3).
//
// WHY THIS EXISTS. Gmail refused our dynamic part with INTERNAL_ERROR
// ("Something unexpected happened in Gmail" — a documented catch-all with no
// diagnostic content) while the IDENTICAL AMP document rendered fine when the
// same bytes were sent through the AMP playground. Comparing the two delivered
// messages left exactly three differences; two are now eliminated (base64 was
// tried in 0.10.1 and changed nothing; auth headers need DNS we do not control
// yet), and this is the third: the message that rendered carried a text/html
// part, ours carried only text/plain.
//
// Google's own docs say this should not matter — MALFORMED is defined as "no
// fallback text/html OR text/plain part", so plain alone satisfies the stated
// requirement. This part is therefore a HYPOTHESIS TEST, not a documented fix.
// It is worth shipping regardless: per Gmail's "tips" page the inbox preheader
// is taken from the text/html or text/plain part, and a formatted fallback
// beats raw text in every non-AMP client.
//
// D1/D2 COMPATIBILITY. The locked V6 decision bans an ACTIONABLE text/html
// body — the /confirm link family that carried a secret in the URL. This part
// is derived from the plain-text digest, which by construction carries no
// links and no credentials, and nothing here introduces any: no anchors, no
// forms, no scripts, no remote images. That invariant is asserted in the tests,
// not just described here.

/** Ampersand first — otherwise the escapes of the other entities get escaped. */
const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const BODY_STYLE = [
  'margin:0',
  'padding:14px 10px',
  'background:#F5F6F8',
  'font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif',
  'color:#323338',
  'font-size:14px',
  'line-height:1.6',
].join(';');

const WRAP_STYLE = [
  'max-width:720px',
  'margin:0 auto',
  'background:#ffffff',
  'border:1px solid #E6E9EF',
  'border-radius:8px',
  'padding:18px',
].join(';');

/**
 * Render the plain-text digest as a minimal RTL HTML document.
 *
 * The plain text IS the content: this only escapes it and preserves its line
 * structure, so the HTML part can never say something the plain part does not.
 * A blank line in the source becomes vertical space, not an empty paragraph.
 *
 * @param {string} plain the already-rendered plain-text digest
 * @returns {string} a complete, self-contained, link-free HTML document
 */
export function renderHtmlFallback(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('renderHtmlFallback: plain part is required');
  }
  const lines = plain.replaceAll('\r\n', '\n').split('\n');
  const blocks = lines.map((line) =>
    line.trim() === ''
      ? '<div style="height:10px"></div>'
      : `<div>${escapeHtml(line)}</div>`
  );
  return [
    '<!doctype html>',
    '<html dir="rtl" lang="he">',
    '<head><meta charset="utf-8"></head>',
    `<body style="${BODY_STYLE}">`,
    `<div style="${WRAP_STYLE}">`,
    ...blocks,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}

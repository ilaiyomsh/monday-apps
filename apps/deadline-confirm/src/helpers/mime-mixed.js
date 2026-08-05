// multipart/mixed assembly — the wrapper an ATTACHMENT needs. Pure: no
// network, no storage.
//
// Why a second builder instead of extending mime-alternative.js: alternative
// and mixed mean opposite things. multipart/alternative offers a client several
// renderings of ONE body and it picks one; multipart/mixed says "body, plus
// these files" and the client shows all of them. A CSV added as a fourth
// alternative part would be treated as another candidate body — some clients
// would render it, most would drop it, and nobody would get a file.
//
// The nested case is the load-bearing one: a mixed message whose first part is
// the whole multipart/alternative body. That inner body is passed through
// BYTE-FOR-BYTE and carries no Content-Transfer-Encoding header of its own —
// its inner parts declare their own base64. Re-encoding or re-wrapping it is
// exactly what breaks the AMP part (docs/amp-email-verified-findings.md §2 —
// the Gmail API's own re-wrap is what strips it), so this builder must never
// touch the bytes it is handed.

import crypto from 'node:crypto';
import { encodeBase64Body } from './mime-alternative.js';

/** CR/LF/quote in a header parameter is header injection — refuse, never sanitize. */
const PARAM_UNSAFE_RE = /["\r\n]/;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Assemble a multipart/mixed body: one text body + one or more attachments.
 *
 * Exactly ONE body source is required — `plain` (a text/plain part built here)
 * or `alternative` (a pre-built multipart/alternative, nested verbatim).
 * Passing both is a caller bug, not a preference to resolve silently: the two
 * describe different messages and picking one would send something nobody asked
 * for.
 *
 * @param {object} p
 * @param {string} [p.plain] - text/plain body
 * @param {{ contentType: string, body: string }} [p.alternative] - nested verbatim
 * @param {Array<{ filename: string, contentType: string, content: string }>} p.attachments
 * @returns {{ contentType: string, body: string }}
 */
export function buildMultipartMixed({ plain, alternative, attachments }) {
  const hasPlain = typeof plain === 'string' && plain.length > 0;
  const hasAlternative = Boolean(alternative);
  if (hasPlain && hasAlternative) {
    throw fail('mixed_body_ambiguous', 'buildMultipartMixed: pass plain OR alternative, not both');
  }
  if (!hasPlain && !hasAlternative) {
    throw fail('mixed_body_missing', 'buildMultipartMixed: a plain or alternative body is required');
  }
  if (!Array.isArray(attachments) || attachments.length === 0) {
    // A single-part multipart/mixed is what several clients render AS an
    // attachment (the same trap rfc822.js avoids for the plain-only summary),
    // so an attachment-less call means the caller wanted a different builder.
    throw fail('mixed_no_attachments', 'buildMultipartMixed: at least one attachment is required');
  }

  const boundary = `dcm_${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];

  if (hasAlternative) {
    // No Content-Transfer-Encoding line and no re-encoding: the inner parts
    // already declare base64, and the inner body ends with its own closing
    // delimiter + CRLF, so the next boundary follows directly.
    chunks.push(
      `--${boundary}\r\nContent-Type: ${alternative.contentType}\r\n\r\n${alternative.body}`
    );
  } else {
    chunks.push(
      [
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        encodeBase64Body(plain),
        '',
      ].join('\r\n')
    );
  }

  for (const attachment of attachments) {
    const filename = attachment?.filename;
    const contentType = attachment?.contentType;
    if (typeof filename !== 'string' || filename.length === 0 || PARAM_UNSAFE_RE.test(filename)) {
      throw fail('invalid_attachment_filename', 'attachment filename is missing or contains a header break');
    }
    if (typeof contentType !== 'string' || contentType.length === 0 || PARAM_UNSAFE_RE.test(contentType)) {
      throw fail('invalid_attachment_type', 'attachment contentType is missing or contains a header break');
    }
    if (typeof attachment.content !== 'string') {
      throw fail('invalid_attachment_content', 'attachment content must be a string');
    }
    chunks.push(
      [
        `--${boundary}`,
        `Content-Type: ${contentType}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename}"`,
        '',
        encodeBase64Body(attachment.content),
        '',
      ].join('\r\n')
    );
  }

  chunks.push(`--${boundary}--\r\n`);
  return {
    contentType: `multipart/mixed; boundary="${boundary}"`,
    body: chunks.join(''),
  };
}

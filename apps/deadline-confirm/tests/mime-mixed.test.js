// Contract tests for multipart/mixed assembly — the wrapper that lets a
// message carry a FILE (the per-employee summary CSV, docs/scheduling.md §5.2).
//
// Two properties matter more than the rest and both have a measured reason:
//
//  1. A nested multipart/alternative passes through BYTE-FOR-BYTE, with no
//     Content-Transfer-Encoding of its own. Re-wrapping an alternative body is
//     precisely what strips the AMP part (findings §2 — the Gmail API's own
//     re-wrap did exactly that), so a mixed wrapper that re-encodes the inner
//     body would break the digest the day someone attaches a file to it.
//  2. The attachment's filename reaches a HEADER PARAMETER. A quote or CRLF in
//     it is header injection, so it is refused, never sanitized — same rule as
//     helpers/rfc822.js applies to To/Subject.

import { describe, it, expect } from 'vitest';
import { buildMultipartMixed } from '../src/helpers/mime-mixed.js';
import { buildMultipartAlternative } from '../src/helpers/mime-alternative.js';

const CSV = { filename: 'summary.csv', contentType: 'text/csv; charset=UTF-8', content: 'a,b\r\n1,2\r\n' };

/** Decode one part's payload by a distinguishing header line. */
function decodePart(body, headerLine) {
  const section = body.split(/--dcm_[0-9a-f]+/).find((s) => s.includes(headerLine));
  const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
  return Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

describe('buildMultipartMixed — envelope', () => {
  it('returns multipart/mixed with a boundary that opens and closes the body', () => {
    const { contentType, body } = buildMultipartMixed({ plain: 'report', attachments: [CSV] });
    expect(contentType).toMatch(/^multipart\/mixed; boundary="dcm_[0-9a-f]{24}"$/);
    const boundary = contentType.match(/boundary="([^"]+)"/)[1];
    expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('uses a fresh boundary per call, so two messages can never collide', () => {
    const a = buildMultipartMixed({ plain: 'x', attachments: [CSV] });
    const b = buildMultipartMixed({ plain: 'x', attachments: [CSV] });
    expect(a.contentType).not.toBe(b.contentType);
  });

  it('never uses the alternative builder’s dc_ boundary prefix (nesting must stay unambiguous)', () => {
    const { contentType } = buildMultipartMixed({ plain: 'x', attachments: [CSV] });
    const boundary = contentType.match(/boundary="([^"]+)"/)[1];
    expect(boundary.startsWith('dcm_')).toBe(true);
  });

  it('leaves NO bare LF anywhere in the assembled body (RFC 5322 requires CRLF)', () => {
    const { body } = buildMultipartMixed({
      plain: 'שורה\nשורה שנייה',
      attachments: [{ ...CSV, content: 'a,b\n1,2\n' }],
    });
    expect(/(?<!\r)\n/.test(body)).toBe(false);
  });
});

describe('buildMultipartMixed — text body + attachment', () => {
  it('emits the text/plain body first and the attachment after it', () => {
    const { body } = buildMultipartMixed({ plain: 'BODY', attachments: [CSV] });
    const bodyIdx = body.indexOf('Content-Type: text/plain');
    const fileIdx = body.indexOf('Content-Type: text/csv');
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeGreaterThan(bodyIdx);
  });

  it('round-trips a Hebrew text body unchanged through base64', () => {
    const plain = 'דוח שליחה\nשורה שנייה';
    const { body } = buildMultipartMixed({ plain, attachments: [CSV] });
    expect(decodePart(body, 'Content-Type: text/plain')).toBe(plain);
  });

  it('round-trips attachment bytes unchanged, UTF-8 BOM included', () => {
    const content = '﻿עובד,אימייל\r\nדנה,dana@example.com\r\n';
    const { body } = buildMultipartMixed({
      plain: 'x',
      attachments: [{ ...CSV, content }],
    });
    expect(decodePart(body, 'Content-Type: text/csv')).toBe(content);
  });

  it('declares the attachment as an attachment, with its filename on both headers', () => {
    const { body } = buildMultipartMixed({ plain: 'x', attachments: [CSV] });
    expect(body).toContain('Content-Type: text/csv; charset=UTF-8; name="summary.csv"');
    expect(body).toContain('Content-Disposition: attachment; filename="summary.csv"');
    expect(body).toContain('Content-Transfer-Encoding: base64');
  });

  it('emits one part per attachment when several are passed', () => {
    const { body } = buildMultipartMixed({
      plain: 'x',
      attachments: [CSV, { ...CSV, filename: 'second.csv', content: 'c,d\r\n' }],
    });
    expect(body.match(/Content-Disposition: attachment/g)).toHaveLength(2);
    expect(body).toContain('filename="summary.csv"');
    expect(body).toContain('filename="second.csv"');
  });

  it('keeps the assembled body free of raw non-ASCII octets', () => {
    const { body } = buildMultipartMixed({
      plain: 'עברית',
      attachments: [{ ...CSV, content: '﻿עברית' }],
    });
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(body)).toBe(false);
  });

  it('wraps attachment base64 at 76 characters (RFC 2045 §6.8)', () => {
    const { body } = buildMultipartMixed({
      plain: 'x',
      attachments: [{ ...CSV, content: 'y'.repeat(500) }],
    });
    const payloadLines = body.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{2,}$/.test(l));
    expect(payloadLines.length).toBeGreaterThan(1);
    for (const line of payloadLines) expect(line.length).toBeLessThanOrEqual(76);
  });
});

describe('buildMultipartMixed — nested multipart/alternative', () => {
  it('nests the alternative body BYTE-FOR-BYTE, with no re-encoding', () => {
    const alternative = buildMultipartAlternative({ plain: 'שלום', amp: '<html amp4email>\nx\n</html>' });
    const { body } = buildMultipartMixed({ alternative, attachments: [CSV] });
    expect(body).toContain(alternative.body);
  });

  it('declares the nested part with the alternative’s own Content-Type and inner boundary', () => {
    const alternative = buildMultipartAlternative({ plain: 'p', amp: 'a' });
    const innerBoundary = alternative.contentType.match(/boundary="([^"]+)"/)[1];
    const { body } = buildMultipartMixed({ alternative, attachments: [CSV] });
    expect(body).toContain(`Content-Type: ${alternative.contentType}\r\n\r\n--${innerBoundary}`);
  });

  it('gives the nested alternative NO Content-Transfer-Encoding of its own', () => {
    const alternative = buildMultipartAlternative({ plain: 'p', amp: 'a' });
    const { contentType, body } = buildMultipartMixed({ alternative, attachments: [CSV] });
    const outer = contentType.match(/boundary="([^"]+)"/)[1];
    const nestedHeaders = body.slice(
      body.indexOf(`--${outer}\r\n`) + outer.length + 3,
      body.indexOf('\r\n\r\n')
    );
    expect(nestedHeaders).toContain('multipart/alternative');
    expect(nestedHeaders).not.toContain('Content-Transfer-Encoding');
  });

  it('keeps the AMP part intact and single inside the mixed wrapper', () => {
    const amp = '<html amp4email>\n<body>שלום</body>\n</html>';
    const alternative = buildMultipartAlternative({ plain: 'שלום', amp });
    const { body } = buildMultipartMixed({ alternative, attachments: [CSV] });
    expect(body.match(/Content-Type: text\/x-amp-html/g)).toHaveLength(1);
    const section = body
      .split(/--dc_[0-9a-f]+/)
      .find((s) => s.includes('Content-Type: text/x-amp-html'));
    const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
    expect(Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8')).toBe(amp);
  });
});

describe('buildMultipartMixed — refusals', () => {
  it('refuses a call with no body source at all', () => {
    expect(() => buildMultipartMixed({ attachments: [CSV] })).toThrow(/plain or alternative/);
    try {
      buildMultipartMixed({ attachments: [CSV] });
    } catch (err) {
      expect(err.code).toBe('mixed_body_missing');
    }
  });

  it('refuses BOTH plain and alternative — the two describe different messages', () => {
    const alternative = buildMultipartAlternative({ plain: 'p', amp: 'a' });
    try {
      buildMultipartMixed({ plain: 'p', alternative, attachments: [CSV] });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('mixed_body_ambiguous');
    }
  });

  it('refuses an empty attachment list — a single-part mixed renders AS an attachment', () => {
    for (const attachments of [[], undefined, 'summary.csv']) {
      try {
        buildMultipartMixed({ plain: 'x', attachments });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err.code).toBe('mixed_no_attachments');
      }
    }
  });

  it('refuses a filename carrying a quote or CRLF instead of sanitizing it', () => {
    for (const filename of ['a"b.csv', 'a\r\nContent-Type: text/html', 'a\nb.csv', '', undefined]) {
      try {
        buildMultipartMixed({ plain: 'x', attachments: [{ ...CSV, filename }] });
        throw new Error(`should have thrown for ${JSON.stringify(filename)}`);
      } catch (err) {
        expect(err.code).toBe('invalid_attachment_filename');
      }
    }
  });

  it('refuses an attachment contentType carrying a quote or CRLF', () => {
    for (const contentType of ['text/csv"x', 'text/csv\r\nX-Evil: 1', '', undefined]) {
      try {
        buildMultipartMixed({ plain: 'x', attachments: [{ ...CSV, contentType }] });
        throw new Error(`should have thrown for ${JSON.stringify(contentType)}`);
      } catch (err) {
        expect(err.code).toBe('invalid_attachment_type');
      }
    }
  });

  it('refuses non-string attachment content rather than stringifying it', () => {
    try {
      buildMultipartMixed({ plain: 'x', attachments: [{ ...CSV, content: { a: 1 } }] });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('invalid_attachment_content');
    }
  });
});

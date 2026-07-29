// Contract tests for multipart/alternative MIME assembly (V6 §5).
// text/plain first, text/x-amp-html second. No text/html part. Bodies are
// quoted-printable-safe ASCII/UTF-8 payloads; the helper never injects
// credentials or /confirm links (those belong in the AMP renderer alone).

import { describe, it, expect } from 'vitest';
import { buildMultipartAlternative } from '../src/helpers/mime-alternative.js';

describe('buildMultipartAlternative (V6 §5)', () => {
  it('returns a multipart/alternative Content-Type with a boundary token', () => {
    const { contentType, body } = buildMultipartAlternative({
      plain: 'hello plain',
      amp: '<html amp4email>amp</html>',
    });
    expect(contentType).toMatch(/^multipart\/alternative; boundary="[^"]+"$/);
    const boundary = contentType.match(/boundary="([^"]+)"/)[1];
    expect(body).toContain(`--${boundary}`);
    expect(body).toContain(`--${boundary}--`);
  });

  it('emits text/plain FIRST and text/x-amp-html SECOND — never text/html', () => {
    const { contentType, body } = buildMultipartAlternative({
      plain: 'PLAIN_BODY',
      amp: 'AMP_BODY',
    });
    const boundary = contentType.match(/boundary="([^"]+)"/)[1];
    const plainIdx = body.indexOf('Content-Type: text/plain');
    const ampIdx = body.indexOf('Content-Type: text/x-amp-html');
    expect(plainIdx).toBeGreaterThan(-1);
    expect(ampIdx).toBeGreaterThan(plainIdx);
    expect(body).not.toContain('text/html');
    // Each part sits between its boundary markers, base64-encoded (see below).
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    expect(body).toContain(
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('PLAIN_BODY')}\r\n`
    );
    expect(body).toContain(
      `--${boundary}\r\nContent-Type: text/x-amp-html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('AMP_BODY')}\r\n`
    );
  });
});

// The 0.10.1 bug: both parts went out as `8bit`, and the rendered AMP document
// carries bare LF line endings because it comes from a template literal. RFC
// 5322 requires CRLF in a message body, so the AMP part was not a valid body.
// Gmail delivered the mail, rendered the plain fallback, and refused the
// dynamic part with INTERNAL_ERROR. These are the assertions that would have
// caught it.
describe('buildMultipartAlternative — transfer encoding (regression, 0.10.1)', () => {
  const AMP_WITH_LF = '<html amp4email>\n<body>שלום\nעולם</body>\n</html>';

  /** Pull one part's decoded payload back out of the assembled body. */
  function decodePart(body, contentType) {
    const section = body.split(/--dc_[0-9a-f]+/).find((s) => s.includes(contentType));
    const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
    return Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8');
  }

  it('declares base64, never 8bit — 8bit needs 8BITMIME along the whole path', () => {
    const { body } = buildMultipartAlternative({ plain: 'שלום', amp: AMP_WITH_LF });
    expect(body).toContain('Content-Transfer-Encoding: base64');
    expect(body).not.toContain('8bit');
  });

  it('round-trips the AMP document BYTE-FOR-BYTE, bare LFs and all', () => {
    const { body } = buildMultipartAlternative({ plain: 'שלום', amp: AMP_WITH_LF });
    // The point of base64 here: nothing downstream can rewrite a line ending
    // inside the payload, so Gmail decodes exactly what was rendered.
    expect(decodePart(body, 'text/x-amp-html')).toBe(AMP_WITH_LF);
  });

  it('round-trips a Hebrew plain part unchanged', () => {
    const plain = 'רשימת משימות\nשורה שנייה';
    const { body } = buildMultipartAlternative({ plain, amp: AMP_WITH_LF });
    expect(decodePart(body, 'text/plain')).toBe(plain);
  });

  it('leaves NO bare LF anywhere in the assembled body', () => {
    const { body } = buildMultipartAlternative({ plain: 'שלום\nעולם', amp: AMP_WITH_LF });
    expect(/(?<!\r)\n/.test(body)).toBe(false);
  });

  it('wraps base64 at 76 characters (RFC 2045 §6.8)', () => {
    const { body } = buildMultipartAlternative({ plain: 'x'.repeat(500), amp: AMP_WITH_LF });
    const payloadLines = body
      .split('\r\n')
      .filter((l) => /^[A-Za-z0-9+/=]+$/.test(l) && l.length > 0);
    expect(payloadLines.length).toBeGreaterThan(1);
    for (const line of payloadLines) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('keeps the payload free of raw non-ASCII octets', () => {
    const { body } = buildMultipartAlternative({ plain: 'שלום', amp: AMP_WITH_LF });
    const payload = body.slice(body.indexOf('base64'));
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(payload)).toBe(false);
  });

  it('throws when plain or amp is missing/empty — AMP-for-Email requires both parts', () => {
    expect(() => buildMultipartAlternative({ plain: '', amp: 'x' })).toThrow(/plain/);
    expect(() => buildMultipartAlternative({ plain: 'x', amp: '' })).toThrow(/amp/);
    expect(() => buildMultipartAlternative({ plain: null, amp: 'x' })).toThrow(/plain/);
  });
});

// Contract tests for multipart/alternative MIME assembly (V6 §5).
//
// THREE parts as of 0.10.3, in the order text/plain → text/x-amp-html →
// text/html. That order is not a preference: it mirrors, byte-position for
// byte-position, the ONE message we have observed Gmail render our AMP
// document from (the AMP playground's send, captured 2026-07-29). Our own
// 2-part message — plain + amp, no text/html — came back INTERNAL_ERROR with
// the identical AMP document inside. Google's docs say plain alone should
// suffice (MALFORMED is defined as "no fallback text/html OR text/plain"), so
// this is a hypothesis under test, and the comment is here so nobody
// "simplifies" the html part away without re-running that experiment.
//
// The text/html part is DERIVED from the plain part and stays non-actionable:
// V6's D1/D2 bans an actionable HTML body, not an HTML body. See
// tests/digest-html-fallback.test.js for the inertness assertions.

import { describe, it, expect } from 'vitest';
import { buildMultipartAlternative } from '../src/helpers/mime-alternative.js';
import { renderHtmlFallback } from '../src/helpers/digest-html-fallback.js';

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

  it('emits plain → x-amp-html → html, the order of the message that DID render', () => {
    const { contentType, body } = buildMultipartAlternative({
      plain: 'PLAIN_BODY',
      amp: 'AMP_BODY',
    });
    const boundary = contentType.match(/boundary="([^"]+)"/)[1];
    const plainIdx = body.indexOf('Content-Type: text/plain');
    const ampIdx = body.indexOf('Content-Type: text/x-amp-html');
    const htmlIdx = body.indexOf('Content-Type: text/html');
    expect(plainIdx).toBeGreaterThan(-1);
    expect(ampIdx).toBeGreaterThan(plainIdx);
    expect(htmlIdx).toBeGreaterThan(ampIdx);
    // Each part sits between its boundary markers, base64-encoded (see below).
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    expect(body).toContain(
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('PLAIN_BODY')}\r\n`
    );
    expect(body).toContain(
      `--${boundary}\r\nContent-Type: text/x-amp-html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('AMP_BODY')}\r\n`
    );
  });

  it('carries exactly ONE text/x-amp-html part — two of them are MALFORMED', () => {
    const { body } = buildMultipartAlternative({ plain: 'p', amp: 'a' });
    expect(body.match(/Content-Type: text\/x-amp-html/g)).toHaveLength(1);
  });

  it('derives the html part from the plain part, so the two can never disagree', () => {
    const plain = 'שלום,\n- Item 1 · סטטוס: טרם החל';
    const { body } = buildMultipartAlternative({ plain, amp: 'AMP' });
    const expected = Buffer.from(renderHtmlFallback(plain), 'utf8').toString('base64');
    expect(body.replaceAll('\r\n', '')).toContain(expected.replaceAll('\n', ''));
  });

  it('keeps the html part non-actionable — no link reaches the recipient', () => {
    const { body } = buildMultipartAlternative({
      plain: 'לעדכון היכנסו ל-monday.com',
      amp: 'AMP',
    });
    const html = decodeNamedPart(body, 'text/html');
    expect(html).not.toContain('href');
    expect(html).not.toMatch(/https?:/i);
  });
});

/** Decode one part by its exact Content-Type line (text/html ≠ text/x-amp-html). */
function decodeNamedPart(body, contentType) {
  const section = body
    .split(/--dc_[0-9a-f]+/)
    .find((s) => s.includes(`Content-Type: ${contentType};`));
  const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
  return Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

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

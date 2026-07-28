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
    // Each part sits between its boundary markers with the exact body.
    expect(body).toContain(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nPLAIN_BODY\r\n`);
    expect(body).toContain(`--${boundary}\r\nContent-Type: text/x-amp-html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nAMP_BODY\r\n`);
  });

  it('throws when plain or amp is missing/empty — AMP-for-Email requires both parts', () => {
    expect(() => buildMultipartAlternative({ plain: '', amp: 'x' })).toThrow(/plain/);
    expect(() => buildMultipartAlternative({ plain: 'x', amp: '' })).toThrow(/amp/);
    expect(() => buildMultipartAlternative({ plain: null, amp: 'x' })).toThrow(/plain/);
  });
});

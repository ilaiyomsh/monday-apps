// TDD — selectable part order, for the ONE experiment the INTERNAL_ERROR
// investigation could never run.
//
// The original evidence is confounded: the message Gmail DID render (the AMP
// playground's send, 2026-07-29) differed from ours in the part order AND in the
// sending identity/DKIM. So "plain → amp → html is the order that works" is a
// hypothesis with two variables in it. A competing claim exists that the AMP
// part must come LAST (plain → html → amp), which is also the more literal
// reading of multipart/alternative — the last part is the most preferred one.
//
// Settling it needs the same document sent from the same mailbox with only the
// order changed. That is what `order` is for, and it is a DEBUG-lane knob:
// the default stays the order backed by the captured message, so nothing about
// production sending changes until an experiment says otherwise.

import { describe, it, expect } from 'vitest';
import { buildMultipartAlternative, PART_ORDERS } from '../src/helpers/mime-alternative.js';

const PLAIN = 'שלום, זו רשימת המשימות.';
const AMP = '<!doctype html>\n<html ⚡4email>\n<body>דינמי</body>\n</html>';

/** Content-Types in the order they appear in the assembled body. */
function partTypesOf(mime) {
  const boundary = /boundary="([^"]+)"/.exec(mime.contentType)[1];
  return mime.body
    .split(`--${boundary}`)
    .map((chunk) => /Content-Type: (\S+);/.exec(chunk)?.[1])
    .filter(Boolean);
}

/** Decode one part's base64 payload back to text. */
function decodePart(mime, contentType) {
  const boundary = /boundary="([^"]+)"/.exec(mime.contentType)[1];
  const chunk = mime.body
    .split(`--${boundary}`)
    .find((c) => c.includes(`Content-Type: ${contentType};`));
  if (!chunk) return null;
  return Buffer.from(chunk.split('\r\n\r\n')[1].trim().replace(/\r\n/g, ''), 'base64').toString('utf8');
}

describe('buildMultipartAlternative — part order', () => {
  it('defaults to plain → x-amp-html → html, unchanged from before the knob existed', () => {
    expect(partTypesOf(buildMultipartAlternative({ plain: PLAIN, amp: AMP }))).toEqual([
      'text/plain',
      'text/x-amp-html',
      'text/html',
    ]);
  });

  it('names the default explicitly so a caller can round-trip it', () => {
    expect(PART_ORDERS).toContain('plain-amp-html');
    expect(PART_ORDERS).toContain('plain-html-amp');
    expect(PART_ORDERS).toContain('plain-amp');
  });

  it('plain-html-amp puts the AMP part LAST (the competing claim)', () => {
    const mime = buildMultipartAlternative({ plain: PLAIN, amp: AMP, order: 'plain-html-amp' });
    expect(partTypesOf(mime)).toEqual(['text/plain', 'text/html', 'text/x-amp-html']);
  });

  it('plain-amp drops the html part entirely (the 2-part control that got INTERNAL_ERROR)', () => {
    const mime = buildMultipartAlternative({ plain: PLAIN, amp: AMP, order: 'plain-amp' });
    expect(partTypesOf(mime)).toEqual(['text/plain', 'text/x-amp-html']);
  });

  it('every order carries the AMP document byte-for-byte — only position may vary', () => {
    for (const order of PART_ORDERS) {
      const mime = buildMultipartAlternative({ plain: PLAIN, amp: AMP, order });
      expect(decodePart(mime, 'text/x-amp-html'), order).toBe(AMP);
      expect(decodePart(mime, 'text/plain'), order).toBe(PLAIN);
    }
  });

  it('every order still carries exactly ONE amp part (two would be MALFORMED)', () => {
    for (const order of PART_ORDERS) {
      const mime = buildMultipartAlternative({ plain: PLAIN, amp: AMP, order });
      const ampParts = partTypesOf(mime).filter((t) => t === 'text/x-amp-html');
      expect(ampParts, order).toHaveLength(1);
    }
  });

  it('every order closes with the terminating boundary and no bare LF', () => {
    for (const order of PART_ORDERS) {
      const mime = buildMultipartAlternative({ plain: PLAIN, amp: AMP, order });
      const boundary = /boundary="([^"]+)"/.exec(mime.contentType)[1];
      expect(mime.body.endsWith(`--${boundary}--\r\n`), order).toBe(true);
      expect(mime.body.replace(/\r\n/g, ''), order).not.toContain('\n');
    }
  });

  it('an unknown order is REFUSED, never silently treated as the default', () => {
    // Silently defaulting would make an experiment report the wrong variant —
    // worse than no experiment, because the conclusion would look supported.
    expect(() => buildMultipartAlternative({ plain: PLAIN, amp: AMP, order: 'amp-first' })).toThrow(
      /order/i
    );
  });
});

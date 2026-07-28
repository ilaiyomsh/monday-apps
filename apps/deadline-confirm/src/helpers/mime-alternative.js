// V6 §5 MIME assembly — multipart/alternative with text/plain first and
// text/x-amp-html second. No text/html part (actionable HTML is retired).
// Pure: no network, no storage. The Gmail send funnel (T9) wraps this body
// into an RFC822 message; this helper only builds the alternative parts.

import crypto from 'node:crypto';

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
      'Content-Transfer-Encoding: 8bit',
      '',
      plain,
      '',
    ].join('\r\n'),
    [
      `--${boundary}`,
      'Content-Type: text/x-amp-html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      amp,
      '',
    ].join('\r\n'),
    `--${boundary}--\r\n`,
  ];
  return {
    contentType: `multipart/alternative; boundary="${boundary}"`,
    body: parts.join(''),
  };
}

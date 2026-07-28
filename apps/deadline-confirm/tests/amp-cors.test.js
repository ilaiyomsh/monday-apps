// TDD red phase (V5 Gmail dynamic email) — the AMP-for-Email CORS resolver.
//
// Contract (amp.dev "CORS in AMP for Email", both versions supported):
//   v2  request has `AMP-Email-Sender: <addr>`
//       → response MUST carry `AMP-Email-Allow-Sender: <addr>` (never `*`)
//   v1  request has `Origin: <origin>` + `?__amp_source_origin=<addr>`
//       → response MUST carry Access-Control-Allow-Origin: <origin>,
//         AMP-Access-Control-Allow-Source-Origin: <addr>,
//         Access-Control-Expose-Headers: AMP-Access-Control-Allow-Source-Origin
//   v2 takes precedence when both are present.
//
// Security posture (locked): DEFAULT DENY. An empty allowlist admits nobody,
// the sender address is matched case-insensitively against the configured
// allowlist, and a rejected request gets NO CORS headers at all (the email
// client then refuses to read the body — a rejection can never be mistaken
// for a soft failure).

import { describe, it, expect } from 'vitest';
import { resolveAmpCors } from '../src/helpers/amp-cors.js';

const SENDER = 'deadline@twyst.co.il';
const ALLOWED = [SENDER, 'amp@gmail.dev'];
const GMAIL_ORIGIN = 'https://mail.google.com';

const EXPOSE = 'Access-Control-Expose-Headers';
const SOURCE_ORIGIN = 'AMP-Access-Control-Allow-Source-Origin';

describe('resolveAmpCors — version 2 (AMP-Email-Sender)', () => {
  it('allows a listed sender and echoes it back', () => {
    const r = resolveAmpCors({ senderHeader: SENDER, allowedSenders: ALLOWED });
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual({ 'AMP-Email-Allow-Sender': SENDER });
  });

  it('matches the allowlist case-insensitively but echoes a normalized address', () => {
    const r = resolveAmpCors({ senderHeader: '  DeadLine@Twyst.co.IL ', allowedSenders: ALLOWED });
    expect(r.ok).toBe(true);
    expect(r.headers['AMP-Email-Allow-Sender']).toBe(SENDER);
  });

  it('accepts a display-name form and echoes only the address', () => {
    const r = resolveAmpCors({ senderHeader: 'עדכוני דדליין <deadline@twyst.co.il>', allowedSenders: ALLOWED });
    expect(r.ok).toBe(true);
    expect(r.headers['AMP-Email-Allow-Sender']).toBe(SENDER);
  });

  it('rejects an unlisted sender with no headers at all', () => {
    const r = resolveAmpCors({ senderHeader: 'attacker@evil.example', allowedSenders: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sender_not_allowed');
    expect(r.headers).toEqual({});
  });

  it('takes precedence over v1 when both mechanisms are present', () => {
    const r = resolveAmpCors({
      senderHeader: SENDER,
      originHeader: GMAIL_ORIGIN,
      sourceOrigin: SENDER,
      allowedSenders: ALLOWED,
    });
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual({ 'AMP-Email-Allow-Sender': SENDER });
  });
});

describe('resolveAmpCors — version 1 (Origin + __amp_source_origin)', () => {
  it('echoes the origin, the source origin and the expose header', () => {
    const r = resolveAmpCors({ originHeader: GMAIL_ORIGIN, sourceOrigin: SENDER, allowedSenders: ALLOWED });
    expect(r.ok).toBe(true);
    expect(r.headers['Access-Control-Allow-Origin']).toBe(GMAIL_ORIGIN);
    expect(r.headers[SOURCE_ORIGIN]).toBe(SENDER);
    expect(r.headers[EXPOSE]).toBe(SOURCE_ORIGIN);
  });

  it('rejects when __amp_source_origin is missing', () => {
    const r = resolveAmpCors({ originHeader: GMAIL_ORIGIN, allowedSenders: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_source_origin');
    expect(r.headers).toEqual({});
  });

  it('rejects an unlisted source origin', () => {
    const r = resolveAmpCors({
      originHeader: GMAIL_ORIGIN,
      sourceOrigin: 'attacker@evil.example',
      allowedSenders: ALLOWED,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sender_not_allowed');
    expect(r.headers).toEqual({});
  });

  it('never answers with a wildcard source origin', () => {
    const r = resolveAmpCors({ originHeader: GMAIL_ORIGIN, sourceOrigin: '*', allowedSenders: ['*'] });
    expect(r.ok).toBe(false);
    expect(r.headers).toEqual({});
  });
});

describe('resolveAmpCors — default deny', () => {
  it('rejects when the allowlist is empty (feature unconfigured)', () => {
    const r = resolveAmpCors({ senderHeader: SENDER, allowedSenders: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_configured');
    expect(r.headers).toEqual({});
  });

  it('rejects when the allowlist is missing entirely', () => {
    const r = resolveAmpCors({ senderHeader: SENDER });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_configured');
  });

  it('rejects a plain browser request that carries neither mechanism', () => {
    const r = resolveAmpCors({ allowedSenders: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_amp_headers');
    expect(r.headers).toEqual({});
  });

  it('rejects an empty-string sender header (treated as absent)', () => {
    const r = resolveAmpCors({ senderHeader: '', allowedSenders: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_amp_headers');
  });
});

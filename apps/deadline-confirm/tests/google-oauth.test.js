// T9b — Google OAuth token mechanics (provider layer).
// Pure transport: no storage, no env reads. The caller supplies client
// credentials and a fetch impl, which is what makes per-tenant credentials
// (owner decision 2026-07-29, superseding D13's app-global assumption)
// expressible without touching this module.

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SCOPES,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  refreshGoogleAccessToken,
} from '../src/services/providers/google/oauth.js';

const CLIENT = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret' };
const REDIRECT = 'https://app.example.com/oauth/google/callback';

/** id_token payload carrying the sender address (openid+email, no API call). */
function idToken(email) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ email, sub: '1' })}.sig`;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('GOOGLE_SCOPES', () => {
  // Spec re-pinned: owner decision 2026-08-04, findings §5 — SMTP XOAUTH2
  // rejects gmail.send and names https://mail.google.com/ in its 334
  // challenge, so the testing-phase send path needs the broad scope.
  // The old pin here asserted gmail.send / NOT mail.google.com (D12).
  it('requests the full-mailbox scope SMTP XOAUTH2 demands, plus identity (owner decision 2026-08-04, findings §5)', () => {
    expect(GOOGLE_SCOPES).toContain('https://mail.google.com/');
    expect(GOOGLE_SCOPES).toContain('openid');
    expect(GOOGLE_SCOPES).toContain('email');
    // The broad scope subsumes send — requesting both would be redundant.
    expect(GOOGLE_SCOPES).not.toContain('gmail.send');
    expect(GOOGLE_SCOPES).not.toContain('gmail.readonly');
    expect(GOOGLE_SCOPES).not.toContain('gmail.modify');
  });
});

describe('buildGoogleAuthUrl', () => {
  it('asks for an offline refresh token with forced consent', () => {
    const url = new URL(buildGoogleAuthUrl({ ...CLIENT, redirectUri: REDIRECT, state: 'nonce1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('nonce1');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES);
  });

  it('never puts the client secret in the browser-visible URL', () => {
    const url = buildGoogleAuthUrl({ ...CLIENT, redirectUri: REDIRECT, state: 'n' });
    expect(url).not.toContain('csecret');
  });
});

describe('exchangeGoogleCode', () => {
  it('posts the code and returns tokens plus the sender address from the id_token', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: init.body.toString() });
      return jsonResponse({
        access_token: 'at1',
        refresh_token: 'rt1',
        expires_in: 3600,
        scope: 'https://mail.google.com/ openid email',
        id_token: idToken('digest@twyst.co.il'),
      });
    };
    const result = await exchangeGoogleCode({
      code: 'authcode',
      redirectUri: REDIRECT,
      ...CLIENT,
      fetchImpl,
      now: () => 1_000_000,
    });
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].body).toContain('code=authcode');
    expect(calls[0].body).toContain('grant_type=authorization_code');
    expect(result).toEqual({
      accessToken: 'at1',
      refreshToken: 'rt1',
      accessTokenExpiresAt: 1_000_000 + 3600 * 1000,
      senderAddress: 'digest@twyst.co.il',
      // The GRANTED scope, echoed by Google — what /api/state later judges
      // sufficiency by (owner decision 2026-08-04, findings §5).
      scope: 'https://mail.google.com/ openid email',
    });
  });

  it('returns scope as an empty string when Google echoes none', async () => {
    const fetchImpl = async () =>
      jsonResponse({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, id_token: idToken('a@b.co') });
    const result = await exchangeGoogleCode({ code: 'c', redirectUri: REDIRECT, ...CLIENT, fetchImpl });
    expect(result.scope).toBe('');
  });

  it('throws when Google refuses the exchange', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'invalid_request' }, { ok: false, status: 400 });
    await expect(
      exchangeGoogleCode({ code: 'bad', redirectUri: REDIRECT, ...CLIENT, fetchImpl })
    ).rejects.toThrow(/google token exchange failed: 400/);
  });

  it('throws when the response carries no refresh token — sending would die at the first expiry', async () => {
    const fetchImpl = async () =>
      jsonResponse({ access_token: 'at1', expires_in: 3600, id_token: idToken('a@b.co') });
    await expect(
      exchangeGoogleCode({ code: 'c', redirectUri: REDIRECT, ...CLIENT, fetchImpl })
    ).rejects.toThrow(/refresh token/i);
  });

  it('throws when the id_token carries no email — the sender address is not guessable', async () => {
    const fetchImpl = async () =>
      jsonResponse({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, id_token: idToken(undefined) });
    await expect(
      exchangeGoogleCode({ code: 'c', redirectUri: REDIRECT, ...CLIENT, fetchImpl })
    ).rejects.toThrow(/sender address/i);
  });
});

describe('refreshGoogleAccessToken', () => {
  it('exchanges the refresh token for a fresh access token', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(init.body.toString());
      return jsonResponse({ access_token: 'at2', expires_in: 1800 });
    };
    const result = await refreshGoogleAccessToken({
      refreshToken: 'rt1',
      ...CLIENT,
      fetchImpl,
      now: () => 5_000,
    });
    expect(calls[0]).toContain('grant_type=refresh_token');
    expect(calls[0]).toContain('refresh_token=rt1');
    expect(result).toEqual({ accessToken: 'at2', accessTokenExpiresAt: 5_000 + 1800 * 1000 });
  });

  it('tags invalid_grant distinctly — that is a dead connection, not a blip', async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: 'invalid_grant' }, { ok: false, status: 400 });
    await expect(refreshGoogleAccessToken({ refreshToken: 'dead', ...CLIENT, fetchImpl })).rejects.toMatchObject({
      code: 'google_invalid_grant',
    });
  });

  it('does NOT tag a transient 503 as invalid_grant', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'backend_error' }, { ok: false, status: 503 });
    await expect(refreshGoogleAccessToken({ refreshToken: 'rt', ...CLIENT, fetchImpl })).rejects.toMatchObject({
      code: 'google_refresh_failed',
      status: 503,
    });
  });
});

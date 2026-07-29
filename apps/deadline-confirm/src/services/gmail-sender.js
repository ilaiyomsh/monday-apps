// T9 — the Gmail send funnel. This is the `emailSender` seam that
// digest-run.js, scheduler.js and admin-api.js already call; wiring it in
// index.js is what turns sending on.
//
// Per-tenant by construction (owner decision 2026-07-29): every organization
// runs its own Google OAuth client under its own Workspace and sends from its
// own internal mailbox. The consequence that matters for the product is DKIM —
// the signing domain aligns with the From domain automatically, which is what
// Gmail requires before it will render the AMP part at all. Sending every
// tenant's mail from one vendor address would break that alignment for
// everyone.
//
// Client credentials resolve per tenant first (`record.clientId/clientSecret`),
// falling back to the app-level pair. That keeps the Twyst internal rehearsal
// on app env while the customer rollout moves to per-tenant credentials, with
// no change here.
//
// Token lifecycle: an in-process memo per account holds the access token so a
// 200-recipient digest performs ONE refresh, not 200. `invalid_grant` — and
// only `invalid_grant` — marks the record disconnected; a transient 5xx must
// not trip the kill switch, or one bad minute at Google silences a tenant
// until someone notices.

import {
  refreshGoogleAccessToken,
} from './providers/google/oauth.js';
import { logError, logInfo } from '../helpers/logger.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** Refresh this long before the stored expiry. */
const REFRESH_CUSHION_MS = 60_000;

/** CR/LF in a header value is header injection — never sanitize, always refuse. */
const HEADER_UNSAFE_RE = /[\r\n]/;

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * RFC2047 base64 word for a header value that is not pure ASCII. Raw 8-bit
 * bytes in a header are illegal and Gmail renders them as mojibake — Hebrew
 * subjects hit this on every message.
 * @param {string} value
 * @returns {string}
 */
function encodeHeaderValue(value) {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Assemble the RFC822 message. The multipart body arrives already built by
 * helpers/mime-alternative.js and is passed through BYTE-FOR-BYTE — the AMP
 * part must not be re-encoded or re-wrapped, or Gmail rejects it as invalid AMP.
 * @param {{ from: string, to: string, subject: string, mime: { contentType: string, body: string } }} p
 * @returns {string}
 */
function buildRfc822({ from, to, subject, mime, plain }) {
  // No multipart → a plain-text-only message. The operator summary (D8) takes
  // this path: it has no AMP part, so wrapping it in multipart/alternative
  // would be a single-part multipart, which some clients render as an
  // attachment.
  const contentType = mime ? mime.contentType : 'text/plain; charset=UTF-8';
  const body = mime ? mime.body : String(plain ?? '');
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/**
 * Build the Gmail-backed email sender.
 *
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createAppStorage>} deps.storage
 * @param {string} [deps.clientId] - app-level fallback OAuth client id
 * @param {string} [deps.clientSecret] - app-level fallback OAuth client secret
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @returns {{ send(p: { accountId: string, to: string, subject: string, mime: object }): Promise<{ id: string }> }}
 */
export function createGmailSender({ storage, clientId, clientSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
  /** @type {Map<string, { accessToken: string, accessTokenExpiresAt: number }>} */
  const memo = new Map();

  /** Load the tenant record, refusing absent and dead connections distinctly. */
  async function loadRecord(scoped, accountId) {
    const record = await scoped.getGoogleSender();
    if (!record || !record.refreshToken) {
      throw fail('google_not_connected', `tenant ${accountId} has no Google sender connected`);
    }
    if (record.disconnectedAt) {
      throw fail('google_disconnected', `tenant ${accountId} Google sender is disconnected`);
    }
    return record;
  }

  function valid(token) {
    return Boolean(token?.accessToken) && token.accessTokenExpiresAt - REFRESH_CUSHION_MS > now();
  }

  /**
   * A usable access token for the tenant: memo → stored → refresh. A refresh
   * persists the fresh token so a container restart does not re-refresh.
   */
  async function accessTokenFor({ scoped, accountId, record, force = false }) {
    if (!force && valid(memo.get(accountId))) return memo.get(accountId).accessToken;
    if (!force && valid(record)) {
      memo.set(accountId, { accessToken: record.accessToken, accessTokenExpiresAt: record.accessTokenExpiresAt });
      return record.accessToken;
    }

    let refreshed;
    try {
      refreshed = await refreshGoogleAccessToken({
        refreshToken: record.refreshToken,
        clientId: record.clientId || clientId,
        clientSecret: record.clientSecret || clientSecret,
        fetchImpl,
        now,
      });
    } catch (err) {
      // Only a dead grant flips the switch. Everything else stays connected so
      // the next run retries — the provider layer made that distinction for us.
      if (err?.code === 'google_invalid_grant') {
        memo.delete(accountId);
        await scoped.setGoogleSender({ ...record, disconnectedAt: now(), lastError: 'google_invalid_grant' });
        logError('gmail', 'Google sender disconnected — reconnect required', { accountId });
        throw fail('google_disconnected', `tenant ${accountId} Google grant is dead`);
      }
      logError('gmail', 'access token refresh failed', {
        accountId,
        status: err?.status,
        error: String(err?.message ?? err),
      });
      throw fail('google_refresh_failed', `tenant ${accountId} token refresh failed`, { status: err?.status });
    }

    memo.set(accountId, refreshed);
    await scoped.setGoogleSender({ ...record, ...refreshed });
    return refreshed.accessToken;
  }

  async function postMessage(accessToken, raw) {
    return fetchImpl(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  }

  return {
    async send({ accountId, to, subject, mime, plain }) {
      if (typeof to !== 'string' || to.length === 0 || HEADER_UNSAFE_RE.test(to)) {
        throw fail('invalid_recipient', 'recipient address is missing or contains a header break');
      }
      const subjectText = typeof subject === 'string' ? subject : '';
      if (HEADER_UNSAFE_RE.test(subjectText)) {
        throw fail('invalid_subject', 'subject contains a header break');
      }

      const scoped = storage.forAccount(accountId);
      const record = await loadRecord(scoped, accountId);
      let accessToken = await accessTokenFor({ scoped, accountId, record });
      const raw = Buffer.from(
        buildRfc822({ from: record.senderAddress, to, subject: subjectText, mime, plain }),
        'utf8'
      ).toString('base64url');

      let res = await postMessage(accessToken, raw);
      if (res.status === 401) {
        // The stored expiry disagreed with Google (clock skew, or the token was
        // revoked mid-run). Force one refresh and retry once — never loop.
        logInfo('gmail', 'send got 401 — forcing one token refresh', { accountId });
        accessToken = await accessTokenFor({ scoped, accountId, record, force: true });
        res = await postMessage(accessToken, raw);
      }
      if (!res.ok) {
        const text = await res.text();
        logError('gmail', 'message send rejected by Gmail', {
          accountId,
          status: res.status,
          body: text.slice(0, 200),
        });
        throw fail('gmail_send_failed', `gmail send failed: ${res.status}`, { status: res.status });
      }
      const body = await res.json();
      return { id: body?.id };
    },
  };
}

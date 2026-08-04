// T9 — the Gmail API send funnel. SUPERSEDED as the wired channel
// (docs/amp-email-verified-findings.md §2): users.messages.send silently
// STRIPS the text/x-amp-html part on external delivery, so this sender cannot
// deliver AMP. The wired channel is services/smtp-sender.js (SMTP XOAUTH2 —
// the byte-identical message over smtp.gmail.com kept all three parts). Kept
// for reference and rollback only; nothing constructs it anymore.
//
// Per-tenant by construction (owner decision 2026-07-29): every organization
// runs its own Google OAuth client under its own Workspace and sends from its
// own internal mailbox. The consequence that matters for the product is DKIM —
// the signing domain aligns with the From domain automatically, which is what
// Gmail requires before it will render the AMP part at all. Sending every
// tenant's mail from one vendor address would break that alignment for
// everyone.
//
// Token lifecycle (memo / refresh cushion / invalid_grant kill switch) lives
// in services/google-token.js; message assembly + header-injection refusal in
// helpers/rfc822.js — both extracted from here VERBATIM so this sender's
// behavior (characterized by tests/gmail-sender*.test.js, unchanged) proves
// the extraction is faithful.

import { createGoogleTokenSource } from './google-token.js';
import { assertHeaderSafe, buildRfc822 } from '../helpers/rfc822.js';
import { logError, logInfo } from '../helpers/logger.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
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
  const tokens = createGoogleTokenSource({ storage, clientId, clientSecret, fetchImpl, now });

  async function postMessage(accessToken, raw) {
    return fetchImpl(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  }

  return {
    async send({ accountId, to, subject, mime, plain }) {
      const subjectText = assertHeaderSafe({ to, subject });

      const { record, accessToken: initialToken } = await tokens.senderFor(accountId);
      let accessToken = initialToken;
      // No `date` — the Gmail API stamps Date itself, and omitting it keeps
      // this sender's output byte-identical to before the rfc822 extraction.
      const raw = Buffer.from(
        buildRfc822({ from: record.senderAddress, to, subject: subjectText, mime, plain }),
        'utf8'
      ).toString('base64url');

      let res = await postMessage(accessToken, raw);
      if (res.status === 401) {
        // The stored expiry disagreed with Google (clock skew, or the token was
        // revoked mid-run). Force one refresh and retry once — never loop.
        logInfo('gmail', 'send got 401 — forcing one token refresh', { accountId });
        ({ accessToken } = await tokens.forceRefresh(accountId));
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

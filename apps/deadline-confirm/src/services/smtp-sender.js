// The WIRED send channel — SMTP XOAUTH2 to smtp.gmail.com:465.
//
// Why SMTP and not the Gmail API (docs/amp-email-verified-findings.md §2):
// users.messages.send silently STRIPS the text/x-amp-html part on external
// delivery — it rebuilds the message under its own boundary and the recipient
// gets plain + html only. The byte-identical message over raw SMTP arrived
// with OUR dc_ boundary and all three parts present, three times, against the
// same recipient. Same `emailSender` seam as the superseded gmail-sender.js
// (digest-run.js, scheduler.js, admin-api.js call it unchanged), same
// {code, message} error contract.
//
// AUTH XOAUTH2 requires the broad `https://mail.google.com/` scope (findings
// §5 — the 334 challenge names it; a gmail.send token is rejected). The OAuth
// layer grants and persists what Google echoed (`record.scope`), but that
// string is ADVISORY here: it is unobservable from outside the token response,
// and refusing on it once blocked a send the server never got to judge
// (incident 2026-08-04). SMTP AUTH is the authority — a mismatch is logged and
// quoted into any auth failure, never used to skip the attempt.
//
// Transport: nodemailer, auth type OAuth2 with the ACCESS TOKEN ONLY — the
// token lifecycle (memo, refresh cushion, invalid_grant kill switch) is ours
// (services/google-token.js), so nodemailer gets no refresh credentials and
// can never race our refresh. NON-POOLED by design: one transport per send()
// keeps every message on a fresh connection carrying the current token.
// Pooling (one connection per digest run) is a future optimization — measure
// before adding it; Gmail per-connection message caps apply.

import nodemailer from 'nodemailer';
import { createGoogleTokenSource } from './google-token.js';
import { assertHeaderSafe, buildRfc822 } from '../helpers/rfc822.js';
import { logError, logInfo } from '../helpers/logger.js';

/** The scope smtp.gmail.com demands for AUTH XOAUTH2 (findings §5). */
export const REQUIRED_SMTP_SCOPE = 'https://mail.google.com/';

/** nodemailer error codes that mean "never reached the SMTP dialogue". */
const CONNECT_CODES = new Set(['ECONNECTION', 'ESOCKET', 'ETIMEDOUT']);

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Build the SMTP-backed email sender.
 *
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createAppStorage>} deps.storage
 * @param {string} [deps.clientId] - app-level fallback OAuth client id
 * @param {string} [deps.clientSecret] - app-level fallback OAuth client secret
 * @param {typeof fetch} [deps.fetchImpl] - token refresh transport
 * @param {() => number} [deps.now]
 * @param {typeof nodemailer.createTransport} [deps.transportFactory]
 * @param {object} [deps.smtp] - transport options (host/port/secure, test-only flags)
 * @returns {{ send(p: { accountId: string, to: string, subject: string, mime?: object, plain?: string }): Promise<{ id: string }> }}
 */
export function createSmtpSender({
  storage,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  transportFactory = nodemailer.createTransport,
  smtp = { host: 'smtp.gmail.com', port: 465, secure: true },
}) {
  const tokens = createGoogleTokenSource({ storage, clientId, clientSecret, fetchImpl, now });

  /** One non-pooled transport per delivery attempt (see header), always closed. */
  async function deliver({ senderAddress, accessToken, to, raw }) {
    const transport = transportFactory({
      ...smtp,
      auth: { type: 'OAuth2', user: senderAddress, accessToken },
    });
    try {
      // The envelope is explicit: MAIL FROM must be the tenant's own mailbox
      // (DKIM/SPF alignment — findings §1/§4), RCPT TO exactly one recipient.
      return await transport.sendMail({ envelope: { from: senderAddress, to: [to] }, raw });
    } finally {
      if (typeof transport.close === 'function') transport.close();
    }
  }

  /**
   * Map a nodemailer error onto the seam's {code, message} contract — the
   * server's own response text rides in the message (same contract as
   * gmail_send_failed: that text IS the operator's debug output).
   */
  async function mapped(err, accountId, { afterRetry = false, grantedScope = '' } = {}) {
    const responseCode = Number(err?.responseCode) || 0;
    const responseText = String(err?.response ?? err?.message ?? err);
    const context = { accountId, code: err?.code, responseCode, response: responseText.slice(0, 200) };
    if (err?.code === 'EAUTH') {
      // An auth rejection is the ONE place the granted scope is worth quoting:
      // it is the leading suspect and the operator cannot read it anywhere else
      // (incident 2026-08-04 — a scope mismatch was invisible for a whole
      // reconnect cycle). Scopes are capability names, never credentials.
      const scopeNote = ` [granted scope: ${grantedScope || '(none recorded)'}; SMTP needs ${REQUIRED_SMTP_SCOPE}]`;
      if (afterRetry && responseCode >= 500) {
        // A definitive auth rejection of a FRESH token — the grant no longer
        // authenticates this mailbox. Trip the channel kill switch so
        // /api/state surfaces it instead of a silent nightly failure.
        await tokens.markDisconnected(accountId, 'smtp_auth_failed');
        logError('smtp', 'SMTP auth rejected after a forced refresh — sender disconnected', context);
        return fail('smtp_auth_failed', `smtp auth failed: ${responseText}${scopeNote}`, {
          status: responseCode,
        });
      }
      // 4xx (e.g. 454 temporary auth failure) or no response code at all:
      // transient — one bad minute at Google must not silence a tenant.
      logError('smtp', 'SMTP auth failed (transient)', context);
      return fail('smtp_auth_transient', `smtp auth failed (transient): ${responseText}${scopeNote}`, {
        status: responseCode || undefined,
      });
    }
    if (CONNECT_CODES.has(err?.code)) {
      logError('smtp', 'SMTP connection failed', context);
      return fail('smtp_connect_failed', `smtp connection failed: ${String(err?.message ?? err)}`);
    }
    if (responseCode >= 500) {
      logError('smtp', 'message rejected by SMTP server', context);
      return fail('smtp_rejected', `smtp send rejected: ${responseText}`, { status: responseCode });
    }
    if (responseCode >= 400) {
      logError('smtp', 'transient SMTP failure', context);
      return fail('smtp_transient', `smtp transient failure: ${responseText}`, { status: responseCode });
    }
    logError('smtp', 'smtp send failed', context);
    return fail('smtp_send_failed', `smtp send failed: ${String(err?.message ?? err)}`);
  }

  return {
    async send({ accountId, to, subject, mime, plain }) {
      const subjectText = assertHeaderSafe({ to, subject });

      const { record, accessToken } = await tokens.senderFor(accountId);
      // Scope check is ADVISORY, never a gate (incident 2026-08-04). It reads
      // the scope string Google ECHOED at consent — a value no one outside the
      // token response can observe — and refusing on it blocked a send that
      // smtp.gmail.com was never asked to judge. AUTH XOAUTH2 is the authority:
      // it either accepts the token or names its objection in a 535. So log the
      // mismatch and attempt the send; `mapped()` folds the granted scope into
      // an auth failure so the operator sees both sides of the comparison.
      const grantedScope = typeof record.scope === 'string' ? record.scope : '';
      if (!grantedScope.includes(REQUIRED_SMTP_SCOPE)) {
        logInfo('smtp', 'granted scope does not name the SMTP scope — sending anyway, SMTP decides', {
          accountId,
          grantedScope: grantedScope || '(none recorded)',
          required: REQUIRED_SMTP_SCOPE,
        });
      }

      // Raw SMTP stamps nothing, so the Date header is ours to write (the
      // Gmail API channel let Google stamp it) — rfc822.js emits RFC5322 UTC.
      const raw = buildRfc822({
        from: record.senderAddress,
        to,
        subject: subjectText,
        mime,
        plain,
        date: new Date(now()),
      });

      let info;
      try {
        info = await deliver({ senderAddress: record.senderAddress, accessToken, to, raw });
      } catch (err) {
        if (err?.code !== 'EAUTH') throw await mapped(err, accountId, { grantedScope });
        // The server refused the token the store considered valid (revoked
        // mid-run, or clock skew). Force ONE refresh and retry once — never
        // loop. Mirror of the Gmail channel's 401-retry.
        logInfo('smtp', 'send got EAUTH — forcing one token refresh', { accountId });
        const refreshed = await tokens.forceRefresh(accountId);
        try {
          info = await deliver({
            senderAddress: refreshed.record.senderAddress,
            accessToken: refreshed.accessToken,
            to,
            raw,
          });
        } catch (retryErr) {
          throw await mapped(retryErr, accountId, { afterRetry: true, grantedScope });
        }
      }
      return { id: info?.messageId };
    },
  };
}

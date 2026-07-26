// Resend transactional sender — the ONE funnel for outbound email (digest
// phase 1, owner decision 2026-07-19). API key + from address come from env
// (RESEND_API_KEY / DIGEST_FROM); when either is missing the app runs without
// a sender and /api/digest/send answers 409 email_not_configured.

import { logError } from '../helpers/logger.js';

export const RESEND_API_URL = 'https://api.resend.com/emails';

export class EmailSendError extends Error {
  /** @param {string} message @param {{ status?: number }} [meta] */
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'EmailSendError';
    this.status = status ?? null;
  }
}

/**
 * @param {{ apiKey: string, from: string, fetchImpl?: typeof fetch, url?: string }} opts
 * @returns {{ send(p: { to: string, subject: string, html: string }): Promise<{ id: string }> }}
 */
export function createEmailSender({ apiKey, from, fetchImpl, url = RESEND_API_URL }) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  return {
    async send({ to, subject, html }) {
      let res;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
      } catch (err) {
        throw new EmailSendError(`resend network failure: ${err.message}`, {});
      }

      let body = null;
      try {
        body = await res.json();
      } catch (err) {
        // Some responses carry no JSON — the HTTP status alone is the signal.
        logError('email_sender', 'resend response body was not JSON', {
          status: res.status,
          error: String(err?.message ?? err),
        });
      }

      if (!res.ok) {
        throw new EmailSendError(`resend HTTP ${res.status}: ${body?.message ?? 'unknown error'}`, {
          status: res.status,
        });
      }
      return { id: body?.id ?? '' };
    },
  };
}

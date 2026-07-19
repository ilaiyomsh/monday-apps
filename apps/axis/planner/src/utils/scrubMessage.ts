/**
 * scrubMessage.ts — privacy-scrub free-text before it ships (D2).
 *
 * Single source of truth for the message-scrub spec, shared by:
 *   - axiomErrorSink.ts (scrubs `error.message` before it ships as `err_msg`), and
 *   - Logger.ts (scrubs any Error-DERIVED `record.message` in buildRecord so a raw
 *     error.message can never land in `ev.message` — see buildRecord).
 *
 * Extracted into its own module (rather than living in axiomErrorSink.ts) so Logger.ts
 * can import it WITHOUT a circular import — axiomErrorSink.ts imports Logger.ts, so Logger
 * importing back from the sink would form a cycle AND pull the sink's module-scope transport
 * construction into every Logger import. This module imports nothing.
 *
 * The spec is IDENTICAL across app-core, the error-guard template, and every app: emails
 * FIRST (their local part would otherwise be eaten by the token rule), then long token/hex
 * runs (>=16), then digit-runs (>=7). Pre-capped at 1000 to bound regex work, final slice 200.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;

/**
 * Redact PII/secrets from a free-text string so it can ship. Order matters (emails before
 * tokens before digits — see module header). Non-strings / empty -> ''.
 */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  let s = raw.slice(0, MSG_PRECAP);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(TOKEN_RE, '[redacted]');
  s = s.replace(DIGITS_RE, '[num]');
  return s.slice(0, MSG_MAXLEN);
}

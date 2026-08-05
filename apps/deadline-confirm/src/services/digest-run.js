// Shared digest send pipeline (V6 T10/T12) — used by manual send,
// resend-today, and the monday-code scheduler. Pure orchestration over
// storage + monday API + emailSender seam. Gmail OAuth (T9b/T9c) is NOT
// wired here; when emailSender is absent every call skips with
// `email_not_configured`.

import { MANIFEST_TIMEZONE, currentSlot } from './manifest-signature.js';
import { buildDigest, digestTaskColumnIds, decorateRecipientSections } from './digest-service.js';
import { MondayApiError } from './monday-api.js';
import { renderDigestPlain } from '../helpers/digest-plain.js';
import { renderDigestAmp } from '../helpers/digest-amp.js';
import { buildMultipartAlternative } from '../helpers/mime-alternative.js';
import { logError, logInfo } from '../helpers/logger.js';

/**
 * Asia/Jerusalem wall-clock hour (0–23) for `now`.
 * @param {Date} [now]
 * @returns {number}
 */
export function hourInJerusalem(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: MANIFEST_TIMEZONE,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now)
  );
}

/**
 * Asia/Jerusalem calendar date as YYYY-MM-DD.
 * @param {Date} [now]
 * @returns {string}
 */
export function todayInJerusalem(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MANIFEST_TIMEZONE }).format(now);
}

/**
 * Run the digest send for one tenant account.
 * @param {object} p
 * @param {string} p.accountId
 * @param {ReturnType<import('./storage.js').createAppStorage>} p.storage
 * @param {{ getBoardItems(p: object): Promise<{ items: object[], truncated: boolean }> }} p.api
 * @param {string} p.baseUrl
 * @param {{ send(p: object): Promise<{ id: string }> } | undefined} p.emailSender
 * @param {string} [p.todayIso]
 * @param {() => Date} [p.now]
 * @param {boolean} [p.skipAlreadySent=false] enforce the per-slot send marker —
 *   the CRON passes this. The admin's "send now" and resend-today deliberately
 *   do not: re-sending inside the same slot is the whole point of those.
 * @returns {Promise<object>}
 */
export async function runDigestForAccount({
  accountId,
  storage,
  api,
  baseUrl,
  emailSender,
  todayIso,
  now = () => new Date(),
  skipAlreadySent = false,
}) {
  if (!emailSender) return { skip: 'email_not_configured' };

  const scoped = storage.forAccount(accountId);
  const [config, secret, token] = await Promise.all([
    scoped.getConfig(),
    scoped.getLinkSecret(),
    scoped.getOauthToken(),
  ]);
  if (!config?.digest) return { skip: 'digest_not_configured' };
  if (!secret) return { skip: 'no_secret' };
  if (!token) return { skip: 'not_connected' };

  const sendHour = config.digest.sendHour ?? 8;
  const clock = now();
  const slot = currentSlot({ sendHour, now: clock });
  const today = todayIso ?? todayInJerusalem(clock);

  let tasksRead;
  let usersRead;
  try {
    [tasksRead, usersRead] = await Promise.all([
      api.getBoardItems({
        token,
        boardId: config.boardId,
        columnIds: digestTaskColumnIds(config),
      }),
      api.getBoardItems({
        token,
        boardId: config.digest.usersBoardId,
        columnIds: [config.digest.usersPeopleColumnId, config.digest.usersEmailColumnId],
      }),
    ]);
  } catch (err) {
    if (err instanceof MondayApiError) {
      logError('digest', 'board read failed', {
        accountId,
        error: err.message,
        code: err.code,
        unauthorized: err.unauthorized,
      });
      return { skip: 'monday_api_failed' };
    }
    throw err;
  }

  const { recipients, skippedUsers } = buildDigest({
    config,
    tasks: tasksRead.items,
    users: usersRead.items,
    today,
    // Real board label colors (tasks board read) — renderers fall back to
    // config colors when a double/older read supplies none.
    statusColumnColors: tasksRead.statusColumnColors,
  });

  const buttonsById = new Map((config.buttons ?? []).map((b) => [b.id, b]));
  const withButtons = (recipient) => decorateRecipientSections(recipient, buttonsById);

  // Who this slot has already been sent to. Loaded ONCE, as a snapshot: within a
  // single run the behaviour must stay exactly what it was, including D16's "the
  // same person on two users-board rows gets two messages". The snapshot only
  // ever suppresses sends that a PREVIOUS invocation already performed.
  const sentSnapshot = new Set();
  let sentPersonIds = [];
  if (skipAlreadySent) {
    const marker = await scoped.getDigestSent();
    // The stored slot is the expiry: a record from an earlier slot is a clean
    // slate, so yesterday's run can never block today's.
    if (marker?.slot === slot && Array.isArray(marker.personIds)) {
      for (const id of marker.personIds) sentSnapshot.add(String(id));
      sentPersonIds = [...marker.personIds];
    }
  }

  const results = [];
  let alreadySent = 0;
  for (const recipient of recipients) {
    const base = { email: recipient.email, name: recipient.name, taskCount: recipient.taskCount };
    if (skipAlreadySent && sentSnapshot.has(String(recipient.personId))) {
      alreadySent += 1;
      continue;
    }
    try {
      const decorated = withButtons(recipient);
      const plain = renderDigestPlain({ recipient: decorated });
      const amp = renderDigestAmp({
        baseUrl,
        secret,
        accountId,
        recipient: decorated,
        sendHour,
        now: clock,
      });
      const mime = buildMultipartAlternative({ plain, amp });
      await emailSender.send({
        // T9: the Gmail sender resolves the tenant's OWN mailbox and OAuth
        // client from this id. Without it a send would have no sending identity
        // to authenticate as.
        accountId,
        to: recipient.email,
        subject: config.digest.subject,
        plain,
        amp,
        mime,
      });
      results.push({ ...base, ok: true });
      if (skipAlreadySent) {
        // Persisted after EVERY successful send, not once at the end: a run
        // killed mid-loop (the 300s scheduler timeout) must leave behind exactly
        // who already has the mail, so the retry resumes instead of repeating.
        sentPersonIds.push(String(recipient.personId));
        await scoped.setDigestSent({ slot, personIds: sentPersonIds });
      }
    } catch (err) {
      logError('digest', 'send failed for recipient', {
        accountId,
        email: recipient.email,
        error: String(err?.message ?? err),
      });
      results.push({ ...base, ok: false, error: String(err?.message ?? err) });
    }
  }

  const failedAddresses = results.filter((r) => !r.ok).map((r) => r.email);
  const sent = results.filter((r) => r.ok).length;
  const failed = failedAddresses.length;
  logInfo('digest', 'digest send finished', {
    accountId,
    slot,
    recipients: results.length,
    sent,
    failed,
    alreadySent,
    skipped: skippedUsers.length,
  });

  return {
    slot,
    sendHour,
    results,
    skippedUsers,
    truncated: Boolean(tasksRead.truncated || usersRead.truncated),
    sent,
    failed,
    failedAddresses,
    // Recipients this slot had already been sent to, so the operator summary can
    // say "nothing to do" instead of looking like a run that found nobody.
    alreadySent,
  };
}

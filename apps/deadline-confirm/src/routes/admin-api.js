// Admin API — always behind the sessionToken middleware. Board/column
// pickers stay client-side (monday.api() seamless auth).
//
// V6 (docs/v6-amp-only-decisions.md): GET /api/snippet and
// GET /api/email-template are DELETED (D4) — they were the only endpoints
// that returned the secret unmasked, and the static pasted-HTML path they
// served is retired. The `templates` config field died with them; a client
// that still sends it is silently ignored (old stored configs keep the key
// harmlessly until the next save).
//
// Config contract (PUT /api/config), validated field-by-field — respond
// 400 { error: 'invalid_config', field } naming the FIRST offending field:
// - boardId: digits string (required)
// - peopleColumnId: non-empty string or null
// - buttons: array 1..20, each:
//     id: /^b_[A-Za-z0-9_-]{4,16}$/ — client MAY pre-generate; when absent
//         the SERVER generates one; duplicates → 400 (field 'buttons')
//     name: string 1..40
//     statusColumnId: non-empty string
//     targetIndex: integer >= 0 (0 is a valid label id)
//     targetLabel: string 1..40
//     style: { color: /^#[0-9a-fA-F]{6}$/, icon: string 0..4 chars
//              (optional, default ''), size: 'sm'|'md'|'lg' }
// Valid → storage.setConfig(normalized) → 200 { ok: true, config } (the
// normalized config INCLUDING generated ids — the client re-syncs from it).
//
// GET /api/state + POST /api/secret/rotate — see route comments (V6: rotate
// stops returning the secret; nothing displays it any more).

import crypto from 'node:crypto';
import express from 'express';
import { generateSecret, maskSecret } from '../services/secret.js';
import { renderDigestAmp } from '../helpers/digest-amp.js';
import { renderDigestPlain } from '../helpers/digest-plain.js';
import { buildMultipartAlternative } from '../helpers/mime-alternative.js';
import { buildDigest, digestTaskColumnIds, decorateRecipientSections } from '../services/digest-service.js';
import {
  DIGEST_FONTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_BLOCKS,
  MAX_CLUSTER_BLOCKS,
  MAX_TEXT_LENGTH,
  TEXT_ALIGNS,
  TEXT_BLOCK_ID_RE,
  TEXT_DIRECTIONS,
  legacyBlocksFromSections,
  normalizeDigestBlocks,
  sectionsFromBlocks,
} from '../services/digest-blocks.js';
import { runDigestForAccount, todayInJerusalem as todayInJerusalemFromRun } from '../services/digest-run.js';
import { MondayApiError } from '../services/monday-api.js';
import { logError, logInfo } from '../helpers/logger.js';

/**
 * The scope the SMTP XOAUTH2 send path demands (owner decision 2026-08-04;
 * measured in docs/amp-email-verified-findings.md §5 — smtp.gmail.com names it
 * in its 334 challenge and rejects gmail.send). A google_sender record whose
 * granted scope does not include it needs re-consent.
 */
const REQUIRED_GOOGLE_SCOPE = 'https://mail.google.com/';

const BUTTON_ID_RE = /^b_[A-Za-z0-9_-]{4,16}$/;
const SECTION_ID_RE = /^s_[A-Za-z0-9_-]{4,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// --- POST /api/digest/send-raw (AMP debug lane) constants -------------------
/** Single address, no spaces/commas — rejects header injection by construction. */
const RAW_EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const HEADER_BREAK_RE = /[\r\n]/;
const RAW_SUBJECT_MAX = 200;
/** Far above Gmail's 100KB AMP-part ceiling — a cap on abuse, not on debugging. */
const RAW_AMP_MAX_BYTES = 1_000_000;
const RAW_FALLBACK_SUBJECT = '[AMP debug] מייל מסכם';
const RAW_FALLBACK_PLAIN =
  'שליחת בדיקה של החלק הדינמי (AMP). בלקוח דואר שלא תומך ב-AMP for Email אין כאן תוכן לצפייה.';

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').slice(0, 8)}`;
}

const isNonEmptyString = (v, max = Infinity) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Validate + normalize ONE digest cluster — a `cluster` block (0.15.0) or a
 * legacy `sections[]` entry, which carry the same fields.
 *
 * Returns `{ section }` or `{ bad: true }`; the CALLER names the offending
 * field, because the two paths report different ones ('digest.blocks' vs
 * 'digest.sections') and the field name is part of the API contract.
 *
 * @param {object} s
 * @param {Set<string>} buttonIds ids of the config's action buttons
 */
function validateDigestCluster(s, buttonIds) {
  const bad = { bad: true };
  if (typeof s !== 'object' || s === null) return bad;
  if (s.id !== undefined && !(typeof s.id === 'string' && SECTION_ID_RE.test(s.id))) return bad;
  if (!isNonEmptyString(s.title, 60)) return bad;
  if (!isNonEmptyString(s.dateColumnId)) return bad;
  if (!isNonEmptyString(s.dateColumnTitle, 255)) return bad;

  // buttonIds (multi) with legacy fallback to singular buttonId
  let sectionButtonIds;
  if (Array.isArray(s.buttonIds) && s.buttonIds.length > 0) {
    if (!s.buttonIds.every((id) => typeof id === 'string' && buttonIds.has(id))) return bad;
    sectionButtonIds = [...new Set(s.buttonIds)];
  } else if (typeof s.buttonId === 'string' && buttonIds.has(s.buttonId)) {
    sectionButtonIds = [s.buttonId];
  } else {
    return bad;
  }

  // "show by status": a non-empty set of label ids (0 is valid).
  if (
    !Array.isArray(s.includeStatusLabelIds) ||
    s.includeStatusLabelIds.length === 0 ||
    !s.includeStatusLabelIds.every((n) => Number.isInteger(n) && n >= 0)
  ) {
    return bad;
  }

  // Optional per-cluster note column: mapping it makes a per-task text field
  // mandatory in the email. Absent/null/'' = no mapping, which is what every
  // config saved before 0.12.0 carries.
  let noteColumnId = null;
  let noteColumnTitle = '';
  if (s.noteColumnId !== undefined && s.noteColumnId !== null && s.noteColumnId !== '') {
    if (!isNonEmptyString(s.noteColumnId)) return bad;
    // The title becomes the email column header — a mapping without one would
    // render a nameless column, so it is required, not defaulted.
    if (!isNonEmptyString(s.noteColumnTitle, 255)) return bad;
    noteColumnId = s.noteColumnId;
    noteColumnTitle = s.noteColumnTitle;
  }

  return {
    section: {
      id: s.id ?? generateId('s'),
      title: s.title,
      dateColumnId: s.dateColumnId,
      dateColumnTitle: s.dateColumnTitle,
      buttonId: sectionButtonIds[0],
      buttonIds: sectionButtonIds,
      includeStatusLabelIds: [...s.includeStatusLabelIds],
      noteColumnId,
      noteColumnTitle,
    },
  };
}

/**
 * Validate + normalize ONE text block. Every style value is checked against a
 * closed set: these end up in the amp document's <style> element and in the
 * body, so `font` is an ALLOWLIST (an arbitrary string here would be
 * stylesheet injection), the color is a 6-digit hex, and size/alignment/
 * direction are the same ranges the admin offers. Nothing is coerced —
 * an out-of-range value is a 400, not a silent clamp, so a broken client is
 * visible instead of quietly restyling a tenant's mail.
 *
 * @param {object} raw
 */
function validateDigestTextBlock(raw) {
  const bad = { bad: true };
  if (raw.id !== undefined && !(typeof raw.id === 'string' && TEXT_BLOCK_ID_RE.test(raw.id))) return bad;
  if (typeof raw.text !== 'string' || raw.text.trim().length === 0 || raw.text.length > MAX_TEXT_LENGTH) {
    return bad;
  }
  if (!TEXT_DIRECTIONS.includes(raw.direction)) return bad;
  if (!DIGEST_FONTS.includes(raw.font)) return bad;
  if (!Number.isInteger(raw.fontSize) || raw.fontSize < FONT_SIZE_MIN || raw.fontSize > FONT_SIZE_MAX) {
    return bad;
  }
  if (!TEXT_ALIGNS.includes(raw.align)) return bad;
  if (typeof raw.color !== 'string' || !COLOR_RE.test(raw.color)) return bad;
  if (raw.bold !== undefined && typeof raw.bold !== 'boolean') return bad;
  return {
    block: {
      type: 'text',
      id: raw.id ?? generateId('x'),
      text: raw.text,
      direction: raw.direction,
      font: raw.font,
      fontSize: raw.fontSize,
      align: raw.align,
      color: raw.color,
      bold: raw.bold === true,
    },
  };
}

/**
 * Validate + normalize the v2 config. Returns { field } on the FIRST
 * violation (nested style fields named 'style.<key>'; array-level problems
 * named 'buttons'/'templates') or { config } with server-generated ids and
 * normalized defaults.
 */
function validateConfig(body) {
  if (typeof body !== 'object' || body === null) return { field: 'body' };
  if (typeof body.boardId !== 'string' || !/^\d+$/.test(body.boardId)) return { field: 'boardId' };
  if (body.peopleColumnId !== null && body.peopleColumnId !== undefined && !isNonEmptyString(body.peopleColumnId)) {
    return { field: 'peopleColumnId' };
  }

  if (!Array.isArray(body.buttons) || body.buttons.length < 1 || body.buttons.length > 20) {
    return { field: 'buttons' };
  }
  const buttons = [];
  for (const raw of body.buttons) {
    if (typeof raw !== 'object' || raw === null) return { field: 'buttons' };
    if (raw.id !== undefined && !(typeof raw.id === 'string' && BUTTON_ID_RE.test(raw.id))) {
      return { field: 'id' };
    }
    if (!isNonEmptyString(raw.name, 40)) return { field: 'name' };
    if (!isNonEmptyString(raw.statusColumnId)) return { field: 'statusColumnId' };
    if (!Number.isInteger(raw.targetIndex) || raw.targetIndex < 0) return { field: 'targetIndex' };
    if (!isNonEmptyString(raw.targetLabel, 40)) return { field: 'targetLabel' };
    const style = raw.style;
    if (typeof style !== 'object' || style === null || typeof style.color !== 'string' || !COLOR_RE.test(style.color)) {
      return { field: 'style.color' };
    }
    const icon = style.icon ?? '';
    if (typeof icon !== 'string' || icon.length > 4) return { field: 'style.icon' };
    if (!['sm', 'md', 'lg'].includes(style.size)) return { field: 'style.size' };
    buttons.push({
      id: raw.id ?? generateId('b'),
      name: raw.name,
      statusColumnId: raw.statusColumnId,
      targetIndex: raw.targetIndex,
      targetLabel: raw.targetLabel,
      style: { color: style.color, icon, size: style.size },
    });
  }
  if (new Set(buttons.map((b) => b.id)).size !== buttons.length) return { field: 'buttons' };
  const buttonIds = new Set(buttons.map((b) => b.id));

  // --- v4 digest block (optional; absent/null → digest: null) ---------------
  let digest = null;
  if (body.digest !== undefined && body.digest !== null) {
    const raw = body.digest;
    if (typeof raw !== 'object') return { field: 'digest' };
    // Person-id matching happens on the TASKS board people column — required.
    if (body.peopleColumnId === null || body.peopleColumnId === undefined) {
      return { field: 'peopleColumnId' };
    }
    if (typeof raw.usersBoardId !== 'string' || !/^\d+$/.test(raw.usersBoardId)) {
      return { field: 'digest.usersBoardId' };
    }
    if (!isNonEmptyString(raw.usersPeopleColumnId)) return { field: 'digest.usersPeopleColumnId' };
    if (!isNonEmptyString(raw.usersEmailColumnId)) return { field: 'digest.usersEmailColumnId' };
    if (!isNonEmptyString(raw.subject, 120)) return { field: 'digest.subject' };

    // --- the body (0.15.0): an ordered block list, or the legacy sections ----
    // `blocks` is the source of truth and `sections` is DERIVED from it, in
    // block order — that derivation is what makes the mail's order the cluster
    // priority (digest-service lets the first matching section claim a task).
    // A body with `sections` and no `blocks` is the pre-0.15.0 admin (and every
    // settings export taken before it): accepted, and given the reconstructed
    // legacy blocks so storage is never left without them.
    let sections;
    let blocks;
    if (raw.blocks !== undefined && raw.blocks !== null) {
      if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > MAX_BLOCKS) {
        return { field: 'digest.blocks' };
      }
      blocks = [];
      let clusterCount = 0;
      for (const b of raw.blocks) {
        if (typeof b !== 'object' || b === null) return { field: 'digest.blocks' };
        if (b.type === 'text') {
          const result = validateDigestTextBlock(b);
          if (result.bad) return { field: 'digest.blocks' };
          blocks.push(result.block);
        } else if (b.type === 'cluster') {
          const result = validateDigestCluster(b, buttonIds);
          if (result.bad) return { field: 'digest.blocks' };
          clusterCount += 1;
          blocks.push({ type: 'cluster', ...result.section });
        } else {
          // An unknown type would be silently dropped by the renderers — refuse
          // it here instead, so a client bug is a 400 and not a missing block.
          return { field: 'digest.blocks' };
        }
      }
      // At least one cluster: a digest with no tasks in it is not a digest.
      // The upper bound is the 0.13.x section cap — clusters drive board reads
      // and the complexity budget, text blocks cost nothing.
      if (clusterCount < 1 || clusterCount > MAX_CLUSTER_BLOCKS) return { field: 'digest.blocks' };
      const ids = blocks.map((b) => b.id);
      if (new Set(ids).size !== ids.length) return { field: 'digest.blocks' };
      sections = sectionsFromBlocks(blocks);
    } else {
      if (
        !Array.isArray(raw.sections) ||
        raw.sections.length < 1 ||
        raw.sections.length > MAX_CLUSTER_BLOCKS
      ) {
        return { field: 'digest.sections' };
      }
      sections = [];
      for (const s of raw.sections) {
        const result = validateDigestCluster(s, buttonIds);
        if (result.bad) return { field: 'digest.sections' };
        sections.push(result.section);
      }
      if (new Set(sections.map((s) => s.id)).size !== sections.length) {
        return { field: 'digest.sections' };
      }
      blocks = legacyBlocksFromSections(sections);
    }

    const sendHour = raw.sendHour === undefined || raw.sendHour === null ? 8 : raw.sendHour;
    if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
      return { field: 'digest.sendHour' };
    }
    digest = {
      usersBoardId: raw.usersBoardId,
      usersPeopleColumnId: raw.usersPeopleColumnId,
      usersEmailColumnId: raw.usersEmailColumnId,
      subject: raw.subject,
      sendHour,
      sections,
      blocks,
    };
  }

  return {
    config: {
      boardId: body.boardId,
      peopleColumnId: body.peopleColumnId ?? null,
      buttons,
      digest,
    },
  };
}

/** YYYY-MM-DD "today" in the app's business timezone (digest overdue rule). */
function todayInJerusalem() {
  return todayInJerusalemFromRun();
}

/**
 * Build the /api router (all routes behind the injected session middleware).
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ baseUrl: string }} deps.env
 * @param {import('express').RequestHandler} deps.requireSession
 * @param {{ send(p: object): Promise<{ id: string }> }} [deps.emailSender] - absent → send answers 409
 * @param {string} [deps.todayIso] - test injection; defaults to Asia/Jerusalem "today"
 * @param {() => Date} [deps.now] - injectable clock for live slot on send/resend
 * @returns {import('express').Router}
 */
export function createAdminRouter({ storage, api, env, requireSession, emailSender, todayIso, now = () => new Date() }) {
  const router = express.Router();
  router.use('/api', requireSession);

  /**
   * Shared digest pipeline: guards (409s) → both board reads → buildDigest →
   * per-recipient render. Returns { status, body } for guard failures or
   * { digestData } on success.
   */
  async function prepareDigest(req) {
    const scopedStorage = storage.forAccount(req.session.accountId);
    const [config, secret, token] = await Promise.all([
      scopedStorage.getConfig(),
      scopedStorage.getLinkSecret(),
      scopedStorage.getOauthToken(),
    ]);
    if (!config?.digest) return { status: 409, body: { error: 'digest_not_configured' } };
    if (!secret) return { status: 409, body: { error: 'no_secret' } };
    if (!token) return { status: 409, body: { error: 'not_connected' } };

    const { digest } = config;
    let tasksRead, usersRead;
    try {
      [tasksRead, usersRead] = await Promise.all([
        api.getBoardItems({
          token,
          boardId: config.boardId,
          columnIds: digestTaskColumnIds(config),
        }),
        api.getBoardItems({
          token,
          boardId: digest.usersBoardId,
          columnIds: [digest.usersPeopleColumnId, digest.usersEmailColumnId],
        }),
      ]);
    } catch (err) {
      if (err instanceof MondayApiError) {
        logError('digest', 'board read failed', {
          error: err.message,
          code: err.code,
          unauthorized: err.unauthorized,
        });
        return { status: 502, body: { error: 'monday_api_failed' } };
      }
      throw err; // non-API failure → guarded() logs and answers 500
    }

    const today = todayIso ?? todayInJerusalem();
    const { recipients, skippedUsers } = buildDigest({
      config,
      tasks: tasksRead.items,
      users: usersRead.items,
      today,
      // Real board label colors (tasks board read) — preview renders with the
      // same colors the send path uses; absent on older doubles → fallback.
      statusColumnColors: tasksRead.statusColumnColors,
    });

    const buttonsById = new Map(config.buttons.map((b) => [b.id, b]));
    /** Recipient + resolved buttons — the shape both renderers consume. */
    const withButtons = (recipient) => decorateRecipientSections(recipient, buttonsById);
    const sendHour = config.digest?.sendHour ?? 8;
    // Sign with the LIVE clock so a copied AMP is immediately submittable in the
    // AMP playground / Gmail (same slot the server will demand). Task filtering
    // still uses `today` above — only the HMAC slot follows `now`.
    const renderArgs = { baseUrl: env.baseUrl, secret, accountId: req.session.accountId };
    // The preview must show what the SEND path builds, so it resolves the blocks
    // exactly the same way — including the reconstruction for a config that
    // predates them (otherwise a legacy tenant would preview a mail with no text
    // and receive one with text).
    const blocks = normalizeDigestBlocks(config.digest);
    const renderPlainFor = (recipient) =>
      renderDigestPlain({ recipient: withButtons(recipient), blocks });
    const renderAmpFor = (recipient) =>
      renderDigestAmp({
        ...renderArgs,
        recipient: withButtons(recipient),
        blocks,
        sendHour,
        now: now(),
      });

    return {
      digestData: {
        config,
        recipients,
        skippedUsers,
        truncated: tasksRead.truncated || usersRead.truncated,
        renderPlainFor,
        renderAmpFor,
      },
    };
  }

  async function handleDigestSend(req, res) {
    if (!emailSender) {
      res.status(409).json({ error: 'email_not_configured' });
      return;
    }
    const out = await runDigestForAccount({
      accountId: req.session.accountId,
      storage,
      api,
      baseUrl: env.baseUrl,
      emailSender,
      todayIso,
      now,
    });
    if (out.skip) {
      const status =
        out.skip === 'monday_api_failed'
          ? 502
          : out.skip === 'email_not_configured'
            ? 409
            : 409;
      res.status(status).json({ error: out.skip });
      return;
    }
    res.json({
      ok: out.failed === 0,
      slot: out.slot,
      results: out.results,
      skippedUsers: out.skippedUsers,
      truncated: out.truncated,
    });
  }

  router.get(
    '/api/digest/preview',
    guarded(async (req, res) => {
      const prep = await prepareDigest(req);
      if (!prep.digestData) {
        res.status(prep.status).json(prep.body);
        return;
      }
      const { recipients, skippedUsers, truncated, renderPlainFor, renderAmpFor } = prep.digestData;
      const wanted =
        typeof req.query.recipient === 'string'
          ? recipients.find((r) => r.email === req.query.recipient)
          : recipients[0];
      res.json({
        recipients: recipients.map(({ email, name, taskCount }) => ({ email, name, taskCount })),
        skippedUsers,
        truncated,
        plain: wanted ? renderPlainFor(wanted) : null,
        amp: wanted ? renderAmpFor(wanted) : null,
      });
    })
  );

  // --- AMP debug lane (owner ask 2026-08-02) ---------------------------------
  // The preview hands the admin the exact amp4email document the renderer
  // produced; this route sends back whatever the admin edited it into. Gmail's
  // only diagnostic for a bad dynamic part is `INTERNAL_ERROR`, so bisecting it
  // means mutating the document by hand and re-sending — which is impossible
  // while the only send path re-renders from config.
  //
  // Deliberately independent of the digest pipeline: no config, no link secret
  // and no monday token are required, because the point is to test the MESSAGE,
  // not the data behind it. The one thing it shares with the real send is
  // buildMultipartAlternative — a debug message assembled differently from the
  // production one would prove nothing about the production one.
  //
  // The admin's bytes are passed through untouched (no re-render, no
  // normalization); only header-injection and size are refused.
  router.post(
    '/api/digest/send-raw',
    guarded(async (req, res) => {
      if (!emailSender) {
        res.status(409).json({ error: 'email_not_configured' });
        return;
      }
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const { amp, to, subject, plain } = body;

      if (typeof amp !== 'string' || amp.trim().length === 0) {
        res.status(400).json({ error: 'invalid_amp', message: 'amp must be a non-empty string' });
        return;
      }
      if (typeof to !== 'string' || !RAW_EMAIL_RE.test(to.trim())) {
        res.status(400).json({ error: 'invalid_recipient', message: 'to must be a single email address' });
        return;
      }
      if (subject !== undefined && subject !== null) {
        if (typeof subject !== 'string' || subject.length > RAW_SUBJECT_MAX || HEADER_BREAK_RE.test(subject)) {
          res.status(400).json({ error: 'invalid_subject', message: 'subject is too long or contains a header break' });
          return;
        }
      }
      if (plain !== undefined && plain !== null && typeof plain !== 'string') {
        res.status(400).json({ error: 'invalid_plain', message: 'plain must be a string when present' });
        return;
      }
      const ampBytes = Buffer.byteLength(amp, 'utf8');
      if (ampBytes > RAW_AMP_MAX_BYTES) {
        res.status(413).json({ error: 'amp_too_large', message: `amp part is ${ampBytes} bytes (max ${RAW_AMP_MAX_BYTES})` });
        return;
      }

      const config = await storage.forAccount(req.session.accountId).getConfig();
      const configuredSubject = typeof config?.digest?.subject === 'string' ? config.digest.subject.trim() : '';
      const finalSubject =
        typeof subject === 'string' && subject.trim().length > 0
          ? subject
          : configuredSubject.length > 0
            ? configuredSubject
            : RAW_FALLBACK_SUBJECT;
      const finalPlain = typeof plain === 'string' && plain.length > 0 ? plain : RAW_FALLBACK_PLAIN;

      const mime = buildMultipartAlternative({ plain: finalPlain, amp });
      let sent;
      try {
        sent = await emailSender.send({
          accountId: req.session.accountId,
          to: to.trim(),
          subject: finalSubject,
          plain: finalPlain,
          amp,
          mime,
        });
      } catch (err) {
        const message = String(err?.message ?? err);
        logError('admin_api', 'raw amp send failed', {
          accountId: req.session.accountId,
          code: err?.code,
          error: message,
        });
        // 502, not 500: the failure belongs to Gmail, and its message IS the
        // debug output the operator came here for. Never swallowed.
        res.status(502).json({ error: 'send_failed', message, code: err?.code ?? null });
        return;
      }

      logInfo('admin_api', 'raw amp sent', {
        accountId: req.session.accountId,
        ampBytes,
        messageId: sent?.id,
      });
      res.json({ ok: true, id: sent?.id ?? null, to: to.trim(), subject: finalSubject, ampBytes });
    })
  );

  router.post('/api/digest/send', guarded(handleDigestSend));

  // T12 / D8 — resend today for ALL recipients using the current slot
  // (same pipeline as send; currentSlot is derived from live `now`).
  router.post('/api/digest/resend-today', guarded(handleDigestSend));


  function guarded(handler) {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        const name = err?.name ? String(err.name) : 'Error';
        const message = err?.message != null ? String(err.message) : String(err);
        const stack = typeof err?.stack === 'string' ? err.stack : undefined;
        logError('admin_api', 'handler failed', {
          path: req.path,
          method: req.method,
          error: message,
          errName: name,
          stack,
        });
        // Authenticated admin only — surface the real failure so draft debugging
        // does not stop at opaque `internal_error` (owner ask 2026-07-27).
        res.status(500).json({
          error: 'internal_error',
          // Path-tagged so the admin pink box / Network tab name the failing route.
          message: `[admin ${req.path}] ${message}`,
          detail: { name, message, stack: stack ?? null },
        });
      }
    };
  }

  router.get(
    '/api/state',
    guarded(async (req, res) => {
      const scoped = storage.forAccount(req.session.accountId);
      const [config, linkSecret, token, googleSender] = await Promise.all([
        scoped.getConfig(),
        scoped.getLinkSecret(),
        scoped.getOauthToken(),
        scoped.getGoogleSender(),
      ]);

      let oauth;
      if (!token) {
        oauth = { status: 'disconnected' };
      } else {
        try {
          const me = await api.fetchMe({ token });
          oauth = { status: 'connected', name: me.name };
        } catch (err) {
          // No refresh tokens exist — ANY failure here means reconnect (§8).
          logError('admin_api', 'oauth liveness probe failed', {
            error: String(err?.message ?? err),
          });
          oauth = { status: 'broken' };
        }
      }

      // T9b Gmail sending identity. `senderAddress` is safe to show — it is
      // the visible From of every message. Tokens are NEVER surfaced.
      // `configured` reports whether the SERVER holds an OAuth client at all,
      // so the UI can tell "nobody connected yet" apart from "credentials are
      // missing on the platform" — two problems with different fixes.
      //
      // Scope sufficiency (owner decision 2026-08-04, findings §5): the SMTP
      // XOAUTH2 send path only works with https://mail.google.com/. A grant
      // without it — every pre-change grant has no scope field at all — is
      // reported 'broken', the same state the admin's reconnect button already
      // handles, so re-consent is signaled without a new UI state.
      const scopeSufficient =
        typeof googleSender?.scope === 'string' &&
        googleSender.scope.includes(REQUIRED_GOOGLE_SCOPE);
      const google = {
        configured: Boolean(env.googleOauthClientId && env.googleOauthClientSecret),
        status: !googleSender
          ? 'disconnected'
          : googleSender.disconnectedAt || !scopeSufficient
            ? 'broken'
            : 'connected',
        senderAddress: googleSender?.senderAddress ?? null,
        // The scope string Google echoed at consent, verbatim. Without it a
        // scope mismatch is invisible to the operator — the admin can only see
        // 'broken' and guess (incident 2026-08-04). Scopes are capability
        // names, never credentials, so this is safe to show.
        grantedScope: typeof googleSender?.scope === 'string' ? googleSender.scope : null,
        // Why the sender broke, when known (e.g. 'google_invalid_grant' from
        // the refresh path). String-coerced — never an object that could leak
        // record internals.
        lastError: googleSender?.lastError != null ? String(googleSender.lastError) : null,
        // The AMP endpoint default-denies senders that are not on the
        // allowlist, so a connected mailbox that is not listed sends mail whose
        // buttons all fail with 403. Surface it rather than let it be debugged
        // from the recipient's side.
        senderAllowedForAmp: googleSender?.senderAddress
          ? env.ampAllowedSenders.includes(googleSender.senderAddress)
          : null,
      };

      // The digest always leaves here WITH blocks — reconstructed on the way out
      // for a config stored before 0.15.0. That is deliberate: the admin SPA
      // then has one shape to edit and needs no migration logic of its own, and
      // the reconstruction stays in one place (services/digest-blocks.js).
      // Storage is untouched; the blocks land there on the operator's next save.
      const stateConfig = config?.digest
        ? { ...config, digest: { ...config.digest, blocks: normalizeDigestBlocks(config.digest) } }
        : config;

      res.json({ config: stateConfig, secret: maskSecret(linkSecret), oauth, google, baseUrl: env.baseUrl });
    })
  );

  router.put(
    '/api/config',
    guarded(async (req, res) => {
      const result = validateConfig(req.body);
      if (result.field) {
        res.status(400).json({ error: 'invalid_config', field: result.field });
        return;
      }
      await storage.forAccount(req.session.accountId).setConfig(result.config);
      // The normalized config (incl. generated ids) — the client re-syncs from it.
      res.json({ ok: true, config: result.config });
    })
  );

  router.post(
    '/api/secret/rotate',
    guarded(async (req, res) => {
      const secret = generateSecret();
      await storage.forAccount(req.session.accountId).setLinkSecret(secret);
      // V6 (D3/D4): the FULL secret is write-only — never returned. The masked
      // form is safe (same as GET /api/state) and lets the admin UI update
      // without a follow-up GET that can race SecureStorage after a write.
      res.json({ ok: true, secret: maskSecret(secret) });
    })
  );

  return router;
}

// Admin API v2 — the ONLY place the secret is readable, always behind the
// sessionToken middleware. Board/column pickers stay client-side
// (monday.api() seamless auth).
//
// v2 config contract (PUT /api/config), validated field-by-field — respond
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
// - templates: array 0..10, each:
//     id: /^t_[A-Za-z0-9_-]{4,16}$/ (server-generated when absent; dupes → 400)
//     name: string 1..40
//     blocks: array 1..30 of either
//       { type:'text', text: string 1..5000, direction:'rtl'|'ltr',
//         font: ALLOWED_FONTS (email-template.js), fontSize: int 10..32,
//         align:'right'|'center'|'left' }
//       { type:'buttons', buttonIds: non-empty array of ids that exist in
//         buttons (after generation) }
// Valid → storage.setConfig(normalized) → 200 { ok: true, config } (the
// normalized config INCLUDING generated ids — the client re-syncs from it).
//
// GET /api/snippet?btn=<id>   → 200 {snippet}; 400 missing btn; 409 no
//                               secret; 404 unknown button
// GET /api/email-template?tpl=<id> → 200 {html} (renderEmailTemplate); same
//                               400/409/404 semantics (404 unknown template)
// GET /api/state + POST /api/secret/rotate — unchanged from v1.

import crypto from 'node:crypto';
import express from 'express';
import { generateSecret, maskSecret } from '../services/secret.js';
import { renderSnippet } from '../helpers/snippet.js';
import { renderEmailTemplate, ALLOWED_FONTS } from '../helpers/email-template.js';
import { renderDigestEmail } from '../helpers/digest-email.js';
import { buildDigest, digestTaskColumnIds } from '../services/digest-service.js';
import { MondayApiError } from '../services/monday-api.js';
import { logError, logInfo } from '../helpers/logger.js';

const BUTTON_ID_RE = /^b_[A-Za-z0-9_-]{4,16}$/;
const TEMPLATE_ID_RE = /^t_[A-Za-z0-9_-]{4,16}$/;
const SECTION_ID_RE = /^s_[A-Za-z0-9_-]{4,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').slice(0, 8)}`;
}

const isNonEmptyString = (v, max = Infinity) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

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

  const rawTemplates = body.templates ?? [];
  if (!Array.isArray(rawTemplates) || rawTemplates.length > 10) return { field: 'templates' };
  const templates = [];
  for (const raw of rawTemplates) {
    if (typeof raw !== 'object' || raw === null) return { field: 'templates' };
    if (raw.id !== undefined && !(typeof raw.id === 'string' && TEMPLATE_ID_RE.test(raw.id))) {
      return { field: 'id' };
    }
    if (!isNonEmptyString(raw.name, 40)) return { field: 'name' };
    if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 30) {
      return { field: 'blocks' };
    }
    const blocks = [];
    for (const block of raw.blocks) {
      if (typeof block !== 'object' || block === null) return { field: 'blocks' };
      if (block.type === 'text') {
        if (!isNonEmptyString(block.text, 5000)) return { field: 'text' };
        if (!['rtl', 'ltr'].includes(block.direction)) return { field: 'direction' };
        if (!ALLOWED_FONTS.includes(block.font)) return { field: 'font' };
        if (!Number.isInteger(block.fontSize) || block.fontSize < 10 || block.fontSize > 32) {
          return { field: 'fontSize' };
        }
        if (!['right', 'center', 'left'].includes(block.align)) return { field: 'align' };
        blocks.push({
          type: 'text',
          text: block.text,
          direction: block.direction,
          font: block.font,
          fontSize: block.fontSize,
          align: block.align,
        });
      } else if (block.type === 'buttons') {
        if (!Array.isArray(block.buttonIds) || block.buttonIds.length < 1) {
          return { field: 'buttonIds' };
        }
        if (!block.buttonIds.every((id) => buttonIds.has(id))) return { field: 'buttonIds' };
        blocks.push({ type: 'buttons', buttonIds: [...block.buttonIds] });
      } else {
        return { field: 'blocks' };
      }
    }
    templates.push({ id: raw.id ?? generateId('t'), name: raw.name, blocks });
  }
  if (new Set(templates.map((t) => t.id)).size !== templates.length) return { field: 'templates' };

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
    if (!Array.isArray(raw.sections) || raw.sections.length < 1 || raw.sections.length > 4) {
      return { field: 'digest.sections' };
    }
    const sections = [];
    for (const s of raw.sections) {
      if (typeof s !== 'object' || s === null) return { field: 'digest.sections' };
      if (s.id !== undefined && !(typeof s.id === 'string' && SECTION_ID_RE.test(s.id))) {
        return { field: 'digest.sections' };
      }
      if (!isNonEmptyString(s.title, 60)) return { field: 'digest.sections' };
      if (!isNonEmptyString(s.dateColumnId)) return { field: 'digest.sections' };
      if (!isNonEmptyString(s.dateColumnTitle, 255)) return { field: 'digest.sections' };
      if (!buttonIds.has(s.buttonId)) return { field: 'digest.sections' };
      // "show by status": a non-empty set of label ids (0 is valid).
      if (
        !Array.isArray(s.includeStatusLabelIds) ||
        s.includeStatusLabelIds.length === 0 ||
        !s.includeStatusLabelIds.every((n) => Number.isInteger(n) && n >= 0)
      ) {
        return { field: 'digest.sections' };
      }
      sections.push({
        id: s.id ?? generateId('s'),
        title: s.title,
        dateColumnId: s.dateColumnId,
        dateColumnTitle: s.dateColumnTitle,
        buttonId: s.buttonId,
        includeStatusLabelIds: [...s.includeStatusLabelIds],
      });
    }
    if (new Set(sections.map((s) => s.id)).size !== sections.length) {
      return { field: 'digest.sections' };
    }
    digest = {
      usersBoardId: raw.usersBoardId,
      usersPeopleColumnId: raw.usersPeopleColumnId,
      usersEmailColumnId: raw.usersEmailColumnId,
      subject: raw.subject,
      sections,
    };
  }

  return {
    config: {
      boardId: body.boardId,
      peopleColumnId: body.peopleColumnId ?? null,
      buttons,
      templates,
      digest,
    },
  };
}

/** YYYY-MM-DD "today" in the app's business timezone (digest overdue rule). */
function todayInJerusalem() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
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
 * @returns {import('express').Router}
 */
export function createAdminRouter({ storage, api, env, requireSession, emailSender, todayIso }) {
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
    });

    const buttonsById = new Map(config.buttons.map((b) => [b.id, b]));
    const renderFor = (recipient) =>
      renderDigestEmail({
        baseUrl: env.baseUrl,
        secret,
        accountId: req.session.accountId,
        recipient: {
          ...recipient,
          sections: recipient.sections.map((s) => ({ ...s, button: buttonsById.get(s.buttonId) })),
        },
      });

    return {
      digestData: {
        config,
        recipients,
        skippedUsers,
        truncated: tasksRead.truncated || usersRead.truncated,
        renderFor,
      },
    };
  }

  router.get(
    '/api/digest/preview',
    guarded(async (req, res) => {
      const prep = await prepareDigest(req);
      if (!prep.digestData) {
        res.status(prep.status).json(prep.body);
        return;
      }
      const { recipients, skippedUsers, truncated, renderFor } = prep.digestData;
      const wanted =
        typeof req.query.recipient === 'string'
          ? recipients.find((r) => r.email === req.query.recipient)
          : recipients[0];
      res.json({
        recipients: recipients.map(({ email, name, taskCount }) => ({ email, name, taskCount })),
        skippedUsers,
        truncated,
        html: wanted ? renderFor(wanted) : null,
      });
    })
  );

  router.post(
    '/api/digest/send',
    guarded(async (req, res) => {
      if (!emailSender) {
        res.status(409).json({ error: 'email_not_configured' });
        return;
      }
      const prep = await prepareDigest(req);
      if (!prep.digestData) {
        res.status(prep.status).json(prep.body);
        return;
      }
      const { config, recipients, skippedUsers, truncated, renderFor } = prep.digestData;

      const results = [];
      for (const recipient of recipients) {
        const base = { email: recipient.email, name: recipient.name, taskCount: recipient.taskCount };
        try {
          await emailSender.send({
            to: recipient.email,
            subject: config.digest.subject,
            html: renderFor(recipient),
          });
          results.push({ ...base, ok: true });
        } catch (err) {
          logError('digest', 'send failed for recipient', {
            email: recipient.email,
            error: String(err?.message ?? err),
          });
          results.push({ ...base, ok: false, error: String(err?.message ?? err) });
        }
      }

      const failures = results.filter((r) => !r.ok).length;
      logInfo('digest', 'manual digest send finished', {
        recipients: results.length,
        failures,
        skipped: skippedUsers.length,
      });
      res.json({ ok: failures === 0, results, skippedUsers, truncated });
    })
  );


  function guarded(handler) {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        logError('admin_api', 'handler failed', {
          path: req.path,
          error: String(err?.message ?? err),
        });
        res.status(500).json({ error: 'internal_error' });
      }
    };
  }

  router.get(
    '/api/state',
    guarded(async (req, res) => {
      const scoped = storage.forAccount(req.session.accountId);
      const [config, linkSecret, token] = await Promise.all([
        scoped.getConfig(),
        scoped.getLinkSecret(),
        scoped.getOauthToken(),
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

      res.json({ config, secret: maskSecret(linkSecret), oauth, baseUrl: env.baseUrl });
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
      // Returned in FULL exactly once — the admin view regenerates snippets.
      res.json({ secret });
    })
  );

  router.get(
    '/api/snippet',
    guarded(async (req, res) => {
      const btnId = req.query.btn;
      if (typeof btnId !== 'string' || btnId.length === 0) {
        res.status(400).json({ error: 'missing_btn' });
        return;
      }
      const scoped = storage.forAccount(req.session.accountId);
      const secret = await scoped.getLinkSecret();
      if (!secret) {
        res.status(409).json({ error: 'no_secret' });
        return;
      }
      const config = await scoped.getConfig();
      const button = config?.buttons?.find((b) => b.id === btnId) ?? null;
      if (!button) {
        res.status(404).json({ error: 'unknown_button' });
        return;
      }
      res.json({
        snippet: renderSnippet({ baseUrl: env.baseUrl, secret, button, accountId: req.session.accountId }),
      });
    })
  );

  router.get(
    '/api/email-template',
    guarded(async (req, res) => {
      const tplId = req.query.tpl;
      if (typeof tplId !== 'string' || tplId.length === 0) {
        res.status(400).json({ error: 'missing_tpl' });
        return;
      }
      const scoped = storage.forAccount(req.session.accountId);
      const secret = await scoped.getLinkSecret();
      if (!secret) {
        res.status(409).json({ error: 'no_secret' });
        return;
      }
      const config = await scoped.getConfig();
      const template = config?.templates?.find((t) => t.id === tplId) ?? null;
      if (!template) {
        res.status(404).json({ error: 'unknown_template' });
        return;
      }
      res.json({
        html: renderEmailTemplate({
          baseUrl: env.baseUrl,
          secret,
          template,
          buttons: config?.buttons ?? [],
          accountId: req.session.accountId,
        }),
      });
    })
  );

  return router;
}

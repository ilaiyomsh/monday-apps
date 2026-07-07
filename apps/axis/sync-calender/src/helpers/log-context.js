// Builds the standard log context that every operational logger call should
// spread. Goal: every line in Axiom stands alone — searchable by acc/usr/obj
// without crossing into SecureStorage. Field names are short on purpose so
// the formatted line stays scannable in `mapps code:logs`.
//
// Field shape (only acc/usr/obj/cfg/prv/item/ev are part of the public schema):
//   acc  — accountId
//   usr  — userId
//   obj  — objectId
//   cfg  — configId, shortened to 8 hex
//   prv  — provider (google | microsoft | monday)
//   item — monday item id (per-event only)
//   ev   — calendar event id, truncated to 12 chars
//
// `undefined` values are filtered by logger#formatMessage, so callers don't
// need to guard against missing fields on partial configs.

import { shortId, maskEmail } from '../services/logger.js';

export function buildSyncCtx(config) {
  if (!config) return {};
  return {
    acc: config.accountId,
    usr: config.userId,
    obj: config.objectId,
    cfg: shortId(config.configId),
    prv: config.provider || undefined,
  };
}

export function buildEventCtx(event, outcome) {
  const ctx = {};
  if (event?.id) ctx.ev = String(event.id).slice(0, 12);
  if (outcome?.itemId) ctx.item = String(outcome.itemId);
  return ctx;
}

export function buildAccountCtx({ accountId, userId, objectId } = {}) {
  return {
    acc: accountId,
    usr: userId,
    obj: objectId,
  };
}

// Verbose context attached only to error lines — gives a human-readable
// anchor (email, event title, link) at the moment investigation starts.
export function buildErrorCtx(config, event) {
  const email = config?.googleUserEmail
    || config?.microsoftUserEmail
    || config?.mondayUserEmail;
  const ctx = {};
  if (email) ctx.email = maskEmail(email);
  if (event?.summary) ctx.title = String(event.summary).slice(0, 60);
  if (event?.htmlLink) ctx.link = event.htmlLink;
  return ctx;
}

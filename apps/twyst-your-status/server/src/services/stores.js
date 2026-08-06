/**
 * stores — the guard's storage seams, multi-tenant by explicit accountId.
 *
 * This module is the BARREL: one factory per file under ./stores/, re-exported
 * here so every existing importer (and the locked test suites) keeps its path.
 *
 * IDENTITY MODEL (owner decision, round322 — no separate "bot" identity):
 * a REVERT is written with the COLUMN'S PRIMARY OWNER's token, so monday
 * records the revert as that owner (the person the settings screen designated).
 * There is no service account. Two token roles, both real owners:
 *   - a per-owner token  `${accountId}:token:${userId}` — used to write a revert
 *     AS that owner when they are the column's primary;
 *   - an account READER  `${accountId}:token:default`   — any authorized owner's
 *     token, used only for READS (labels, item values, rules) and for creating
 *     webhooks. Reads need no particular identity.
 * An owner "authorizes the guard" once (their own monday OAuth — not a bot);
 * that stores their per-owner token AND refreshes the account reader.
 *
 * rulesStore — reads the SAME rules blob the picker writes via client
 *   monday.storage: key `twystStatus:<boardId>:<columnId>`. Corruption is
 *   LOGGED, never thrown; an infrastructure REJECTION is rethrown.
 *
 * PLATFORM TRAP (incident-verified 2026-07-15, mapps cli.md): production
 * apps-sdk SecureStorage 0.1.4 wraps primitives — `{ value: 'str' }` comes
 * back verbatim. unwrapStoredValue() is the one place that difference lives.
 */

export { unwrapStoredValue } from './stores/unwrapStoredValue.js';
// REFRESH_CUSHION_MS was public before the barrel split (round360's caching
// suite pins freshness against it) — keep it on the stable import path.
export { createTokenStore, REFRESH_CUSHION_MS } from './stores/tokenStore.js';
export { createRulesStore } from './stores/rulesStore.js';
export { createBypassLog } from './stores/bypassLog.js';
export { createEnrollmentStore } from './stores/enrollmentStore.js';

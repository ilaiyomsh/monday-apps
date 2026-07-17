// axiomServerSink.js — ships server logger records to Axiom (the SHARED errors
// dataset). Uses @axiomhq/js, the same client verified in production by
// sync-calender. The SDK batches in the background; flushAxiom() drains the
// buffer (the graceful-shutdown guard in index.js calls it).
//
// Activation gate: AXIOM_TOKEN + AXIOM_DATASET (+ AXIOM_APP_NAME, defaulted).
// Local dev without them is structurally inert — attachAxiomServerSink() is a
// no-op and the console transport keeps working untouched.
//
// Ship policy: usage/health (alwaysShip) always; otherwise WARN/ERROR only by
// default. Incident mode: set LOG_SHIP_LEVEL=DEBUG (or INFO) in env to widen —
// remember to unset it after the investigation.
//
// PRIVACY: ships level/tag/message/kind + err_name/err_code/err_msg (error.message
// ONLY scrubbed via scrubMessage: emails / tokens&hex>=16 / digit-runs>=7 redacted,
// capped 200) + first stack frame + allow-listed short id/counter context fields.
// Free-form payloads (emails, event titles, links, GraphQL bodies, tokens) are
// NEVER shipped — the CTX_ALLOW filter mirrors the client transport's discipline.
//
// This is a sink file — exempt from the no-console rule (breadcrumbs only,
// never re-enters the logger: recursion hazard).

import { Axiom } from '@axiomhq/js';

const RANK = { ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 };

const DATASET = process.env.AXIOM_DATASET || null;
const TOKEN = process.env.AXIOM_TOKEN || null;
const APP = process.env.AXIOM_APP_NAME || 'calendar-sync';
const ENV_NAME = process.env.NODE_ENV || 'production';
const SHIP_LEVEL = RANK[String(process.env.LOG_SHIP_LEVEL ?? '').toUpperCase()] ?? RANK.WARN;

// Preserve the prior activation gate: Axiom was enabled whenever TOKEN + DATASET
// were present (APP_NAME always had a default). APP is truthy by default here.
const ACTIVE = Boolean(DATASET && TOKEN && APP);

let client = null;
if (ACTIVE) {
  try {
    client = new Axiom({
      token: TOKEN,
      // Never let an Axiom transport error recurse through the logger.
      onError: (err) => {
        try { console.error(`[axiom-sink] ${err?.message || err}`); } catch { /* */ }
      },
    });
  } catch (e) {
    try { console.error('[axiom-sink] init failed — remote logging disabled:', e); } catch { /* */ }
    client = null;
  }
}

// Context fields worth shipping as-is: short identifiers, operation names and
// counters from this app's log-context vocabulary (helpers/log-context.js) plus
// the monday-api error fields. Everything else in record.context (emails, event
// titles/links, GraphQL bodies, raw messages) stays local — never shipped.
const CTX_ALLOW = new Set([
  // account/config identity (buildSyncCtx / buildAccountCtx / buildEventCtx)
  'acc', 'usr', 'obj', 'cfg', 'prv', 'item', 'ev',
  // sync/backfill counters
  'created', 'updated', 'deleted', 'skipped', 'total', 'total_ms', 'ms',
  // monday-api + http operation fields (short ids / enums / op names)
  'board', 'boardId', 'itemId', 'columnId', 'op', 'code', 'reason',
  'status', 'method', 'path', 'url', 'step',
]);
const FIELD_MAX = 256;

function firstStackFrame(stack) {
  if (typeof stack !== 'string' || stack === '') return undefined;
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim().slice(0, 400);
  }
  return undefined;
}

// scrubMessage — privacy-scrub error.message before it ships as err_msg (D2). Order matters:
// emails FIRST (their local part would otherwise be eaten by the token rule), then long
// token/hex runs (>=16), then digit-runs (>=7). Pre-capped at 1000 to bound regex work, final
// slice 200. Identical spec across app-core, the client template, and this server template.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;

/** Redact PII/secrets from an error message so it can ship as `err_msg` (D2). */
export function scrubMessage(raw) {
  if (typeof raw !== 'string' || raw === '') return '';
  let s = raw.slice(0, MSG_PRECAP);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(TOKEN_RE, '[redacted]');
  s = s.replace(DIGITS_RE, '[num]');
  return s.slice(0, MSG_MAXLEN);
}

/** record → flat Axiom event. Pure function (unit-test seam). */
export function mapRecordToEvent(record) {
  const r = record || {};
  const ev = {
    _time: r.timestampISO || new Date().toISOString(),
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.tag || 'app').toLowerCase(),
    message: String(r.message ?? '').slice(0, 300),
    app: APP,
    env: ENV_NAME,
  };
  // DOMAIN discriminator (matches the client + app-core): error (default) | usage | health.
  // track()/health() set record.domainKind; NEVER ship a rendering kind.
  ev.kind = r.domainKind ?? 'error';
  if (r.correlationId != null) ev.corr = String(r.correlationId);
  const err = r.error;
  if (err != null) {
    if (err.name != null) ev.err_name = String(err.name).slice(0, FIELD_MAX);
    const code = err.errorCode ?? err.status ?? err.code;
    if (code != null) ev.err_code = String(code).slice(0, FIELD_MAX);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1;
    // error.message ships ONLY scrubbed, as err_msg (D2) — the raw message is never handed over
    if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
  }
  const ctx = r.context;
  if (ctx && typeof ctx === 'object') {
    for (const [key, val] of Object.entries(ctx)) {
      if (!CTX_ALLOW.has(key)) continue;
      if (typeof val === 'number' && Number.isFinite(val)) ev[key] = val;
      else if (typeof val === 'string') ev[key] = val.slice(0, FIELD_MAX);
    }
  }
  return ev;
}

/** Ship policy — pure function (unit-test seam). */
export function shouldShip(record) {
  if (!record) return false;
  if (record.duplicate === true) return false; // logger already skips dupes from sinks — defense in depth
  if (record.alwaysShip === true) return true;  // usage/health (INFO) bypass the WARN/ERROR policy (D3/D5)
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  if (rank === undefined || rank < SHIP_LEVEL) return false;
  return true;
}

/**
 * Register the Axiom sink on the server logger. Call once at server startup,
 * right after imports:
 *   import logger from './logger.js';
 *   import { attachAxiomServerSink } from './axiomServerSink.js';
 *   attachAxiomServerSink(logger);
 *
 * @returns {function():void} unsubscribe (no-op when gated off)
 */
export function attachAxiomServerSink(logger) {
  if (!client || !logger?.addSink) return () => {};
  return logger.addSink((record) => {
    // logger fan-out already isolates sink throws; keep the hot path lean
    if (!shouldShip(record)) return;
    client.ingest(DATASET, [mapRecordToEvent(record)]);
  });
}

/** True only when the env gate passed AND the client constructed. */
export function isAxiomSinkActive() {
  return ACTIVE && Boolean(client);
}

/**
 * Drain the SDK's background buffer. Process guards call this on shutdown so the
 * last error before a crash is not lost. Never throws.
 */
export async function flushAxiom() {
  if (!client) return;
  try {
    await client.flush();
  } catch (e) {
    try { console.error('[axiom-sink] flush failed:', e?.message || e); } catch { /* */ }
  }
}

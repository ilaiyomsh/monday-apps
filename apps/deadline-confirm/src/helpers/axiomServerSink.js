/**
 * axiomServerSink.js — ships server logger records to Axiom (the SHARED errors
 * dataset — see error-guard references/remote-monitoring.md).
 *
 * Ported from .claude/skills/error-guard/templates/server/axiomServerSink.js.
 * Uses @axiomhq/js (the same client verified in production by Axis/sync-calender).
 * The SDK batches in the background; flushAxiom() drains the buffer on shutdown.
 *
 * Activation gate: AXIOM_TOKEN + AXIOM_DATASET + AXIOM_APP_NAME. These are read
 * through the caller (index.js passes them in from EnvironmentVariablesManager,
 * NOT process.env — monday-code injects platform env via the SDK secrets file).
 * Without them attachAxiomServerSink() is inert and the console transport keeps
 * working untouched.
 *
 * Ship policy: WARN/ERROR only by default; usage/health (alwaysShip) bypass it.
 * Incident mode: set LOG_SHIP_LEVEL=DEBUG|INFO to widen.
 *
 * PRIVACY: ships level/tag/message/kind + err_name/err_code/err_msg (error.message
 * ONLY scrubbed via scrubMessage: emails / tokens&hex>=16 / digit-runs>=7 redacted,
 * capped 200) + first stack frame + allow-listed numeric/short-string context. The
 * /confirm client ip is stripped upstream by index.js's beforeSend; it is also not
 * in CTX_ALLOW here (defense in depth). This is a sink file — exempt from the
 * no-console rule (breadcrumbs only; never re-enters the logger: recursion hazard).
 */

import { Axiom } from '@axiomhq/js';

const RANK = { ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 };

// scrubMessage — privacy-scrub error.message before it ships as err_msg (D2). Order matters:
// emails FIRST, then long token/hex runs (>=16), then digit-runs (>=7). Pre-capped 1000 to
// bound regex work, final slice 200. Identical spec across app-core, the client template, and
// the server template.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;

// Context fields worth shipping as-is: short identifiers and counters. Everything
// else in record.context stays local. (ip is intentionally absent — PII.)
const CTX_ALLOW = new Set([
  'acc', 'usr', 'obj', 'cfg', 'prv', 'board',
  'created', 'updated', 'deleted', 'skipped', 'ms', 'total', 'total_ms',
  'status', 'method', 'path', 'url', 'step',
  'itemId', 'outcome', 'op', 'ok', 'port',
]);
const FIELD_MAX = 256;

function firstStackFrame(stack) {
  if (typeof stack !== 'string' || stack === '') return undefined;
  // Server stacks are V8-only.
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim().slice(0, 400);
  }
  return undefined;
}

/** Redact PII/secrets from an error message so it can ship as `err_msg` (D2). */
export function scrubMessage(raw) {
  if (typeof raw !== 'string' || raw === '') return '';
  let s = raw.slice(0, MSG_PRECAP);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(TOKEN_RE, '[redacted]');
  s = s.replace(DIGITS_RE, '[num]');
  return s.slice(0, MSG_MAXLEN);
}

/**
 * record → flat Axiom event. Pure function (unit-test seam). Reads config from
 * the passed context so it stays testable without env.
 * @param {object} record
 * @param {{ app?: string, env?: string }} [cfg]
 */
export function mapRecordToEvent(record, cfg = {}) {
  const r = record || {};
  const ev = {
    _time: r.timestampISO || new Date().toISOString(),
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.tag || 'app').toLowerCase(),
    message: String(r.message ?? '').slice(0, 300),
    app: cfg.app ?? null,
    env: cfg.env ?? 'production',
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
      else if (typeof val === 'boolean') ev[key] = val;
      else if (typeof val === 'string') ev[key] = val.slice(0, FIELD_MAX);
    }
  }
  return ev;
}

/**
 * Ship policy — pure function (unit-test seam). Order: !record → false,
 * duplicate → false, alwaysShip → true, THEN level policy.
 * @param {object} record
 * @param {number} [shipLevel] - RANK threshold (default WARN)
 */
export function shouldShip(record, shipLevel = RANK.WARN) {
  if (!record) return false;
  if (record.duplicate === true) return false; // logger already skips dupes — defense in depth
  if (record.alwaysShip === true) return true;  // usage/health (INFO) bypass WARN/ERROR (D3/D5)
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  if (rank === undefined || rank < shipLevel) return false;
  return true;
}

/**
 * Register the Axiom sink on the server logger. Call once at startup:
 *   attachAxiomServerSink(logger, { token, dataset, app, env, shipLevel });
 * Inert (returns a no-op) unless token+dataset+app are all present.
 *
 * @param {{ addSink: (fn: (r: object) => void) => (() => void) }} logger
 * @param {{ token?: string, dataset?: string, app?: string, env?: string, shipLevel?: string }} [opts]
 * @returns {() => void} unsubscribe (no-op when gated off)
 */
export function attachAxiomServerSink(logger, opts = {}) {
  const token = opts.token || null;
  const dataset = opts.dataset || null;
  const app = opts.app || null;
  const env = opts.env || 'production';
  const shipLevel = RANK[String(opts.shipLevel ?? '').toUpperCase()] ?? RANK.WARN;

  if (!token || !dataset || !app || !logger?.addSink) return () => {};

  let client = null;
  try {
    client = new Axiom({
      token,
      // Never let an Axiom transport error recurse through the logger.
      onError: (err) => {
        try { console.error(`[axiom-sink] ${err?.message || err}`); } catch { /* */ }
      },
    });
  } catch (e) {
    try { console.error('[axiom-sink] init failed — remote logging disabled:', e); } catch { /* */ }
    return () => {};
  }

  // Stash the client for flushAxiom() (shutdown drain).
  activeClient = client;

  return logger.addSink((record) => {
    // logger fan-out already isolates sink throws; keep the hot path lean.
    if (!shouldShip(record, shipLevel)) return;
    client.ingest(dataset, [mapRecordToEvent(record, { app, env })]);
  });
}

let activeClient = null;

/** True only when a client has been constructed (env gate passed). */
export function isAxiomSinkActive() {
  return Boolean(activeClient);
}

/**
 * Drain the SDK's background buffer. Process guards call this on shutdown so the
 * last error before a crash is not lost. Never throws.
 */
export async function flushAxiom() {
  if (!activeClient) return;
  try {
    await activeClient.flush();
  } catch (e) {
    try { console.error('[axiom-sink] flush failed:', e?.message || e); } catch { /* */ }
  }
}

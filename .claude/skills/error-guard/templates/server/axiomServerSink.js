/**
 * axiomServerSink.js — ships server logger records to Axiom (the SHARED errors
 * dataset — see error-guard references/remote-monitoring.md).
 *
 * Uses @axiomhq/js (`npm install @axiomhq/js`), the same client verified in
 * production by Axis/sync-calender. The SDK batches in the background; flush()
 * drains the buffer (process guards call it on shutdown).
 *
 * Activation gate: AXIOM_TOKEN + AXIOM_DATASET + AXIOM_APP_NAME env vars.
 * Local dev without them is structurally inert — attachAxiomServerSink() is a
 * no-op and the console transport keeps working untouched.
 *
 * Ship policy: WARN/ERROR only by default. Incident mode: set LOG_SHIP_LEVEL=DEBUG
 * (or INFO) in env to widen — remember to unset it after the investigation.
 *
 * PRIVACY: ships level/tag/message + err_name/err_code/first stack frame +
 * numeric context fields and short string ids. Free-form payloads (request
 * bodies, GraphQL responses, tokens) are NEVER shipped — the field filter here
 * mirrors the client transport's allowlist discipline.
 *
 * This is a sink file — exempt from the no-console rule (breadcrumbs only,
 * never re-enters the logger: recursion hazard).
 */

import { Axiom } from '@axiomhq/js';

const RANK = { ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 };

const DATASET = process.env.AXIOM_DATASET || null;
const TOKEN = process.env.AXIOM_TOKEN || null;
const APP = process.env.AXIOM_APP_NAME || null;
const ENV_NAME = process.env.NODE_ENV || 'production';
const SHIP_LEVEL = RANK[String(process.env.LOG_SHIP_LEVEL ?? '').toUpperCase()] ?? RANK.WARN;

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

// Context fields worth shipping as-is: short identifiers and counters, per the
// status-hub vocabulary. Everything else in record.context stays local.
const CTX_ALLOW = new Set([
  'acc', 'usr', 'obj', 'cfg', 'prv', 'board',
  'created', 'updated', 'deleted', 'skipped', 'ms', 'total', 'total_ms',
  'status', 'method', 'path', 'url', 'step'
]);
const FIELD_MAX = 256;

function firstStackFrame(stack) {
  if (typeof stack !== 'string' || stack === '') return undefined;
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim().slice(0, 400);
  }
  return undefined;
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
  if (r.correlationId != null) ev.corr = String(r.correlationId);
  const err = r.error;
  if (err != null) {
    if (err.name != null) ev.err_name = String(err.name).slice(0, FIELD_MAX);
    const code = err.errorCode ?? err.status ?? err.code;
    if (code != null) ev.err_code = String(code).slice(0, FIELD_MAX);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1;
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
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  if (rank === undefined || rank < SHIP_LEVEL) return false;
  if (record.duplicate === true) return false; // logger already skips dupes from sinks — defense in depth
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

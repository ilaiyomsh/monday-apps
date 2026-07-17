// Tiny structured logger. Format: `[tag] message | k=v | k=v`. Designed to be
// grep-friendly in `mapps code:logs` and noise-free in production.
//
// v2 pipeline (Axiom logging v2): a single emit() choke-point renders to the
// console AND fans records out to registered sinks. Remote shipping lives in
// axiomServerSink.js (attach it once at startup) — this file no longer talks to
// Axiom directly. Keeps the `(message, tag, context)` call signature and the
// exported helpers `flush` / `maskEmail` / `shortId` used across routes/services.
//
// Levels (least → most verbose): ERROR, WARN, INFO, DEBUG. Default is INFO.
// Set LOG_LEVEL=DEBUG in env to surface per-API-call traces during a debug
// session; production should stay on INFO so a healthy minute is ~one line
// per webhook.
//
// Conventions enforced by callers:
//   ERROR — flow failed, requires operator attention
//   WARN  — flow recovered (e.g. token refresh failed → marked disconnected)
//   INFO  — one summary line per logical operation (sync, webhook, oauth, …)
//   DEBUG — per-request / per-event traces
//
// Sinks: addSink(fn) receives every non-duplicate record that passes the sink
// gate (WARN/ERROR always reach sinks even when the console level filters them;
// DEBUG reaches sinks only when LOG_LEVEL=DEBUG). Each sink runs in its own
// try/catch so a failing sink can never throw back into emit or recurse.
//
// This file owns the console and is exempt from the no-console lint rule.

import { Logger as MondayLogger } from '@mondaycom/apps-sdk';
import { flushAxiom } from './axiomServerSink.js';

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

const APP_NAME = process.env.AXIOM_APP_NAME || 'calendar-sync';

// monday Logger expects an app-level tag. Per-call tags become part of the
// formatted message string (preserves the existing `[tag]` prefix in CLI logs).
const mondayLogger = new MondayLogger(APP_NAME);

// ============================================
// Sink infrastructure: registry, log-once, beforeSend
// ============================================

const sinks = new Set();
let loggedIdCounter = 0;

/** beforeSend transform (record => record | null) — redaction/enrichment/suppression. */
let beforeSend = (record) => record;

const dispatchToSinks = (record) => {
  if (sinks.size === 0) return;
  for (const sink of sinks) {
    try {
      sink(record);
    } catch (sinkError) {
      // A failing sink must not throw back and must not re-enter the logger.
      // eslint-disable-next-line no-console
      console.error('[logger] sink threw and was suppressed:', sinkError);
    }
  }
};

// ============================================
// Console rendering
// ============================================

function formatLine(record) {
  const parts = [`[${record.tag}]`, record.message];
  const ctx = record.context;
  if (ctx && typeof ctx === 'object') {
    for (const [key, val] of Object.entries(ctx)) {
      if (val === undefined || val === null) continue;
      // An Error instance is lifted to record.error and rendered separately —
      // skip it here so we don't emit `error={}`. A string `error` field (the
      // common `{ error: err.message }` pattern) still renders inline.
      if (key === 'error' && val instanceof Error) continue;
      let str;
      try {
        str = typeof val === 'string' ? val : JSON.stringify(val);
      } catch {
        str = String(val);
      }
      parts.push(`${key}=${str}`);
    }
  }
  if (record.error) {
    parts.push(`err=${record.error.name ?? 'Error'}: ${record.error.message ?? ''}`);
    if (record.correlationId) parts.push(`corr=${record.correlationId}`);
  }
  return parts.join(' | ');
}

// monday's SDK Logger (Pino under the hood) only emits `info` and `error`
// to stdout — `warn` and `debug` are silently dropped. To keep every log
// line visible in `mapps code:logs`, we route info/error through their
// Logger (proper labeling + CLI integration) and fall back to console.*
// for the levels it drops.
function renderToConsole(record) {
  if (!record.consoleEnabled) return;
  const line = formatLine(record);
  try {
    if (record.level === 'INFO') {
      mondayLogger.info(line);
    } else if (record.level === 'ERROR') {
      mondayLogger.error(line);
      if (record.error?.stack) console.error(record.error.stack);
    } else if (record.level === 'WARN') {
      // monday Logger drops warn → use console.warn directly to preserve visibility.
      console.warn(line);
    } else {
      // DEBUG: same story — console.log.
      console.log(line);
    }
  } catch {
    try {
      console.log(line);
    } catch {
      /* rendering must never throw into the app */
    }
  }
}

// ============================================
// emit — the single choke-point
// ============================================

/**
 * @param {Object} record
 * @param {string} record.level - ERROR | WARN | INFO | DEBUG
 * @param {string} record.tag - category (webhook, sync, oauth, scheduler, monday_api, ...)
 * @param {string} record.message - stable event id (webhook_received, sync_done, ...)
 * @param {Object} [record.context] - structured fields; context.error (an Error) is lifted
 * @param {boolean} record.consoleEnabled
 */
const emit = (record) => {
  const ts = Date.now();
  record.timestamp = ts;
  record.timestampISO = new Date(ts).toISOString();

  // --- lift an Error out of context so log-once and sinks see it structured ---
  const ctx = record.context;
  if (record.error === undefined && ctx && typeof ctx === 'object' && ctx.error instanceof Error) {
    record.error = ctx.error;
  }

  // --- log-once: mark the Error instance so one error = one sink record ---
  const err = record.error;
  if (err && typeof err === 'object') {
    if (err.__loggedId !== undefined) {
      record.duplicate = true;
      record.correlationId = record.correlationId || err.correlationId || err.__loggedId;
    } else {
      const id = err.correlationId || `log_${process.pid}_${++loggedIdCounter}`;
      try {
        Object.defineProperty(err, '__loggedId', {
          value: id, enumerable: false, configurable: true, writable: true,
        });
        if (err.correlationId === undefined) {
          Object.defineProperty(err, 'correlationId', {
            value: id, enumerable: false, configurable: true, writable: true,
          });
        }
      } catch {
        // frozen object — do not block logging
      }
      record.duplicate = false;
      record.correlationId = id;
    }
  }

  // --- beforeSend: redaction / enrichment / suppression choke-point ---
  let outgoing = record;
  try {
    outgoing = beforeSend(record);
  } catch (transformError) {
    // eslint-disable-next-line no-console
    console.error('[logger] beforeSend threw and was ignored:', transformError);
    outgoing = record;
  }
  if (outgoing === null || outgoing === undefined) return;

  renderToConsole(outgoing);

  // Duplicates are rendered (console reflects the call) but never re-shipped.
  if (!outgoing.duplicate) {
    dispatchToSinks(outgoing);
  }
};

// ============================================
// encodeDims — usage/health message encoder (D4)
// ============================================

/**
 * Fold categorical/measured dims into a stable, queryable message suffix:
 * `base key1=v1 key2=v2` with keys sorted. Only string/bool/finite-number values are
 * included (objects, functions, NaN/Infinity dropped) so the shipped message stays flat
 * and APL-parseable. Used by track()/health() to encode usage/health dims (D4). Identical
 * spec across app-core, the client template, and this server template (single wire format).
 *
 * @param {string} base - the event/signal name
 * @param {Object} [dims] - categorical/measured dims
 * @returns {string}
 */
export function encodeDims(base, dims) {
  if (!dims) return base;
  const parts = [];
  for (const key of Object.keys(dims).sort()) {
    const v = dims[key];
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      parts.push(`${key}=${v}`);
    }
  }
  return parts.length ? `${base} ${parts.join(' ')}` : base;
}

// ============================================
// Public API
// ============================================

const makeLevelFn = (LEVEL) => (message, tag = 'app', context = undefined) => {
  const rank = LOG_LEVELS[LEVEL];
  // WARN/ERROR always reach sinks even when the console level filters them.
  const consoleEnabled = currentLogLevel >= rank;
  if (!consoleEnabled && rank > LOG_LEVELS.WARN) return; // DEBUG/INFO below level: full skip
  emit({
    level: LEVEL,
    tag: String(tag),
    message,
    context: context && typeof context === 'object' ? context
      : context !== undefined ? { data: context } : undefined,
    error: context instanceof Error ? context : undefined,
    consoleEnabled,
  });
};

const error = makeLevelFn('ERROR');
const warn = makeLevelFn('WARN');
const info = makeLevelFn('INFO');
const debug = makeLevelFn('DEBUG');

/**
 * track — usage telemetry (D3): an INFO record, domainKind 'usage', alwaysShip:true, so it
 * reaches the Axiom sink regardless of the WARN/ERROR ship policy. Dims fold into the message
 * via encodeDims (D4). Emits directly (bypasses the level-gate early-return in makeLevelFn).
 * @param {string} event - stable event id
 * @param {Object} [dims] - categorical/measured dims folded into the message
 */
const track = (event, dims) => emit({
  level: 'INFO', tag: 'usage', message: encodeDims(event, dims),
  domainKind: 'usage', alwaysShip: true, consoleEnabled: currentLogLevel >= LOG_LEVELS.INFO,
});

/**
 * health — health signal (D5): an INFO record, domainKind 'health', alwaysShip:true.
 * Metrics fold into the message via encodeDims (D4).
 * @param {string} signal - stable signal id
 * @param {Object} [metrics] - measured metrics folded into the message
 */
const health = (signal, metrics) => emit({
  level: 'INFO', tag: 'health', message: encodeDims(signal, metrics),
  domainKind: 'health', alwaysShip: true, consoleEnabled: currentLogLevel >= LOG_LEVELS.INFO,
});

/** Register an additional sink (e.g. the Axiom server sink). Returns unsubscribe. */
const addSink = (fn) => {
  if (typeof fn !== 'function') return () => {};
  sinks.add(fn);
  return () => sinks.delete(fn);
};
const removeSink = (fn) => { sinks.delete(fn); };

/** Install the beforeSend transform (record => record | null). */
const setBeforeSend = (fn) => {
  beforeSend = typeof fn === 'function' ? fn : (record) => record;
};

// Drain any in-flight Axiom batch. Delegates to the Axiom server sink so the
// existing call site (graceful shutdown in index.js) keeps working; a no-op
// when the sink is gated off. Caller should race this against a short timeout —
// never block process teardown if Axiom is unreachable.
export async function flush() {
  await flushAxiom();
}

// PII masking — keep first letter of local part, hide the rest, keep domain.
// "ilai@twyst.co.il" → "i***@twyst.co.il". Returns '' / null untouched.
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) return `${local}***${domain}`;
  return `${local[0]}***${domain}`;
}

// Trim a configId to its short suffix for log readability:
//   "config_c18e4d79-0e88-4ed4-9560-536ec583d349" → "c18e4d79"
export function shortId(id) {
  if (!id || typeof id !== 'string') return id;
  const parts = id.split('_');
  const tail = parts[parts.length - 1] || id;
  return tail.split('-')[0] || tail.slice(0, 8);
}

const logger = {
  error,
  warn,
  info,
  debug,
  track,
  health,
  addSink,
  removeSink,
  setBeforeSend,
  emit,
  flush,
};

export default logger;
export { LOG_LEVELS };

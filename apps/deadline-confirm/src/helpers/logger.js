// Structured logging. The /confirm attempt line is the spec §6 contract:
// exactly { ts, ip, itemId, outcome } — never secrets, never item content.
//
// Axiom logging v2 (2026-07): this module gained a single sink pipeline
// (emit → beforeSend → fan-out) plus the usage/health primitives (encodeDims,
// track, health) shared across every monday app. The three legacy line writers
// below (logAttempt / logError / logInfo) keep their EXACT stdout/stderr JSON
// shapes — they are locked by tests/core-output.test.js — and additionally feed
// the sink pipeline so records can ship to Axiom (gated + attached in index.js).
// This file owns the console and is exempt from any no-console lint rule.

// ============================================
// Sink infrastructure: registry + beforeSend + emit choke-point
// ============================================

const sinks = new Set();
let loggedIdCounter = 0;

/** beforeSend transform (record => record | null) — redaction / enrichment / suppression. */
let beforeSend = (record) => record;

/**
 * Register an additional sink (e.g. the Axiom server sink). Each sink runs in
 * its own try/catch so a failing sink can never throw back into emit or recurse.
 * @param {(record: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function addSink(fn) {
  if (typeof fn !== 'function') return () => {};
  sinks.add(fn);
  return () => sinks.delete(fn);
}

/** Remove a registered sink. */
export function removeSink(fn) {
  sinks.delete(fn);
}

/** Install the beforeSend transform (record => record | null). Pass nothing to reset. */
export function setBeforeSend(fn) {
  beforeSend = typeof fn === 'function' ? fn : (record) => record;
}

const dispatchToSinks = (record) => {
  if (sinks.size === 0) return;
  for (const sink of sinks) {
    try {
      sink(record);
    } catch (sinkError) {
      // A failing sink must not throw back and must not re-enter the logger.
      console.error('[logger] sink threw and was suppressed:', sinkError);
    }
  }
};

/**
 * The single sink choke-point. Console rendering is owned by the three line
 * writers below (so their locked byte-exact output is untouched); emit handles
 * ONLY timestamp normalization, log-once dedup, beforeSend and sink fan-out.
 * With no sinks registered it is a pure no-op (the locked tests run this path).
 *
 * @param {object} record - { level, tag, message, context?, error?, domainKind?, alwaysShip? }
 */
export function emit(record) {
  const ts = Date.now();
  record.timestamp = ts;
  record.timestampISO = new Date(ts).toISOString();

  // Lift an Error out of context so log-once and sinks see it structured.
  const ctx = record.context;
  if (record.error === undefined && ctx && typeof ctx === 'object' && ctx.error instanceof Error) {
    record.error = ctx.error;
  }

  // log-once: mark the Error instance so one error = one shipped record.
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

  // beforeSend: redaction / enrichment / suppression choke-point.
  let outgoing = record;
  try {
    outgoing = beforeSend(record);
  } catch (transformError) {
    console.error('[logger] beforeSend threw and was ignored:', transformError);
    outgoing = record;
  }
  if (outgoing === null || outgoing === undefined) return;

  // Duplicates are never re-shipped (log-once).
  if (!outgoing.duplicate) dispatchToSinks(outgoing);
}

// ============================================
// encodeDims — usage/health message encoder (D4)
// ============================================

/**
 * Fold categorical/measured dims into a stable, queryable message suffix:
 * `base key1=v1 key2=v2` with keys sorted. Only string/bool/finite-number values are
 * included (objects, functions, NaN/Infinity dropped) so the shipped message stays flat
 * and APL-parseable. Identical spec across app-core, the client template, and the server
 * template (a single wire format).
 *
 * @param {string} base - the event/signal name
 * @param {object} [dims] - categorical/measured dims
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
// Legacy line writers — LOCKED byte-exact output (tests/core-output.test.js)
// ============================================

/**
 * Log one /confirm attempt as a single JSON line to stdout.
 * Shape: {"ts":"<ISO-8601>","ip":"<ip>","itemId":"<id|null>","outcome":"<outcome>"}
 * outcome ∈ ok | bad_key | rate_limited | wrong_status | wrong_board |
 *           expired | not_found | no_config | api_error | bad_request
 * @param {{ ip: string, itemId: string|null, outcome: string }} entry
 */
export function logAttempt({ ip, itemId, outcome }) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ip, itemId, outcome }));
  // Feed the sink pipeline (tag 'attempt' — index.js's beforeSend scrubs ip PII).
  emit({ level: 'INFO', tag: 'attempt', message: 'confirm_attempt', context: { ip, itemId, outcome } });
}

/**
 * Server-side error detail (guard reasons, API failures). Single JSON line to
 * stderr: {"ts", "level":"error", "tag", "message", ...context}. Context must
 * never include secrets or tokens.
 * @param {string} tag
 * @param {string} message
 * @param {object} [context]
 */
export function logError(tag, message, context = {}) {
  console.error(
    JSON.stringify({ ts: new Date().toISOString(), level: 'error', tag, message, ...context })
  );
  emit({ level: 'ERROR', tag, message, context });
}

/**
 * Operational info line to stdout: {"ts", "level":"info", "tag", "message", ...context}.
 * @param {string} tag
 * @param {string} message
 * @param {object} [context]
 */
export function logInfo(tag, message, context = {}) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level: 'info', tag, message, ...context })
  );
  emit({ level: 'INFO', tag, message, context });
}

// ============================================
// v2 usage/health primitives (D3/D4/D5)
// ============================================

/**
 * track — usage telemetry (D3): an INFO record carrying domainKind 'usage' and
 * alwaysShip:true, so it reaches the Axiom sink regardless of the WARN/ERROR ship
 * policy. Dims fold into the message via encodeDims (D4). Renders a JSON info line
 * to stdout for `mapps code:logs` visibility (dims live inside `message`, never as
 * top-level keys — the confirm attempt-line contract counts only lines with an
 * 'outcome' key).
 * @param {string} event - stable event id
 * @param {object} [dims] - categorical/measured dims folded into the message
 */
export function track(event, dims) {
  const message = encodeDims(event, dims);
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', tag: 'usage', message }));
  emit({ level: 'INFO', tag: 'usage', message, domainKind: 'usage', alwaysShip: true });
}

/**
 * health — health signal (D5): an INFO record, domainKind 'health', alwaysShip:true.
 * Metrics fold into the message via encodeDims (D4).
 * @param {string} signal - stable signal id (e.g. 'boot', 'api_latency')
 * @param {object} [metrics] - measured metrics folded into the message
 */
export function health(signal, metrics) {
  const message = encodeDims(signal, metrics);
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', tag: 'health', message }));
  emit({ level: 'INFO', tag: 'health', message, domainKind: 'health', alwaysShip: true });
}

// A logger-shaped default export so call sites can do `logger.track(...)`,
// `logger.health(...)`, `logger.addSink(...)` — and attachAxiomServerSink(logger).
const logger = {
  logAttempt, logError, logInfo,
  track, health, encodeDims,
  emit, addSink, removeSink, setBeforeSend,
};

export default logger;

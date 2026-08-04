/**
 * logger — structured JSON lines to stdout/stderr (monday-code captures them via
 * `mapps code:logs`) PLUS a sink pipeline so WARN/ERROR records ship to Axiom
 * through the vendored axiomServerSink (error-guard remote-monitoring standard).
 *
 * Two call shapes coexist by design:
 *   - the guard's native writers `info|warn|error|debug(message, tag, context)`
 *     used across guard-routes/handler/stores/oauth/api/auth — UNCHANGED signature;
 *   - error-kit's `logError|logWarn|logInfo(tag, message, context)` (tag FIRST),
 *     which the vendored process-guards.js calls (`logger.logError('server', …)`).
 * Both render a console line AND funnel through emit() so a single record reaches
 * every registered sink. With no sink attached emit() is a pure no-op.
 *
 * The console line shape is preserved from the pre-sink logger (level/tag/message
 * /context); Axiom shipping is additive and gated on the AXIOM_* secrets in index.js.
 */

// ============================================
// Sink infrastructure: registry + beforeSend + emit choke-point
// ============================================

const sinks = new Set();
let loggedIdCounter = 0;

/** beforeSend transform (record => record | null) — redaction / enrichment / suppression. */
let beforeSend = (record) => record;

/**
 * Register an additional sink (e.g. the Axiom server sink). Each sink runs in its
 * own try/catch so a failing sink can never throw back into emit or recurse.
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
 * The single sink choke-point: timestamp normalization, log-once dedup, beforeSend,
 * and sink fan-out. Console rendering is owned by the level writers below, so this
 * is purely the SHIP path. With no sinks registered it is a no-op.
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
// Console line writers + emit fan-out
// ============================================

/** Render the greppable JSON line monday-code captures. */
function line(level, message, tag, context) {
  const record = {
    ts: new Date().toISOString(),
    level,
    tag: tag ?? 'guard',
    message: String(message),
    ...(context && typeof context === 'object' ? { context } : {}),
  };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(record));
}

/**
 * A native writer: render the console line AND feed the sink pipeline. `level` is
 * lowercased for the console line (existing shape) and upper-cased for the record
 * (the ship policy ranks ERROR/WARN/INFO/DEBUG).
 */
function write(level, message, tag, context) {
  line(level, message, tag, context);
  emit({ level: level.toUpperCase(), tag: tag ?? 'guard', message: String(message), context });
}

const logger = {
  debug: (message, tag, context) => write('debug', message, tag, context),
  info: (message, tag, context) => write('info', message, tag, context),
  warn: (message, tag, context) => write('warn', message, tag, context),
  error: (message, tag, context) => write('error', message, tag, context),

  // error-kit signature (tag FIRST) for the vendored process-guards.js and any
  // caller mirroring the cross-app server logger. Same pipeline, params reordered.
  logInfo: (tag, message, context) => write('info', message, tag, context),
  logWarn: (tag, message, context) => write('warn', message, tag, context),
  logError: (tag, message, context) => write('error', message, tag, context),

  emit,
  addSink,
  removeSink,
  setBeforeSend,
};

export default logger;

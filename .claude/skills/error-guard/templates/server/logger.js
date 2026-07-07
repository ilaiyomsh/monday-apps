/**
 * logger.js (SERVER) — single-choke-point logging pipeline for Node/Express
 * monday-code apps. Same contract as the client template (emit choke-point,
 * log-once, addSink fan-out, beforeSend), adapted to a server runtime.
 *
 * SIGNATURE NOTE — server calls are `(message, tag, context)` (hub/status-dashboard
 * convention: `tag` is the category, `message` is a stable event id), NOT the
 * client's `(module, message, data)`. Do not mix the two shapes in one process.
 *
 * Console rendering (ALL console output lives here — never call console.* from
 * application code):
 *   - info/error route through @mondaycom/apps-sdk Logger when the package is
 *     installed (keeps `mapps code:logs` labeling). VERIFIED QUIRK (sync-calender,
 *     in production): the monday Logger — Pino under the hood — silently DROPS
 *     `warn` and `debug`; those levels go to bare console.warn/console.log here.
 *   - Without apps-sdk (plain Node app): everything goes to console.*.
 *   Format: `[tag] message | k=v | k=v` — grep-friendly in `mapps code:logs`.
 *
 * Levels: ERROR < WARN < INFO < DEBUG. Default INFO; override with LOG_LEVEL env.
 * A healthy production minute should be ~one INFO line per logical operation.
 *
 * Sinks: addSink(fn) receives every non-duplicate record that passes the level
 * gate for sinks (WARN/ERROR always reach sinks even when the console level
 * filters them; DEBUG reaches sinks only when LOG_LEVEL=DEBUG). Each sink runs in
 * its own try/catch — a failing sink can never throw back into emit or recurse.
 *
 * This file owns the console and is exempt from the no-console lint rule.
 */

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

const currentLevel =
  LOG_LEVELS[String(process.env.LOG_LEVEL ?? '').toUpperCase()] ?? LOG_LEVELS.INFO;

const APP_NAME = process.env.AXIOM_APP_NAME || process.env.APP_NAME || 'app';

// monday apps-sdk Logger is optional: present on monday-code apps, absent on plain
// Node. Loaded dynamically so this template drops into both without edits.
let mondayLogger = null;
try {
  const sdk = await import('@mondaycom/apps-sdk');
  if (sdk?.Logger) mondayLogger = new sdk.Logger(APP_NAME);
} catch {
  // not installed — console-only rendering, which is fully supported
}

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

const formatLine = (record) => {
  const parts = [`[${record.tag}]`, record.message];
  const ctx = record.context;
  if (ctx && typeof ctx === 'object') {
    for (const [key, val] of Object.entries(ctx)) {
      if (val === undefined || val === null) continue;
      if (key === 'error') continue; // rendered separately below
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
};

const renderToConsole = (record) => {
  if (!record.consoleEnabled) return;
  const line = formatLine(record);
  try {
    if (record.level === 'INFO' && mondayLogger) {
      mondayLogger.info(line);
    } else if (record.level === 'ERROR' && mondayLogger) {
      mondayLogger.error(line);
      if (record.error?.stack) console.error(record.error.stack);
    } else if (record.level === 'ERROR') {
      console.error(line);
      if (record.error?.stack) console.error(record.error.stack);
    } else if (record.level === 'WARN') {
      // monday Logger drops warn — bare console.warn preserves visibility
      console.warn(line);
    } else {
      // DEBUG (and INFO without apps-sdk): monday Logger drops debug — console.log
      console.log(line);
    }
  } catch {
    try {
      console.log(line);
    } catch {
      /* rendering must never throw into the app */
    }
  }
};

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
          value: id, enumerable: false, configurable: true, writable: true
        });
        if (err.correlationId === undefined) {
          Object.defineProperty(err, 'correlationId', {
            value: id, enumerable: false, configurable: true, writable: true
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
// Public API
// ============================================

const makeLevelFn = (LEVEL) => (message, tag = 'app', context = undefined) => {
  const rank = LOG_LEVELS[LEVEL];
  // WARN/ERROR always reach sinks even when the console level filters them.
  const consoleEnabled = currentLevel >= rank;
  if (!consoleEnabled && rank > LOG_LEVELS.WARN) return; // DEBUG/INFO below level: full skip
  emit({
    level: LEVEL,
    tag: String(tag),
    message,
    context: context && typeof context === 'object' ? context
      : context !== undefined ? { data: context } : undefined,
    error: context instanceof Error ? context : undefined,
    consoleEnabled
  });
};

const logger = {
  error: makeLevelFn('ERROR'),
  warn: makeLevelFn('WARN'),
  info: makeLevelFn('INFO'),
  debug: makeLevelFn('DEBUG'),

  /** Express access-log helpers (used by request-logger middleware). */
  request: (req) => {
    logger.debug('request_received', 'http', { method: req.method, url: req.originalUrl });
  },
  response: (req, statusCode, duration) => {
    const fn = statusCode >= 500 ? logger.error : statusCode >= 400 ? logger.warn : logger.debug;
    fn('request_completed', 'http', {
      method: req.method, url: req.originalUrl, status: statusCode, ms: duration
    });
  },

  /** Register an additional sink (e.g. the Axiom server sink). Returns unsubscribe. */
  addSink: (fn) => {
    if (typeof fn !== 'function') return () => {};
    sinks.add(fn);
    return () => sinks.delete(fn);
  },
  removeSink: (fn) => { sinks.delete(fn); },

  /** Install the beforeSend transform (record => record | null). */
  setBeforeSend: (fn) => {
    beforeSend = typeof fn === 'function' ? fn : (record) => record;
  },

  /** The single choke-point — exposed for tests and advanced use. */
  emit,

  getLevel: () => Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k] === currentLevel)
};

export default logger;
export { LOG_LEVELS };

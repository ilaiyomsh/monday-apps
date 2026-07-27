/**
 * Logger ג€” single-choke-point logging pipeline with debug gating and a sink registry.
 *
 * @overview
 * A dependency-free, drop-in logger for browser (client) monday.com apps. Every public
 * method builds a structured record and routes it through emit(record) ג€” the ONE choke-point.
 * emit is responsible for:
 *   1. timestamp normalization (epoch + ISO).
 *   2. log-once dedup: the same Error instance is marked via error.__loggedId and is reported
 *      to sinks only once (console still reflects the call, but the record is flagged duplicate
 *      and skipped from sink fan-out).
 *   3. beforeSend transform: a single settable hook (record => record | null) where PII
 *      redaction, enrichment, and first-party stack filtering plug in (see setBeforeSend).
 *   4. console rendering: ALL console output lives inside emit (via renderToConsole) ג€” never
 *      call console.* from application code.
 *   5. ring buffer: retains the last RING_BUFFER_SIZE records for replay / flush.
 *   6. fan-out to registered sinks (addSink) ג€” each sink dispatched in its own try/catch so a
 *      failing sink can never throw back into emit or recurse.
 *
 * @usage
 * ```javascript
 * import logger from './utils/logger';
 *
 * // Level-based logs
 * logger.debug('ModuleName', 'Debug message', optionalData);
 * logger.info('ModuleName', 'Info message', optionalData);
 * logger.warn('ModuleName', 'Warning message', optionalData);
 * logger.error('ModuleName', 'Error message', errorObject);
 *
 * // API-specific logs
 * logger.api('functionName', query, variables);
 * logger.apiResponse('functionName', response, durationMs);
 * logger.apiError('functionName', error, { query, rawResponse });
 *
 * // Register an extra sink (e.g. a future remote monitoring target)
 * const unsub = logger.addSink((record) => { ... });
 * logger.removeSink(fn);
 *
 * // Install a beforeSend transform (redaction / suppression / enrichment)
 * logger.setBeforeSend((record) => record.context?.secret ? null : record);
 * ```
 *
 * @production
 * In production (import.meta.env.PROD === true):
 * - Only ERROR-level records render to the console.
 * - DEBUG / INFO / WARN are muted in the console.
 * - apiError always renders to the console (API errors are critical).
 * - WARN / ERROR / apiError are ALWAYS forwarded to registered sinks, even when the console is muted.
 * - Escape hatch: run `enableDebugLogs()` in the console to unmute all levels at runtime.
 *
 * @development
 * In development (import.meta.env.PROD !== true): all levels render to the console.
 *
 * @note
 * - Do NOT use console.log/error/warn directly in application code ג€” always go through logger.
 * - This file is intentionally exempt from the no-console lint rule (it owns console rendering).
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// Current console level ג€” mutable at runtime (see setLevel / enableDebugLogs).
// Production: ERROR only. Development: DEBUG (everything).
// Prefer Vite's import.meta.env.PROD, fall back to process.env.NODE_ENV for non-Vite bundlers.
const isProduction =
  (typeof import.meta !== 'undefined' && import.meta.env?.PROD === true) ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production');
let currentLevel = isProduction ? LOG_LEVELS.ERROR : LOG_LEVELS.DEBUG;

// Console colors per level (console rendering only).
const COLORS = {
  DEBUG: '#6c757d',
  INFO: '#0d6efd',
  WARN: '#ffc107',
  ERROR: '#dc3545',
  RESET: '#000000'
};

// ============================================
// Sink infrastructure: registry, ring buffer, log-once, beforeSend
// ============================================

// Ring buffer capacity ג€” retains the most recent records for replay / flush.
const RING_BUFFER_SIZE = 150;

// Registered sinks (the console is handled directly inside emit; these are ADDITIONAL sinks).
const sinks = new Set();

// The ring buffer (FIFO, cap = RING_BUFFER_SIZE).
const ringBuffer = [];

// log-once counter ג€” assigns a unique id to each Error instance that passes through emit.
let loggedIdCounter = 0;

/**
 * beforeSend transform ג€” a single settable choke-point applied inside emit.
 *
 * This is the industry-standard "beforeSend" hook (mutate-or-suppress-by-returning-null):
 * it is the ONE place to plug in PII redaction, record enrichment, and first-party stack
 * filtering (dropping records whose stack contains no first-party frame ג€” host-page noise
 * in iframe-embedded apps) once a remote sink is attached. Return the (possibly mutated)
 * record to continue, or return null to suppress the record entirely (no console, no buffer,
 * no sinks). Default is identity (no-op).
 *
 * @type {(record: Object) => (Object | null)}
 */
let beforeSend = (record) => record;

/**
 * Append a record to the ring buffer with a fixed cap (FIFO).
 */
const pushToBuffer = (record) => {
  ringBuffer.push(record);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
};

/**
 * Dispatch a record to every registered sink. Each sink is wrapped in its own try/catch so a
 * failing sink can neither throw back into emit nor recurse (never call emit from this catch).
 */
const dispatchToSinks = (record) => {
  if (sinks.size === 0) return;
  for (const sink of sinks) {
    try {
      sink(record);
    } catch (sinkError) {
      // A failing sink must not throw back and must not be re-logged through logger
      // (that would recurse). Use raw console.error so the failure is not lost entirely.
      // eslint-disable-next-line no-console
      console.error('[logger] sink threw and was suppressed:', sinkError);
    }
  }
};

// ============================================
// Console rendering ג€” ALL console output is centralized here (called from emit only)
// ============================================

/**
 * Format a log line for console rendering. Locale-neutral time derived from the record epoch.
 */
const formatMessage = (module, level, message, ts) => {
  const timestamp = new Date(ts).toLocaleTimeString();
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`;
};

/**
 * Print a colored console line (console rendering only).
 */
const logWithColor = (level, message, data = null) => {
  const color = COLORS[level.toUpperCase()] || COLORS.RESET;
  if (data !== null && data !== undefined) {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`, data);
  } else {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`);
  }
};

/**
 * Render a record to the console according to its kind. Centralizes all formatting/grouping
 * that would otherwise be scattered across the public methods.
 * Gated by record.consoleEnabled ג€” when false there is no console output (sinks still receive it).
 */
const renderToConsole = (record) => {
  if (!record.consoleEnabled) return;

  const { kind, level, module, message, data, error, context, timestamp } = record;

  switch (kind) {
    case 'simple': {
      // debug / info / warn ג€” a plain colored line
      logWithColor(level, formatMessage(module, level, message, timestamp), data);
      break;
    }

    case 'error': {
      const formatted = formatMessage(module, level, message, timestamp);
      // error/warn route a non-Error value to record.data (not record.error). When error is
      // undefined fall back to data so the payload (object/string) still prints, aligned with
      // the 'simple' case which already reads data.
      logWithColor(level, formatted, error !== undefined ? error : data);
      if (error && error.stack) {
        console.error('Stack trace:', error.stack);
      }
      break;
    }

    case 'api': {
      const formatted = formatMessage('API', 'DEBUG', `${message} - Sending request`, timestamp);
      console.group(`%c${formatted}`, `color: ${COLORS.DEBUG}; font-weight: bold`);
      console.log('Query:', context?.query);
      if (context?.variables) {
        console.log('Variables:', context.variables);
      }
      console.groupEnd();
      break;
    }

    case 'apiResponse': {
      const formatted = formatMessage('API', 'DEBUG', `${message} - Response received`, timestamp);
      console.group(`%c${formatted}`, `color: ${COLORS.INFO}; font-weight: bold`);
      console.log('Response:', context?.response);
      if (context?.duration !== null && context?.duration !== undefined) {
        console.log(`Duration: ${context.duration}ms`);
      }
      console.groupEnd();
      break;
    }

    case 'apiError': {
      const formatted = formatMessage('API', 'ERROR', `${message} - Request failed`, timestamp);
      console.group(`%c${formatted}`, `color: ${COLORS.ERROR}; font-weight: bold`);
      console.error('Error:', error);
      if (error?.message) {
        console.error('Error message:', error.message);
      }
      if (error?.data) {
        console.error('Error data (from SDK):', error.data);
      }
      if (context?.query) {
        console.error('Query sent:', context.query);
      }
      if (context?.rawResponse) {
        console.error('Raw response:', context.rawResponse);
      }
      if (context?.queryWarnings?.length > 0) {
        console.error('Query warnings:', context.queryWarnings);
      }
      if (error?.stack) {
        console.error('Stack trace:', error.stack);
      }
      console.groupEnd();
      break;
    }

    default:
      break;
  }
};

// ============================================
// emit ג€” the single choke-point
// ============================================

/**
 * The single choke-point. Every public method builds a record and passes it here.
 * Responsible for: timestamp normalization, log-once dedup, beforeSend transform,
 * console rendering, ring buffer, and sink fan-out.
 *
 * @param {Object} record - a structured record
 * @param {string} record.kind - render kind: simple | error | api | apiResponse | apiError
 * @param {string} record.level - DEBUG | INFO | WARN | ERROR
 * @param {string} record.module - module / function name
 * @param {string} record.message - the message
 * @param {*} [record.data] - extra payload (for rendering)
 * @param {Error} [record.error] - the error instance, when present
 * @param {Object} [record.context] - diagnostic context (query / rawResponse / queryWarnings / ג€¦)
 * @param {string} [record.correlationId] - set by log-once; correlates duplicates of one error
 * @param {number} [record.timestamp] - epoch ms; set here
 * @param {boolean} record.consoleEnabled - whether to render to the console (level gate)
 */
const emit = (record) => {
  // --- timestamp normalization: epoch (canonical) + ISO ---
  const ts = Date.now();
  record.timestamp = ts;
  record.timestampISO = new Date(ts).toISOString();

  // --- log-once: dedup by dedup-target ---
  // The target is record.error (an Error instance) or record.data when it is a non-null object.
  // This lets plain-object errors (e.g. a monday soft-error object passed to logger.error and
  // stored on record.data) also be marked with __loggedId and not reported twice. Fresh context
  // bags (record.context) do not participate in dedup ג€” they are new objects on every call.
  const err =
    record.error !== undefined
      ? record.error
      : record.data && typeof record.data === 'object'
      ? record.data
      : undefined;
  if (err && typeof err === 'object') {
    if (err.__loggedId !== undefined) {
      // Same instance passing through again ג€” a duplicate record.
      record.duplicate = true;
      record.correlationId = record.correlationId || err.correlationId || err.__loggedId;
    } else {
      // First pass ג€” stamp an id (non-enumerable so it never pollutes serialization / JSON).
      const id = err.correlationId || `log_${++loggedIdCounter}`;
      try {
        Object.defineProperty(err, '__loggedId', {
          value: id,
          enumerable: false,
          configurable: true,
          writable: true
        });
      } catch {
        // Frozen / non-configurable object ג€” do not block logging (the record still emits).
      }
      record.duplicate = false;
      record.correlationId = id;
      if (err.correlationId === undefined) {
        try {
          Object.defineProperty(err, 'correlationId', {
            value: id,
            enumerable: false,
            configurable: true,
            writable: true
          });
        } catch {
          // Non-blocking.
          record.correlationId = id;
        }
      }
    }
  }

  // --- beforeSend: redaction / enrichment / suppression choke-point ---
  // Applied to the whole pipeline: a null return suppresses the record entirely.
  let outgoing = record;
  try {
    outgoing = beforeSend(record);
  } catch (transformError) {
    // A broken transform must not take down logging ג€” fall back to the untransformed record.
    // eslint-disable-next-line no-console
    console.error('[logger] beforeSend threw and was ignored:', transformError);
    outgoing = record;
  }
  if (outgoing === null || outgoing === undefined) {
    // Suppressed ג€” do not render, buffer, or dispatch.
    return;
  }

  // --- console rendering (gated by consoleEnabled, computed by the caller) ---
  renderToConsole(outgoing);

  // --- ring buffer ---
  pushToBuffer(outgoing);

  // --- fan-out to sinks. Duplicate records are skipped from sinks (log-once). ---
  if (!outgoing.duplicate) {
    dispatchToSinks(outgoing);
  }
};

// ============================================
// encodeDims ג€” usage/health message encoder (D4)
// ============================================

/**
 * Fold categorical/measured dims into a stable, queryable message suffix:
 * `base key1=v1 key2=v2` with keys sorted. Only string/bool/finite-number values are
 * included (objects, functions, NaN/Infinity dropped) so the shipped message stays flat
 * and APL-parseable. Used by track()/health() to encode usage/health dims (D4). Identical
 * spec across app-core, this template, and tracker (single source of the wire format).
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

const logger = {
  /**
   * Set the console log level.
   * @param {string|number} level - 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'
   */
  setLevel: (level) => {
    if (typeof level === 'string') {
      // Use ?? not || because LOG_LEVELS.DEBUG === 0 (falsy) ג€” || would misresolve 'DEBUG'.
      const resolved = LOG_LEVELS[level.toUpperCase()];
      currentLevel = resolved !== undefined ? resolved : LOG_LEVELS.WARN;
    } else {
      currentLevel = level;
    }
  },

  /**
   * Get the current log level name.
   * @returns {string}
   */
  getLevel: () => Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k] === currentLevel),

  /**
   * Whether debug mode is active.
   */
  isDebug: () => currentLevel <= LOG_LEVELS.DEBUG,

  // ============================================
  // Sink infrastructure
  // ============================================

  /**
   * Register an additional sink that receives every non-duplicate record via fan-out.
   * @param {function(Object):void} fn - the sink function
   * @returns {function():void} unsubscribe ג€” calls removeSink(fn)
   */
  addSink: (fn) => {
    if (typeof fn !== 'function') return () => {};
    sinks.add(fn);
    return () => sinks.delete(fn);
  },

  /**
   * Remove a registered sink.
   * @param {function} fn
   */
  removeSink: (fn) => {
    sinks.delete(fn);
  },

  /**
   * Install the beforeSend transform (record => record | null) applied inside emit.
   * This is where PII redaction, enrichment, and first-party stack filtering plug in when a
   * remote sink is attached. Return the (possibly mutated) record to continue, or null to
   * suppress it. Pass null / omit the argument to reset to the identity transform.
   * @param {(record: Object) => (Object | null)} [fn]
   */
  setBeforeSend: (fn) => {
    beforeSend = typeof fn === 'function' ? fn : (record) => record;
  },

  /**
   * The single choke-point ג€” exposed for tests and advanced use. All other methods route here.
   */
  emit,

  /**
   * Return a shallow copy of the ring buffer (FIFO, cap = RING_BUFFER_SIZE).
   * @returns {Object[]}
   */
  getBuffer: () => ringBuffer.slice(),

  /**
   * Flush the ring buffer to a remote target (e.g. on visibilitychange / beforeunload).
   * Uses navigator.sendBeacon when available, else fetch keepalive, else a graceful no-op.
   * Never throws (it runs on the unload path).
   * @param {string} [url] - optional target. Without it, flush is a graceful no-op (no remote
   *   target wired yet ג€” the infrastructure is ready, the target is deferred).
   * @returns {boolean} whether anything was sent
   */
  flush: (url) => {
    if (ringBuffer.length === 0) return false;
    if (!url) return false;
    let payload;
    try {
      payload = JSON.stringify(ringBuffer);
    } catch {
      // Serialization failure (e.g. circular) ג€” clear intent: do not throw.
      return false;
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const ok = navigator.sendBeacon(url, payload);
        if (ok) {
          ringBuffer.length = 0;
          return true;
        }
        // sendBeacon failed ג€” fall through to fetch.
      }
      if (typeof fetch === 'function') {
        // Fire-and-forget; keepalive allows the request to complete during unload.
        fetch(url, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
        ringBuffer.length = 0;
        return true;
      }
    } catch {
      // Unload path ג€” never throw outward.
      return false;
    }
    // Neither sendBeacon nor fetch available ג€” graceful no-op.
    return false;
  },

  // ============================================
  // Public logging methods
  // ============================================

  /**
   * Debug log ג€” detailed development information.
   */
  debug: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'DEBUG',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * Info log ג€” general information.
   */
  info: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'INFO',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * Warning log. WARN is forwarded to sinks even when the console is muted (production).
   */
  warn: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'WARN',
      module,
      message,
      data,
      // If data is an Error, also attach it to record.error so it reaches sinks structured.
      error: data instanceof Error ? data : undefined,
      consoleEnabled: currentLevel <= LOG_LEVELS.WARN
    });
  },

  /**
   * Error log. ERROR is forwarded to sinks even when the console is muted (production).
   */
  error: (module, message, error = null) => {
    emit({
      kind: 'error',
      level: 'ERROR',
      module,
      message,
      error: error instanceof Error ? error : undefined,
      // If error is not an Error instance (object/string), keep it on data for rendering/sinks.
      data: error instanceof Error ? undefined : error,
      consoleEnabled: currentLevel <= LOG_LEVELS.ERROR
    });
  },

  /**
   * track ג€” usage telemetry (D3). An INFO record carrying the DOMAIN kind 'usage' (as
   * domainKind ג€” the sink reconciles it to ev.kind) and alwaysShip:true, so it ships
   * regardless of the WARN/ERROR policy. Dims fold into the message via encodeDims (D4).
   * The rendering kind stays 'simple' (a plain INFO console line).
   * @param {string} event - stable event id (e.g. 'view_open', 'export_clicked')
   * @param {Object} [dims] - categorical/measured dims folded into the message
   */
  track: (event, dims = null) => {
    emit({
      kind: 'simple',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message: encodeDims(event, dims),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * health ג€” health signal (D5). An INFO record, DOMAIN kind 'health', alwaysShip:true.
   * Metrics fold into the message via encodeDims (D4).
   * @param {string} signal - stable signal id (e.g. 'boot', 'api_latency')
   * @param {Object} [metrics] - measured metrics folded into the message
   */
  health: (signal, metrics = null) => {
    emit({
      kind: 'simple',
      domainKind: 'health',
      alwaysShip: true,
      level: 'INFO',
      module: 'health',
      message: encodeDims(signal, metrics),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * API-specific log ג€” before the request.
   */
  api: (functionName, query, variables = null) => {
    emit({
      kind: 'api',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { query, variables },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * API-specific log ג€” after the response.
   */
  apiResponse: (functionName, response, duration = null) => {
    emit({
      kind: 'apiResponse',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { response, duration },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * API-specific log ג€” an error. Always renders to the console and always reaches sinks.
   * @param {string} functionName - the function name
   * @param {Error} error - the error object
   * @param {Object} [context] - extra diagnostic context
   * @param {string} [context.query] - the query that was sent
   * @param {Object} [context.rawResponse] - the raw API response
   * @param {string[]} [context.queryWarnings] - validation warnings on the query
   */
  apiError: (functionName, error, context = null) => {
    emit({
      kind: 'apiError',
      level: 'ERROR',
      module: 'API',
      message: functionName,
      error: error instanceof Error ? error : undefined,
      // If error is not an Error (rare) keep it on data so it is not lost from sinks.
      data: error instanceof Error ? undefined : error,
      context: context || undefined,
      consoleEnabled: true // apiError always renders to the console
    });
  }
};

// flush on visibilitychange / beforeunload (infrastructure ready; target deferred ג€” flush
// without a url is a graceful no-op until a remote sink is wired).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const flushOnHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      logger.flush();
    }
  };
  window.addEventListener('visibilitychange', flushOnHidden);
  window.addEventListener('beforeunload', () => logger.flush());
}

// ============================================
// Production console escape hatches ג€” type these in the browser console:
// - enableDebugLogs()   - unmute all levels
// - disableDebugLogs()  - mute back to ERROR only
// - getLogLevel()       - print the current level
// - setLogLevel('INFO') - set a specific level
// ============================================

if (typeof window !== 'undefined') {
  window.enableDebugLogs = () => {
    logger.setLevel('DEBUG');
    console.log(
      '%cDebug logs ENABLED - all levels will now render',
      'color: #4caf50; font-weight: bold; font-size: 14px'
    );
  };

  window.disableDebugLogs = () => {
    logger.setLevel('ERROR');
    console.log(
      '%cDebug logs DISABLED - only errors will render',
      'color: #f44336; font-weight: bold; font-size: 14px'
    );
  };

  window.getLogLevel = () => {
    const level = logger.getLevel();
    console.log(`%cCurrent log level: ${level}`, 'color: #2196f3; font-weight: bold');
    return level;
  };

  window.setLogLevel = (level) => {
    logger.setLevel(level);
  };
}

export default logger;
export { LOG_LEVELS };


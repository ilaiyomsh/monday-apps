/**
 * logger.ts — single-choke-point logging pipeline with debug gating and a sink registry.
 *
 * TypeScript port of the error-guard client template (.claude/skills/error-guard/
 * templates/logger.js) for the deadline-confirm admin SPA (strict TS + tsc --noEmit).
 * Every public method builds a structured record and routes it through emit(record) — the
 * ONE choke-point that does timestamp normalization, log-once dedup, the beforeSend
 * transform, console rendering, ring-buffer retention, and fan-out to registered sinks.
 *
 * v2 contract: track()/health() emit INFO records carrying domainKind 'usage'/'health' +
 * alwaysShip, with dims folded into the message via encodeDims. The Axiom sink reconciles
 * domainKind → ev.kind; the rendering `kind` never ships.
 *
 * Do NOT call console.* from application code — always go through logger. This file owns
 * console rendering and is the only place console.* is allowed.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;
type RenderKind = 'simple' | 'error' | 'api' | 'apiResponse' | 'apiError';
export type DomainKind = 'usage' | 'health';

/** Diagnostic context bag — a fresh object per call (never participates in dedup). */
export interface LogContext {
  query?: unknown;
  variables?: unknown;
  response?: unknown;
  duration?: number | null;
  rawResponse?: unknown;
  queryWarnings?: string[];
  totalMs?: number;
  step?: number;
  [key: string]: unknown;
}

/** A structured log record — the unit that flows through emit() to every sink. */
export interface LogRecord {
  kind: RenderKind;
  level: LogLevelName;
  module: string;
  message: string;
  data?: unknown;
  error?: Error;
  context?: LogContext;
  /** DOMAIN discriminator for the sink: 'usage' | 'health'. Absent on plain errors. */
  domainKind?: DomainKind;
  /** usage/health bypass the WARN/ERROR ship policy (D3/D5). */
  alwaysShip?: boolean;
  consoleEnabled: boolean;
  timestamp?: number;
  timestampISO?: string;
  correlationId?: string;
  duplicate?: boolean;
}

export type LogSink = (record: LogRecord) => void;
export type BeforeSend = (record: LogRecord) => LogRecord | null;

declare global {
  interface Window {
    enableDebugLogs?: () => void;
    disableDebugLogs?: () => void;
    getLogLevel?: () => LogLevelName | undefined;
    setLogLevel?: (level: LogLevelName | string | number) => void;
  }
}

// Production: ERROR only. Development: DEBUG (everything). import.meta.env.PROD is the
// source of truth for this Vite app.
const isProduction = import.meta.env.PROD === true;
let currentLevel: number = isProduction ? LOG_LEVELS.ERROR : LOG_LEVELS.DEBUG;

// Console colors per level (console rendering only).
const COLORS: Record<string, string> = {
  DEBUG: '#6c757d',
  INFO: '#0d6efd',
  WARN: '#ffc107',
  ERROR: '#dc3545',
  RESET: '#000000',
};

// ============================================
// Sink infrastructure: registry, ring buffer, log-once, beforeSend
// ============================================

const RING_BUFFER_SIZE = 150;
const sinks = new Set<LogSink>();
const ringBuffer: LogRecord[] = [];
let loggedIdCounter = 0;

/**
 * beforeSend transform — the ONE settable choke-point applied inside emit for PII
 * redaction, enrichment, and first-party stack filtering. Return the (possibly mutated)
 * record to continue, or null to suppress it entirely. Default is identity.
 */
let beforeSend: BeforeSend = (record) => record;

const pushToBuffer = (record: LogRecord): void => {
  ringBuffer.push(record);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
};

/** Dispatch to every sink, each in its own try/catch so a failing sink never recurses. */
const dispatchToSinks = (record: LogRecord): void => {
  if (sinks.size === 0) return;
  for (const sink of sinks) {
    try {
      sink(record);
    } catch (sinkError) {
      // A failing sink must not throw back and must not be re-logged (that would recurse).
      console.error('[logger] sink threw and was suppressed:', sinkError);
    }
  }
};

// ============================================
// Console rendering — ALL console output centralized here (called from emit only)
// ============================================

const formatMessage = (module: string, level: string, message: string, ts: number): string => {
  const timestamp = new Date(ts).toLocaleTimeString();
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`;
};

const logWithColor = (level: string, message: string, data: unknown = null): void => {
  const color = COLORS[level.toUpperCase()] || COLORS.RESET;
  if (data !== null && data !== undefined) {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`, data);
  } else {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`);
  }
};

/** Render a record to the console according to its kind. Gated by record.consoleEnabled. */
const renderToConsole = (record: LogRecord): void => {
  if (!record.consoleEnabled) return;

  const { kind, level, module, message, data, error, context, timestamp } = record;
  const ts = timestamp ?? Date.now();

  switch (kind) {
    case 'simple': {
      logWithColor(level, formatMessage(module, level, message, ts), data);
      break;
    }

    case 'error': {
      const formatted = formatMessage(module, level, message, ts);
      logWithColor(level, formatted, error !== undefined ? error : data);
      if (error && error.stack) {
        console.error('Stack trace:', error.stack);
      }
      break;
    }

    case 'api': {
      const formatted = formatMessage('API', 'DEBUG', `${message} - Sending request`, ts);
      console.group(`%c${formatted}`, `color: ${COLORS.DEBUG}; font-weight: bold`);
      console.log('Query:', context?.query);
      if (context?.variables) {
        console.log('Variables:', context.variables);
      }
      console.groupEnd();
      break;
    }

    case 'apiResponse': {
      const formatted = formatMessage('API', 'DEBUG', `${message} - Response received`, ts);
      console.group(`%c${formatted}`, `color: ${COLORS.INFO}; font-weight: bold`);
      console.log('Response:', context?.response);
      if (context?.duration !== null && context?.duration !== undefined) {
        console.log(`Duration: ${context.duration}ms`);
      }
      console.groupEnd();
      break;
    }

    case 'apiError': {
      const formatted = formatMessage('API', 'ERROR', `${message} - Request failed`, ts);
      console.group(`%c${formatted}`, `color: ${COLORS.ERROR}; font-weight: bold`);
      console.error('Error:', error);
      if (error?.message) {
        console.error('Error message:', error.message);
      }
      if (context?.query) {
        console.error('Query sent:', context.query);
      }
      if (context?.rawResponse) {
        console.error('Raw response:', context.rawResponse);
      }
      if (context?.queryWarnings && context.queryWarnings.length > 0) {
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
// emit — the single choke-point
// ============================================

/** A dedup target may carry a stamped log-once id (non-enumerable). */
interface DedupTarget {
  __loggedId?: string;
  correlationId?: string;
}

const emit = (record: LogRecord): void => {
  // --- timestamp normalization: epoch (canonical) + ISO ---
  const ts = Date.now();
  record.timestamp = ts;
  record.timestampISO = new Date(ts).toISOString();

  // --- log-once: dedup by dedup-target (record.error, or an object record.data) ---
  const err: unknown =
    record.error !== undefined
      ? record.error
      : record.data && typeof record.data === 'object'
        ? record.data
        : undefined;
  if (err && typeof err === 'object') {
    const target = err as DedupTarget;
    if (target.__loggedId !== undefined) {
      record.duplicate = true;
      record.correlationId = record.correlationId || target.correlationId || target.__loggedId;
    } else {
      const id = target.correlationId || `log_${++loggedIdCounter}`;
      try {
        Object.defineProperty(err, '__loggedId', {
          value: id,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      } catch {
        // Frozen / non-configurable object — do not block logging.
      }
      record.duplicate = false;
      record.correlationId = id;
      if (target.correlationId === undefined) {
        try {
          Object.defineProperty(err, 'correlationId', {
            value: id,
            enumerable: false,
            configurable: true,
            writable: true,
          });
        } catch {
          record.correlationId = id;
        }
      }
    }
  }

  // --- beforeSend: redaction / enrichment / suppression choke-point ---
  let outgoing: LogRecord | null = record;
  try {
    outgoing = beforeSend(record);
  } catch (transformError) {
    // A broken transform must not take down logging.
    console.error('[logger] beforeSend threw and was ignored:', transformError);
    outgoing = record;
  }
  if (outgoing === null || outgoing === undefined) {
    return; // suppressed
  }

  renderToConsole(outgoing);
  pushToBuffer(outgoing);

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
 * included so the shipped message stays flat and APL-parseable. Identical spec across
 * app-core, the templates, and tracker (single source of the wire format).
 */
export function encodeDims(base: string, dims?: Record<string, unknown> | null): string {
  if (!dims) return base;
  const parts: string[] = [];
  for (const key of Object.keys(dims).sort()) {
    const v = dims[key];
    if (
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      parts.push(`${key}=${v}`);
    }
  }
  return parts.length ? `${base} ${parts.join(' ')}` : base;
}

// ============================================
// logger — public surface
// ============================================

const logger = {
  setLevel: (level: LogLevelName | string | number): void => {
    if (typeof level === 'string') {
      // Use ?? not || because LOG_LEVELS.DEBUG === 0 (falsy).
      const resolved = LOG_LEVELS[level.toUpperCase() as LogLevelName];
      currentLevel = resolved !== undefined ? resolved : LOG_LEVELS.WARN;
    } else {
      currentLevel = level;
    }
  },

  getLevel: (): LogLevelName | undefined =>
    (Object.keys(LOG_LEVELS) as LogLevelName[]).find((k) => LOG_LEVELS[k] === currentLevel),

  isDebug: (): boolean => currentLevel <= LOG_LEVELS.DEBUG,

  /** Register an additional sink; returns an unsubscribe fn. */
  addSink: (fn: LogSink): (() => void) => {
    if (typeof fn !== 'function') return () => {};
    sinks.add(fn);
    return () => {
      sinks.delete(fn);
    };
  },

  removeSink: (fn: LogSink): void => {
    sinks.delete(fn);
  },

  /** Install the beforeSend transform. Pass nothing to reset to identity. */
  setBeforeSend: (fn?: BeforeSend | null): void => {
    beforeSend = typeof fn === 'function' ? fn : (record) => record;
  },

  emit,

  getBuffer: (): LogRecord[] => ringBuffer.slice(),

  /**
   * Flush the ring buffer to a remote target (visibilitychange / beforeunload). Without a
   * url it is a graceful no-op (the target is deferred). Never throws.
   */
  flush: (url?: string): boolean => {
    if (ringBuffer.length === 0) return false;
    if (!url) return false;
    let payload: string;
    try {
      payload = JSON.stringify(ringBuffer);
    } catch {
      return false;
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const ok = navigator.sendBeacon(url, payload);
        if (ok) {
          ringBuffer.length = 0;
          return true;
        }
      }
      if (typeof fetch === 'function') {
        void fetch(url, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
        ringBuffer.length = 0;
        return true;
      }
    } catch {
      return false;
    }
    return false;
  },

  // ---- level-based logs ----

  debug: (module: string, message: string, data: unknown = null): void => {
    emit({
      kind: 'simple',
      level: 'DEBUG',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG,
    });
  },

  info: (module: string, message: string, data: unknown = null): void => {
    emit({
      kind: 'simple',
      level: 'INFO',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO,
    });
  },

  warn: (module: string, message: string, data: unknown = null): void => {
    emit({
      kind: 'simple',
      level: 'WARN',
      module,
      message,
      data,
      error: data instanceof Error ? data : undefined,
      consoleEnabled: currentLevel <= LOG_LEVELS.WARN,
    });
  },

  error: (module: string, message: string, error: unknown = null): void => {
    emit({
      kind: 'error',
      level: 'ERROR',
      module,
      message,
      error: error instanceof Error ? error : undefined,
      data: error instanceof Error ? undefined : error,
      consoleEnabled: currentLevel <= LOG_LEVELS.ERROR,
    });
  },

  /** track — usage telemetry (D3): INFO + domainKind 'usage' + alwaysShip; dims via encodeDims. */
  track: (event: string, dims: Record<string, unknown> | null = null): void => {
    emit({
      kind: 'simple',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message: encodeDims(event, dims),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO,
    });
  },

  /** health — health signal (D5): INFO + domainKind 'health' + alwaysShip; metrics via encodeDims. */
  health: (signal: string, metrics: Record<string, unknown> | null = null): void => {
    emit({
      kind: 'simple',
      domainKind: 'health',
      alwaysShip: true,
      level: 'INFO',
      module: 'health',
      message: encodeDims(signal, metrics),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO,
    });
  },

  // ---- API-specific logs ----

  api: (functionName: string, query: unknown, variables: unknown = null): void => {
    emit({
      kind: 'api',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { query, variables },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG,
    });
  },

  apiResponse: (functionName: string, response: unknown, duration: number | null = null): void => {
    emit({
      kind: 'apiResponse',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { response, duration },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG,
    });
  },

  apiError: (functionName: string, error: unknown, context: LogContext | null = null): void => {
    emit({
      kind: 'apiError',
      level: 'ERROR',
      module: 'API',
      message: functionName,
      error: error instanceof Error ? error : undefined,
      data: error instanceof Error ? undefined : error,
      context: context ?? undefined,
      consoleEnabled: true, // apiError always renders to the console
    });
  },
};

// flush on visibilitychange / beforeunload (target deferred — a url-less flush is a no-op).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const flushOnHidden = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      logger.flush();
    }
  };
  window.addEventListener('visibilitychange', flushOnHidden);
  window.addEventListener('beforeunload', () => logger.flush());
}

// Production console escape hatches — type these in the browser console:
//   enableDebugLogs() · disableDebugLogs() · getLogLevel() · setLogLevel('INFO')
if (typeof window !== 'undefined') {
  window.enableDebugLogs = (): void => {
    logger.setLevel('DEBUG');
    console.log(
      '%cDebug logs ENABLED - all levels will now render',
      'color: #4caf50; font-weight: bold; font-size: 14px'
    );
  };
  window.disableDebugLogs = (): void => {
    logger.setLevel('ERROR');
    console.log(
      '%cDebug logs DISABLED - only errors will render',
      'color: #f44336; font-weight: bold; font-size: 14px'
    );
  };
  window.getLogLevel = (): LogLevelName | undefined => {
    const level = logger.getLevel();
    console.log(`%cCurrent log level: ${level}`, 'color: #2196f3; font-weight: bold');
    return level;
  };
  window.setLogLevel = (level: LogLevelName | string | number): void => {
    logger.setLevel(level);
  };
}

export default logger;
export { LOG_LEVELS };

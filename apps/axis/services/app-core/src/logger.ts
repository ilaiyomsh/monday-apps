/**
 * Leveled logger with a ring buffer, log-once dedup, and pluggable sinks.
 * Generalized from tracker's logger + the Axis logging standard (#5).
 *
 * Remote shipping is NOT built in: attach the shared hardened Axiom transport via
 * `attachAxiomSink(logger, { app, dataset, token })` (see errors/axiomSink.ts).
 * The UI error sink (see errors/) subscribes the same way, via addSink.
 */
export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

export interface LogRecord {
  level: Exclude<LogLevelName, 'NONE'>;
  module: string;
  message: string;
  data?: unknown;
  error?: unknown;
  timestamp: number;
  timestampISO: string;
  correlationId?: number;
  duplicate?: boolean;
  context?: Record<string, unknown>;
  /** Domain discriminator for the Axiom envelope: 'error' (default) | 'usage' | 'health'. */
  kind?: string;
  /** Bypass the default WARN/ERROR ship policy — usage/health records ship at INFO. */
  alwaysShip?: boolean;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  app: string;
  appVersion?: string;
  environment?: string;
  ringBufferSize?: number;
}

const LEVELS: Record<Exclude<LogLevelName, 'NONE'>, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

/**
 * Fold categorical/measured dims into a stable, queryable message suffix:
 * `base key1=v1 key2=v2` with keys sorted. Only string/bool/finite-number values are
 * included (objects, functions, NaN/Infinity dropped) so the shipped message stays flat
 * and APL-parseable. Used by track()/health() to encode usage/health dims per decision D4.
 */
export function encodeDims(base: string, dims?: Record<string, unknown>): string {
  if (!dims) return base;
  const parts: string[] = [];
  for (const key of Object.keys(dims).sort()) {
    const v = dims[key];
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      parts.push(`${key}=${v}`);
    }
  }
  return parts.length ? `${base} ${parts.join(' ')}` : base;
}

export function createLogger(options: LoggerOptions) {
  const isProd = typeof import.meta !== 'undefined' && (import.meta as { env?: { PROD?: boolean } }).env?.PROD;
  const ringSize = options.ringBufferSize ?? 150;

  let currentLevel = isProd ? LEVELS.ERROR : LEVELS.DEBUG;
  let loggedIdCounter = 0;
  const ring: LogRecord[] = [];
  const sinks = new Set<LogSink>();

  const emit = (
    level: LogRecord['level'], module: string, message: string,
    payload?: unknown, context?: Record<string, unknown>,
    opts?: { kind?: string; alwaysShip?: boolean },
  ) => {
    const isError = payload instanceof Error || (payload && typeof payload === 'object' && 'stack' in (payload as object));
    const record: LogRecord = {
      level, module, message, timestamp: Date.now(), timestampISO: new Date().toISOString(), context,
      ...(isError ? { error: payload } : { data: payload }),
      ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
      ...(opts?.alwaysShip !== undefined ? { alwaysShip: opts.alwaysShip } : {}),
    };

    // log-once dedup: stamp the error object so downstream catches don't re-display
    const errObj = (record.error ?? record.data) as { __loggedId?: number } | undefined;
    if (errObj && typeof errObj === 'object') {
      if (errObj.__loggedId !== undefined) record.duplicate = true;
      else { errObj.__loggedId = ++loggedIdCounter; record.correlationId = errObj.__loggedId; }
    }

    if (LEVELS[level] >= currentLevel || level === 'ERROR') {
      const fn = level === 'DEBUG' ? console.log : console[level === 'INFO' ? 'info' : level === 'WARN' ? 'warn' : 'error'];
      fn(`[${module}] ${message}`, payload ?? '');
    }

    ring.push(record);
    if (ring.length > ringSize) ring.shift();

    if (!record.duplicate) {
      sinks.forEach((s) => { try { s(record); } catch { /* sink failure must not recurse */ } });
    }
  };

  const api = {
    // The optional 4th `context` arg is forwarded onto the record (via emit) so a caller
    // that attaches structured context — e.g. error-kit's ErrorBoundary passing
    // { componentStack } to logger.error — has it ride the shipped ERROR record. The
    // arity matches error-kit's Logger interface; a 3-arg call leaves context undefined.
    debug: (m: string, msg: string, d?: unknown, ctx?: Record<string, unknown>) => emit('DEBUG', m, msg, d, ctx),
    info: (m: string, msg: string, d?: unknown, ctx?: Record<string, unknown>) => emit('INFO', m, msg, d, ctx),
    warn: (m: string, msg: string, d?: unknown, ctx?: Record<string, unknown>) => emit('WARN', m, msg, d, ctx),
    error: (m: string, msg: string, e?: unknown, ctx?: Record<string, unknown>) => emit('ERROR', m, msg, e, ctx),
    api: (fn: string, query?: unknown, variables?: unknown) => emit('DEBUG', 'API', `→ ${fn}`, { query, variables }),
    apiResponse: (fn: string, durationMs: number) => emit('DEBUG', 'API', `← ${fn} (${Math.round(durationMs)}ms)`),
    apiError: (fn: string, error: unknown, context?: Record<string, unknown>) => emit('ERROR', 'API', `✕ ${fn}`, error, context),
    /** Usage telemetry (D3): an INFO record, kind='usage', shipped regardless of level. Dims fold into the message (D4). */
    track: (event: string, dims?: Record<string, unknown>) =>
      emit('INFO', 'usage', encodeDims(event, dims), undefined, undefined, { kind: 'usage', alwaysShip: true }),
    /** Health signal (D5): an INFO record, kind='health', shipped regardless of level. Metrics fold into the message (D4). */
    health: (signal: string, metrics?: Record<string, unknown>) =>
      emit('INFO', 'health', encodeDims(signal, metrics), undefined, undefined, { kind: 'health', alwaysShip: true }),
    addSink: (s: LogSink) => { sinks.add(s); return () => sinks.delete(s); },
    getBuffer: () => [...ring],
    setLevel: (name: LogLevelName) => { currentLevel = name === 'NONE' ? 99 : LEVELS[name]; },
  };

  // window control (parity with Planner/Tracker)
  if (typeof window !== 'undefined') {
    (window as unknown as { AppLogger?: unknown }).AppLogger = {
      setLevel: api.setLevel,
      enableDebug: () => api.setLevel('DEBUG'),
      disableDebug: () => api.setLevel('ERROR'),
      getBuffer: api.getBuffer,
    };
  }

  return api;
}

export type Logger = ReturnType<typeof createLogger>;

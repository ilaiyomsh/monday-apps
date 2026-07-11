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
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  app: string;
  appVersion?: string;
  environment?: string;
  ringBufferSize?: number;
}

const LEVELS: Record<Exclude<LogLevelName, 'NONE'>, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export function createLogger(options: LoggerOptions) {
  const isProd = typeof import.meta !== 'undefined' && (import.meta as { env?: { PROD?: boolean } }).env?.PROD;
  const ringSize = options.ringBufferSize ?? 150;

  let currentLevel = isProd ? LEVELS.ERROR : LEVELS.DEBUG;
  let loggedIdCounter = 0;
  const ring: LogRecord[] = [];
  const sinks = new Set<LogSink>();

  const emit =(level: LogRecord['level'], module: string, message: string, payload?: unknown, context?: Record<string, unknown>) => {
    const isError = payload instanceof Error || (payload && typeof payload === 'object' && 'stack' in (payload as object));
    const record: LogRecord = {
      level, module, message, timestamp: Date.now(), timestampISO: new Date().toISOString(), context,
      ...(isError ? { error: payload } : { data: payload }),
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
    debug: (m: string, msg: string, d?: unknown) => emit('DEBUG', m, msg, d),
    info: (m: string, msg: string, d?: unknown) => emit('INFO', m, msg, d),
    warn: (m: string, msg: string, d?: unknown) => emit('WARN', m, msg, d),
    error: (m: string, msg: string, e?: unknown) => emit('ERROR', m, msg, e),
    api: (fn: string, query?: unknown, variables?: unknown) => emit('DEBUG', 'API', `→ ${fn}`, { query, variables }),
    apiResponse: (fn: string, durationMs: number) => emit('DEBUG', 'API', `← ${fn} (${Math.round(durationMs)}ms)`),
    apiError: (fn: string, error: unknown, context?: Record<string, unknown>) => emit('ERROR', 'API', `✕ ${fn}`, error, context),
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

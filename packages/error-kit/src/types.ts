/**
 * types.ts — the record/sink interface error-kit consumes. Loggers stay app-local;
 * error-kit only needs the shape of a LogRecord and the Logger surface it subscribes to
 * (getBuffer + addSink) and reports through (error/warn for the global handler + boundary).
 *
 * These are STRUCTURAL types: an app's own logger (app-core's, tracker's, discussions')
 * satisfies them by shape, so nothing here is a runtime dependency.
 */
export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

export interface LogRecord {
  level: Exclude<LogLevelName, 'NONE'>;
  module: string;
  message: string;
  data?: unknown;
  error?: unknown;
  timestamp?: number;
  timestampISO?: string;
  correlationId?: number;
  duplicate?: boolean;
  context?: Record<string, unknown>;
  /** Domain discriminator for the Axiom envelope: 'error' (default) | 'usage' | 'health'. */
  kind?: string;
  /** Bypass the default WARN/ERROR ship policy — usage/health records ship at INFO. */
  alwaysShip?: boolean;
}

export type LogSink = (record: LogRecord) => void;

/**
 * The minimal logger surface error-kit calls. The `context` 4th argument lets a caller
 * (e.g. the React ErrorBoundary) attach structured context — componentStack — onto the
 * emitted record so the sink can ship it.
 */
export interface Logger {
  debug(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  info(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  warn(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  error(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  addSink(sink: LogSink): () => void;
  getBuffer(): LogRecord[];
}

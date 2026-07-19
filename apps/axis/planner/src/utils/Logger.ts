/**
 * Client-side Logging Service
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Environment-aware defaults (PROD: ERROR, DEV: DEBUG)
 * - Runtime control via window.AppLogger
 * - Persists settings to localStorage
 *
 * Usage:
 *   import { logger } from './utils/Logger';
 *   logger.debug('Debug message');
 *   logger.info('Info message');
 *   logger.warn('Warning message');
 *   logger.error('Error message');
 *
 * Console Commands:
 *   window.AppLogger.setLevel('DEBUG')  // Change log level
 *   window.AppLogger.disable()          // Disable all logging
 *   window.AppLogger.enable()           // Re-enable logging
 *   window.AppLogger.getConfig()        // View current config
 *   window.AppLogger.reset()            // Reset to environment defaults
 */

import { scrubMessage } from './scrubMessage';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const STORAGE_KEY = 'planner_logger_config';

// Ring buffer capacity — retains the most recent records for sink replay (see attachAxiomSink).
const RING_BUFFER_SIZE = 150;

// ============================================
// Axiom logging v2 — record shape + primitives
// ============================================

/**
 * DOMAIN discriminator (travels on record.domainKind — NEVER the rendering kind).
 * error (default) | usage (track) | health (health). The Axiom sink reads this to
 * set ev.kind; the rendering kind stays 'simple' | 'error'.
 */
export type DomainKind = 'usage' | 'health' | 'error';

/**
 * Structured record fanned out to sinks (the Axiom sink maps it to the wire schema).
 * Built by track()/health() (usage/health INFO records) and by warn()/error() (error
 * records). The transport/sink only ever read this exact shape.
 */
export interface LogRecord {
  /** rendering kind (stays 'simple'/'error'); the DOMAIN discriminator is domainKind */
  kind: 'simple' | 'error';
  level: LogLevel;
  module: string;
  message: string;
  domainKind?: DomainKind;
  /** usage/health INFO records bypass the WARN/ERROR ship policy (D3/D5) */
  alwaysShip?: boolean;
  error?: Error;
  /** numeric timings the sink may forward (duration → ms, totalMs, step) */
  context?: { duration?: number; totalMs?: number; step?: number };
  correlationId?: string;
  duplicate?: boolean;
  timestamp?: number;
  timestampISO?: string;
}

export type LogSink = (record: LogRecord) => void;

/**
 * encodeDims — usage/health message encoder (D4). Folds categorical/measured dims into a
 * stable, queryable suffix: `base key1=v1 key2=v2` with keys sorted. Only string/bool/finite
 * number values are included (objects, functions, NaN/Infinity dropped) so the shipped message
 * stays flat and APL-parseable. Identical spec across app-core, the template, and every app.
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

interface LoggerConfig {
  level: LogLevel;
  enabled: boolean;
}

interface AppLoggerAPI {
  setLevel: (level: LogLevel) => void;
  enable: () => void;
  disable: () => void;
  getConfig: () => LoggerConfig;
  reset: () => void;
}

declare global {
  interface Window {
    AppLogger: AppLoggerAPI;
  }
}

class Logger {
  private config: LoggerConfig;

  // v2 sink infrastructure (additive — the console pipeline above is untouched).
  // The console is rendered directly by each method; these sinks are ADDITIONAL
  // fan-out targets (the Axiom sink attaches here in main.tsx).
  private sinks = new Set<LogSink>();
  private ringBuffer: LogRecord[] = [];

  constructor() {
    this.config = this.loadConfig();
    this.exposeToWindow();
  }

  /**
   * Get default log level based on environment
   */
  private getDefaultLevel(): LogLevel {
    // Vite uses import.meta.env.PROD / import.meta.env.DEV
    const isProd = import.meta.env.PROD;
    return isProd ? 'ERROR' : 'DEBUG';
  }

  /**
   * Load config from localStorage or use defaults
   */
  private loadConfig(): LoggerConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<LoggerConfig>;
        // Validate stored values
        if (parsed.level && LOG_LEVELS[parsed.level] !== undefined) {
          return {
            level: parsed.level,
            enabled: parsed.enabled ?? true,
          };
        }
      }
    } catch {
      // localStorage not available or parse error - use defaults
    }
    return {
      level: this.getDefaultLevel(),
      enabled: true,
    };
  }

  /**
   * Persist config to localStorage
   */
  private saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // localStorage not available - settings won't persist
    }
  }

  /**
   * Check if a message at the given level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Format timestamp for log messages
   */
  private getTimestamp(): string {
    return new Date().toISOString().substring(11, 23); // HH:mm:ss.SSS
  }

  /**
   * Expose control API to window.AppLogger
   */
  private exposeToWindow(): void {
    if (typeof window !== 'undefined') {
      window.AppLogger = {
        setLevel: (level: LogLevel) => this.setLevel(level),
        enable: () => this.enable(),
        disable: () => this.disable(),
        getConfig: () => ({ ...this.config }),
        reset: () => this.reset(),
      };

      // Log initial state in development
      if (!import.meta.env.PROD) {
        console.log(
          '%c[Logger]%c Initialized (level: %s, enabled: %s). Control via window.AppLogger',
          'color: #6366f1; font-weight: bold',
          'color: inherit',
          this.config.level,
          this.config.enabled
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Public Control API
  // ─────────────────────────────────────────────────────────────

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    if (LOG_LEVELS[level] === undefined) {
      console.error(
        `[Logger] Invalid log level: "${level}". Valid levels: DEBUG, INFO, WARN, ERROR`
      );
      return;
    }
    this.config.level = level;
    this.saveConfig();
    console.log(
      `%c[Logger]%c Level set to: %c${level}`,
      'color: #6366f1; font-weight: bold',
      'color: inherit',
      'color: #22c55e; font-weight: bold'
    );
  }

  /**
   * Enable logging
   */
  enable(): void {
    this.config.enabled = true;
    this.saveConfig();
    console.log(
      '%c[Logger]%c Logging %cenabled',
      'color: #6366f1; font-weight: bold',
      'color: inherit',
      'color: #22c55e; font-weight: bold'
    );
  }

  /**
   * Disable all logging
   */
  disable(): void {
    console.log(
      '%c[Logger]%c Logging %cdisabled',
      'color: #6366f1; font-weight: bold',
      'color: inherit',
      'color: #ef4444; font-weight: bold'
    );
    this.config.enabled = false;
    this.saveConfig();
  }

  /**
   * Reset to environment defaults
   */
  reset(): void {
    this.config = {
      level: this.getDefaultLevel(),
      enabled: true,
    };
    this.saveConfig();
    console.log(
      `%c[Logger]%c Reset to defaults (level: ${this.config.level}, enabled: true)`,
      'color: #6366f1; font-weight: bold',
      'color: inherit'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // v2 sink infrastructure (addSink / getBuffer / emit) + telemetry
  // ─────────────────────────────────────────────────────────────

  /**
   * Register an additional sink that receives every non-duplicate record via fan-out.
   * Returns an unsubscribe fn. The Axiom sink registers here (attachAxiomSink).
   */
  addSink(fn: LogSink): () => void {
    if (typeof fn !== 'function') return () => {};
    this.sinks.add(fn);
    return () => {
      this.sinks.delete(fn);
    };
  }

  /** Remove a registered sink. */
  removeSink(fn: LogSink): void {
    this.sinks.delete(fn);
  }

  /** Shallow copy of the ring buffer (FIFO, cap = RING_BUFFER_SIZE) — for sink replay. */
  getBuffer(): LogRecord[] {
    return this.ringBuffer.slice();
  }

  /**
   * The single record choke-point for sink fan-out: timestamp → ring buffer → sinks.
   * Console rendering is NOT done here (each public method still owns its console output,
   * so the existing variadic call-surface is untouched). Duplicate records are buffered
   * but skipped from sinks. Each sink runs in its own try/catch (a failing sink can never
   * throw back or recurse).
   */
  private emit(record: LogRecord): void {
    const ts = Date.now();
    record.timestamp = ts;
    record.timestampISO = new Date(ts).toISOString();
    this.ringBuffer.push(record);
    if (this.ringBuffer.length > RING_BUFFER_SIZE) {
      this.ringBuffer.shift();
    }
    if (record.duplicate) return;
    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch (sinkError) {
        // A failing sink must not throw back nor be re-logged through the logger
        // (that would recurse). Raw console.error so the failure is not lost.
        console.error('[Logger] sink threw and was suppressed:', sinkError);
      }
    }
  }

  /**
   * Build a structured record from the variadic call-surface (logger.error('[tag] msg', obj)).
   * message = first string arg (the stable English event id); error = first Error found in args;
   * module = an explicit label, else a leading `[tag]` parsed from the message, else 'app'.
   */
  private buildRecord(level: LogLevel, module: string | undefined, args: unknown[]): LogRecord {
    let error: Error | undefined;
    for (const a of args) {
      if (a instanceof Error) {
        error = a;
        break;
      }
    }
    // A developer-supplied string LITERAL is the stable English event id and ships raw. Any
    // message DERIVED from a value we did not author (an Error's .message, or a stringified
    // object — including a cross-realm Error that fails `instanceof` and stringifies to
    // "Error: <msg>") is untrusted free text and is scrubbed with the SAME scrubMessage the
    // sink applies to err_msg, so a raw error.message can never reach ev.message. (D2)
    let message = '';
    const first = args[0];
    if (typeof first === 'string') {
      message = first;
    } else if (first instanceof Error) {
      message = scrubMessage(first.message);
    } else if (first !== undefined && first !== null) {
      try {
        message = scrubMessage(String(first));
      } catch {
        message = '';
      }
    }
    let mod = module;
    if (!mod) {
      const m = /^\s*\[([^\]]+)\]/.exec(message);
      mod = m ? m[1] : 'app';
    }
    return {
      kind: error ? 'error' : 'simple',
      level,
      module: mod,
      message,
      error,
    };
  }

  /**
   * track — usage telemetry (D3). Emits an INFO record carrying domainKind 'usage' +
   * alwaysShip:true, so it ships regardless of the WARN/ERROR policy. Dims fold into the
   * message via encodeDims (D4). The rendering kind stays 'simple'. Inert until a sink attaches.
   */
  track(event: string, dims?: Record<string, unknown> | null): void {
    const message = encodeDims(event, dims);
    this.emit({
      kind: 'simple',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message,
    });
    if (this.shouldLog('INFO')) {
      console.info(
        `%c${this.getTimestamp()} %c[usage]`,
        'color: #64748b',
        'color: #22c55e',
        message
      );
    }
  }

  /**
   * health — health signal (D5). Emits an INFO record, domainKind 'health', alwaysShip:true.
   * Metrics fold into the message via encodeDims (D4). Inert until a sink attaches.
   */
  health(signal: string, metrics?: Record<string, unknown> | null): void {
    const message = encodeDims(signal, metrics);
    this.emit({
      kind: 'simple',
      domainKind: 'health',
      alwaysShip: true,
      level: 'INFO',
      module: 'health',
      message,
    });
    if (this.shouldLog('INFO')) {
      console.info(
        `%c${this.getTimestamp()} %c[health]`,
        'color: #64748b',
        'color: #22c55e',
        message
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Logging Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Log a debug message
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog('DEBUG')) {
      console.debug(
        `%c${this.getTimestamp()} %c[DEBUG]`,
        'color: #64748b',
        'color: #6366f1',
        ...args
      );
    }
  }

  /**
   * Log an info message
   */
  info(...args: unknown[]): void {
    if (this.shouldLog('INFO')) {
      console.info(
        `%c${this.getTimestamp()} %c[INFO]`,
        'color: #64748b',
        'color: #22c55e',
        ...args
      );
    }
  }

  /**
   * Log a warning message
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog('WARN')) {
      console.warn(
        `%c${this.getTimestamp()} %c[WARN]`,
        'color: #64748b',
        'color: #f59e0b',
        ...args
      );
    }
    // WARN is forwarded to sinks even when the console is muted (production).
    this.emit(this.buildRecord('WARN', undefined, args));
  }

  /**
   * Log an error message
   */
  error(...args: unknown[]): void {
    if (this.shouldLog('ERROR')) {
      console.error(
        `%c${this.getTimestamp()} %c[ERROR]`,
        'color: #64748b',
        'color: #ef4444',
        ...args
      );
    }
    // ERROR is forwarded to sinks even when the console is muted (production).
    this.emit(this.buildRecord('ERROR', undefined, args));
  }

  /**
   * Log with a custom label (useful for component/module-specific logs)
   */
  labeled(label: string, level: LogLevel, ...args: unknown[]): void {
    if (this.shouldLog(level)) {
      const colors: Record<LogLevel, string> = {
        DEBUG: '#6366f1',
        INFO: '#22c55e',
        WARN: '#f59e0b',
        ERROR: '#ef4444',
      };
      const method = level === 'DEBUG' ? 'debug'
                   : level === 'INFO' ? 'info'
                   : level === 'WARN' ? 'warn'
                   : 'error';
      console[method](
        `%c${this.getTimestamp()} %c[${label}]`,
        'color: #64748b',
        `color: ${colors[level]}`,
        ...args
      );
    }
    // WARN/ERROR labeled records ship too (module = the label). INFO/DEBUG stay console-only.
    if (level === 'WARN' || level === 'ERROR') {
      this.emit(this.buildRecord(level, label, args));
    }
  }

  /**
   * Create a child logger with a fixed label prefix
   */
  createLabeled(label: string) {
    return {
      debug: (...args: unknown[]) => this.labeled(label, 'DEBUG', ...args),
      info: (...args: unknown[]) => this.labeled(label, 'INFO', ...args),
      warn: (...args: unknown[]) => this.labeled(label, 'WARN', ...args),
      error: (...args: unknown[]) => this.labeled(label, 'ERROR', ...args),
    };
  }
}

// Singleton instance
export const logger = new Logger();
export default logger;

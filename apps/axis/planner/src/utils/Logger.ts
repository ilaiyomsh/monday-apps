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

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const STORAGE_KEY = 'planner_logger_config';

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

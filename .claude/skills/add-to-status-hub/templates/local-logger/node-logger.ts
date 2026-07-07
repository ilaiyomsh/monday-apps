/**
 * Node.js Logging Service
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Environment-aware defaults (PROD: ERROR, DEV: DEBUG)
 * - Runtime control via environment variables
 * - Colored console output (auto-disabled when not TTY)
 * - JSON output option for log aggregators
 *
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.debug('Debug message');
 *   logger.info('Info message');
 *   logger.warn('Warning message');
 *   logger.error('Error message');
 *
 * Environment Variables:
 *   LOG_LEVEL=debug|info|warn|error  // Set log level
 *   LOG_ENABLED=true|false           // Enable/disable logging
 *   LOG_FORMAT=text|json             // Output format
 *   NO_COLOR=1                       // Disable colors
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

interface LoggerConfig {
  level: LogLevel;
  enabled: boolean;
  format: 'text' | 'json';
  colors: boolean;
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  purple: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

class Logger {
  private config: LoggerConfig;

  constructor() {
    this.config = this.loadConfig();
    this.logInitialization();
  }

  /**
   * Load config from environment variables
   */
  private loadConfig(): LoggerConfig {
    const isProd = process.env.NODE_ENV === 'production';
    const isTTY = process.stdout.isTTY ?? false;

    // Parse log level from env
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() as LogLevel | undefined;
    const level = envLevel && LOG_LEVELS[envLevel] !== undefined
      ? envLevel
      : (isProd ? 'ERROR' : 'DEBUG');

    // Parse enabled flag
    const enabled = process.env.LOG_ENABLED !== 'false';

    // Parse format
    const format = process.env.LOG_FORMAT === 'json' ? 'json' : 'text';

    // Colors: disabled in prod, non-TTY, or if NO_COLOR is set
    const colors = !isProd && isTTY && !process.env.NO_COLOR;

    return { level, enabled, format, colors };
  }

  /**
   * Log initialization message in development
   */
  private logInitialization(): void {
    if (process.env.NODE_ENV !== 'production' && this.config.enabled) {
      const { level, format, colors } = this.config;
      if (this.config.format === 'json') {
        console.log(JSON.stringify({
          level: 'info',
          message: 'Logger initialized',
          config: { level, format, colors },
          timestamp: new Date().toISOString(),
        }));
      } else {
        const prefix = colors
          ? `${COLORS.purple}[Logger]${COLORS.reset}`
          : '[Logger]';
        console.log(`${prefix} Initialized (level: ${level}, format: ${format}, colors: ${colors})`);
      }
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
    return new Date().toISOString();
  }

  /**
   * Get color for log level
   */
  private getLevelColor(level: LogLevel): string {
    if (!this.config.colors) return '';
    switch (level) {
      case 'DEBUG': return COLORS.purple;
      case 'INFO': return COLORS.green;
      case 'WARN': return COLORS.yellow;
      case 'ERROR': return COLORS.red;
    }
  }

  /**
   * Format and output a log message
   */
  private log(level: LogLevel, label: string | null, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = this.getTimestamp();

    if (this.config.format === 'json') {
      // JSON format for log aggregators
      const logEntry: Record<string, unknown> = {
        timestamp,
        level: level.toLowerCase(),
        message: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' '),
      };
      if (label) logEntry.label = label;

      // Add error details if present
      const errorArg = args.find(arg => arg instanceof Error) as Error | undefined;
      if (errorArg) {
        logEntry.error = {
          name: errorArg.name,
          message: errorArg.message,
          stack: errorArg.stack,
        };
      }

      console.log(JSON.stringify(logEntry));
    } else {
      // Text format with optional colors
      const { colors } = this.config;
      const levelColor = this.getLevelColor(level);
      const reset = colors ? COLORS.reset : '';
      const dim = colors ? COLORS.dim : '';

      const timestampStr = dim + timestamp.substring(11, 23) + reset;
      const levelStr = levelColor + `[${label || level}]` + reset;

      const method = level === 'ERROR' ? 'error'
                   : level === 'WARN' ? 'warn'
                   : 'log';

      console[method](timestampStr, levelStr, ...args);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Public Control API
  // ─────────────────────────────────────────────────────────────

  /**
   * Set the minimum log level at runtime
   */
  setLevel(level: LogLevel): void {
    if (LOG_LEVELS[level] === undefined) {
      console.error(`[Logger] Invalid log level: "${level}". Valid levels: DEBUG, INFO, WARN, ERROR`);
      return;
    }
    this.config.level = level;
    console.log(`[Logger] Level set to: ${level}`);
  }

  /**
   * Enable logging
   */
  enable(): void {
    this.config.enabled = true;
    console.log('[Logger] Logging enabled');
  }

  /**
   * Disable all logging
   */
  disable(): void {
    console.log('[Logger] Logging disabled');
    this.config.enabled = false;
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  // ─────────────────────────────────────────────────────────────
  // Logging Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Log a debug message
   */
  debug(...args: unknown[]): void {
    this.log('DEBUG', null, args);
  }

  /**
   * Log an info message
   */
  info(...args: unknown[]): void {
    this.log('INFO', null, args);
  }

  /**
   * Log a warning message
   */
  warn(...args: unknown[]): void {
    this.log('WARN', null, args);
  }

  /**
   * Log an error message
   */
  error(...args: unknown[]): void {
    this.log('ERROR', null, args);
  }

  /**
   * Log with a custom label (useful for module-specific logs)
   */
  labeled(label: string, level: LogLevel, ...args: unknown[]): void {
    this.log(level, label, args);
  }

  /**
   * Create a child logger with a fixed label prefix
   */
  createLabeled(label: string) {
    return {
      debug: (...args: unknown[]) => this.log('DEBUG', label, args),
      info: (...args: unknown[]) => this.log('INFO', label, args),
      warn: (...args: unknown[]) => this.log('WARN', label, args),
      error: (...args: unknown[]) => this.log('ERROR', label, args),
    };
  }
}

// Singleton instance
export const logger = new Logger();
export default logger;

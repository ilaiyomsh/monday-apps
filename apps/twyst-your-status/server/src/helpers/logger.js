/**
 * logger — structured JSON lines to stdout/stderr, which monday-code captures
 * (`mapps code:logs`). Deliberately tiny: level, message, tag, context.
 * The client app's ring-buffer/sink logger is a browser design; the server
 * needs greppable lines, nothing more. Axiom shipping for the guard rides the
 * error-kit standard in a later round (documented in GUARD-ACTIVATION.md).
 */

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

const logger = {
  debug: (message, tag, context) => line('debug', message, tag, context),
  info: (message, tag, context) => line('info', message, tag, context),
  warn: (message, tag, context) => line('warn', message, tag, context),
  error: (message, tag, context) => line('error', message, tag, context),
};

export default logger;

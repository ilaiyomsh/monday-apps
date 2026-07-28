// Process-level safety nets. Node terminates the process on an uncaught
// exception or (by default in modern Node) an unhandled promise rejection — and
// before this app had these guards, that death reached NOBODY: no shipped error,
// no console trail beyond Node's own stderr dump. These handlers funnel both
// through the logger (so they ship to Axiom) and, for an uncaught exception,
// drain the Axiom buffer before exiting non-zero so the fatal record is not lost.
//
// SIGTERM/SIGINT graceful shutdown stays in index.js (it owns the http server);
// this module owns only the crash nets.

// Hard ceiling on flush time in the crash path — a hung Axiom endpoint must
// never wedge a dying process (matches deadline-confirm's flushAndExit).
const UNCAUGHT_FLUSH_CEILING_MS = 2000;

/**
 * Install uncaughtException + unhandledRejection handlers.
 *
 * @param {object} deps
 * @param {{ error: (message: string, tag?: string, context?: object) => void }} deps.logger
 * @param {() => Promise<void>} deps.flush - drains the Axiom buffer (never throws)
 * @param {(code: number) => void} [deps.exit] - process exit (injectable for tests)
 * @param {typeof setTimeout} [deps.setTimeoutFn] - timer seam (injectable for tests)
 * @returns {{ onUncaughtException: (err: Error) => Promise<void>, onUnhandledRejection: (reason: unknown) => void }}
 */
export function installProcessGuards({
  logger,
  flush,
  exit = (code) => process.exit(code),
  setTimeoutFn = setTimeout,
}) {
  // A rejected promise nobody awaited. Log + ship, but do NOT exit: the process
  // is still healthy and killing it would drop in-flight webhooks. Node's default
  // (terminate) is thereby overridden deliberately.
  const onUnhandledRejection = (reason) => {
    logger.error('unhandled_rejection', 'process', {
      stage: 'process',
      cause: reason instanceof Error ? reason.message : String(reason),
      error: reason instanceof Error ? reason : undefined,
    });
  };

  // A synchronous throw nothing caught. The process state is now unknown, so we
  // ship the record, flush the buffer, and exit(1) to let monday-code restart a
  // clean container. The flush is RACED against a hard ceiling: flushAxiom awaits
  // the remote Axiom fetch with no timeout of its own (see logger.js#flush, whose
  // comment explicitly delegates that race to the caller), so a stuck endpoint
  // would otherwise leave a crashed process alive and still receiving webhooks.
  // deadline-confirm + telemetry-dashboard impose the same ceiling on their crash
  // paths. Returns the flush→exit promise so callers/tests can await it.
  const onUncaughtException = (err) => {
    logger.error('uncaught_exception', 'process', {
      stage: 'process',
      cause: err?.message,
      error: err instanceof Error ? err : undefined,
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      exit(1);
    };
    // Belt and suspenders: exit even if the flush hangs past the ceiling.
    const timer = setTimeoutFn(finish, UNCAUGHT_FLUSH_CEILING_MS);
    timer?.unref?.();
    // flushAxiom is documented never to throw, but guard defensively: a flush
    // failure must not stop the exit. Log it (not silent) then exit(1) regardless.
    return Promise.resolve(flush())
      .catch((flushErr) => {
        logger.error('uncaught_flush_failed', 'process', {
          stage: 'process',
          cause: flushErr?.message,
          error: flushErr instanceof Error ? flushErr : undefined,
        });
      })
      .finally(finish);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return { onUncaughtException, onUnhandledRejection };
}

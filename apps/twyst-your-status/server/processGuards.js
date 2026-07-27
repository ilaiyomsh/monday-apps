const EXIT_DELAY_MS = 2_000;
let installed = false;
let gracefulServer = null;

export function setGracefulServer(server) {
  gracefulServer = server;
}

export function installProcessGuards(logger, { flush } = {}) {
  if (installed) return;
  installed = true;
  const flushAndExit = (code) => {
    const timer = setTimeout(() => process.exit(code), EXIT_DELAY_MS);
    timer.unref?.();
    Promise.resolve()
      .then(() => (typeof flush === 'function' ? flush() : undefined))
      .catch(() => {})
      .then(() => process.exit(code));
  };
  process.on('uncaughtException', (error) => {
    try { logger.error('uncaught_exception', 'process', { error }); } catch { /* exit regardless */ }
    flushAndExit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    try { logger.error('unhandled_rejection', 'process', { error }); } catch { /* exit regardless */ }
    flushAndExit(1);
  });
  const signalHandler = (signal) => () => {
    try { logger.info('shutdown_signal', 'process', { signal }); } catch { /* exit regardless */ }
    try { gracefulServer?.close?.(); } catch { /* best effort */ }
    flushAndExit(0);
  };
  process.on('SIGTERM', signalHandler('SIGTERM'));
  process.on('SIGINT', signalHandler('SIGINT'));
}

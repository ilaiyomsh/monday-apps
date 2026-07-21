// Terminal Express error middleware (4-arg). Registered AFTER all routes so any
// error passed to next(err) — or thrown by an async handler that forwards to it —
// lands here, gets shipped through the logger, and returns a 500 JSON envelope
// instead of Express's default HTML error page. Without this, an async route
// rejection that no local try/catch caught reached nobody (no shipped trail).
//
// The signature MUST keep all four params (err, req, res, next) so Express
// recognises it as an error handler rather than a normal middleware.

/**
 * Build the terminal error middleware bound to a logger.
 * @param {{ error: (message: string, tag?: string, context?: object) => void }} logger
 * @returns {import('express').ErrorRequestHandler}
 */
export function createErrorMiddleware(logger) {
  return function terminalErrorMiddleware(err, req, res, next) {
    logger.error('error', 'http', {
      stage: 'terminal',
      method: req?.method,
      path: req?.path,
      status: 500,
      cause: err?.message,
      error: err instanceof Error ? err : undefined,
    });
    // Headers already flushed (e.g. a stream failed mid-response): we cannot send
    // a JSON body, so hand off to Express's default handler which closes the
    // connection. Not silent — the logger.error above already shipped the error.
    if (res.headersSent) return next(err);
    return res.status(500).json({ error: 'internal_error' });
  };
}

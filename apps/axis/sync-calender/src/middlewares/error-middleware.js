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
    // Coerce a non-Error rejection (next('str'), a thrown object) into an Error so the
    // shipped record always carries err_name/err_msg/stack + a cause. Without this, a
    // non-Error left ctx.error undefined AND ctx.cause (err?.message) undefined — the
    // record shipped empty and a real failure was invisible in Axiom.
    const e = err instanceof Error ? err : new Error(String(err?.message ?? err));
    logger.error('error', 'http', {
      stage: 'terminal',
      method: req?.method,
      path: req?.path,
      status: 500,
      cause: e.message,
      error: e,
    });
    // Headers already flushed (e.g. a stream failed mid-response): we cannot send
    // a JSON body, so hand off to Express's default handler which closes the
    // connection. Not silent — the logger.error above already shipped the error.
    if (res.headersSent) return next(err);
    return res.status(500).json({ error: 'internal_error' });
  };
}

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
    // Honour a status the thrower already decided (body-parser sets 400 on a malformed
    // JSON body, 413 over the size limit) — Express's finalhandler did this before this
    // middleware existed. Blanket-500ing a client error is not cosmetic: Microsoft Graph
    // and Google mark a push subscription unhealthy on 5xx, so one truncated webhook body
    // could take the subscription down. Only a sane 4xx is trusted; anything else is a 500.
    const claimed = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(claimed) && claimed >= 400 && claimed <= 499 ? claimed : 500;
    logger.error('error', 'http', {
      stage: 'terminal',
      method: req?.method,
      path: req?.path,
      status,
      cause: e.message,
      error: e,
    });
    // Headers already flushed (e.g. a stream failed mid-response): we cannot send
    // a JSON body, so hand off to Express's default handler which closes the
    // connection. Not silent — the logger.error above already shipped the error.
    if (res.headersSent) return next(err);
    // Generic envelope per class — never echo e.message back to the caller.
    return res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  };
}

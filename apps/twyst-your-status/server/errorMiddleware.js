export const errorMiddleware = (logger) => (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const normalized = error instanceof Error ? error : new Error(String(error));
  logger.error('unhandled_route_error', 'http', {
    error: normalized,
    method: req.method,
    path: req.path,
  });
  const requestedStatus = error?.status ?? error?.statusCode;
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : error?.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({
    error: status === 500 ? 'internal_error' : 'request_failed',
    correlationId: normalized.correlationId,
  });
};

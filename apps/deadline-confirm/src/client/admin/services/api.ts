// Server API wrapper — every /api call carries the monday sessionToken
// (verified server-side with the client secret + ALLOWED_ACCOUNT_ID).

import { getSessionToken } from './monday';
import logger from '../utils/logger';
import { latencyBucket } from '../utils/latency';

export class ApiError extends Error {
  status: number;
  field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getSessionToken();
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // network/transport failure — no response arrived
    logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: false });
    logger.error('api', 'request_failed', err);
    throw err;
  }
  // API-latency health (D5): bucketed so it dedups; ships as kind='health' (inert until active).
  logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: res.ok, status: res.status });
  if (!res.ok) {
    let message = `request failed: ${res.status}`;
    let field: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; field?: string };
      if (body.error) message = body.error;
      field = body.field;
    } catch {
      // non-JSON error body — keep the status-based message (AbortError-style
      // silent catch is sanctioned only here: the fallback message IS the handling)
    }
    // Stable English event id; the ApiError rides record.error (scrubbed to err_msg). The
    // logger dedups by instance, so a caller that re-logs this same error won't double-ship.
    const apiError = new ApiError(message, res.status, field);
    logger.error('api', 'request_failed', apiError);
    throw apiError;
  }
  return (await res.json()) as T;
}

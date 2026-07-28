// Server API wrapper — every /api call carries the monday sessionToken
// (verified server-side with the client secret + ALLOWED_ACCOUNT_ID).

import { getSessionToken } from './monday';
import logger from '../utils/logger';
import { latencyBucket } from '../utils/latency';

export class ApiError extends Error {
  status: number;
  field?: string;
  /** Server-provided detail for 5xx (name/message/stack) when present. */
  detail?: { name?: string; message?: string; stack?: string | null };

  constructor(
    message: string,
    status: number,
    field?: string,
    detail?: { name?: string; message?: string; stack?: string | null }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.detail = detail;
  }
}

/** User-facing text: Hebrew fallback + server message/stack when the API sent detail. */
export function formatApiFailure(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const chunks = [fallback];
  if (err.message) chunks.push(err.message);
  if (err.detail?.stack) {
    chunks.push(err.detail.stack);
  } else if (err.detail?.message) {
    chunks.push(`${err.detail.name ?? 'Error'}: ${err.detail.message}`);
  }
  return chunks.join('\n\n');
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
    let detail: ApiError['detail'];
    try {
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        field?: string;
        detail?: { name?: string; message?: string; stack?: string | null };
      };
      // Prefer the server's human message when there is one — it carries the
      // Hebrew diagnostic with its `[admin …]` / `[E…]` tag — prefixed by the
      // stable `error` code; fall back to the code alone.
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.error ? `${body.error}: ${body.message}` : body.message;
      } else if (body.error) {
        message = body.error;
      }
      field = body.field;
      detail = body.detail;
    } catch {
      // non-JSON error body — keep the status-based message (AbortError-style
      // silent catch is sanctioned only here: the fallback message IS the handling)
    }
    // Stable English event id; the ApiError rides record.error (scrubbed to err_msg). The
    // logger dedups by instance, so a caller that re-logs this same error won't double-ship.
    const apiError = new ApiError(message, res.status, field, detail);
    logger.error('api', 'request_failed', apiError);
    if (detail?.stack) {
      console.error('[api] server error detail:', detail.name, detail.message, '\n', detail.stack);
    }
    throw apiError;
  }
  return (await res.json()) as T;
}

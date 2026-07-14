// Server API wrapper — every /api call carries the monday sessionToken
// (verified server-side with the client secret + ALLOWED_ACCOUNT_ID).

import { getSessionToken } from './monday';

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
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      ...(init.headers ?? {}),
    },
  });
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
    throw new ApiError(message, res.status, field);
  }
  return (await res.json()) as T;
}

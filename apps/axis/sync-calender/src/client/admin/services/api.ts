export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let currentToken: string | null = null;
export function setSessionToken(token: string | null) {
  currentToken = token;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (!currentToken) throw new ApiError('sessionToken_not_ready', 0, null);
  const headers = new Headers(options.headers);
  headers.set('Authorization', currentToken);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message =
      (typeof body === 'object' && body && 'error' in body && String((body as { error: string }).error))
      || (typeof body === 'string' ? body : 'request_failed');
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

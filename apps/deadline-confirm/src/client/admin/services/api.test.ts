// Retrofit characterization tests (test-guard) for the /api fetch wrapper's
// auth-header and error-mapping behavior.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, formatApiFailure } from './api';

vi.mock('./monday', () => ({
  getSessionToken: () => Promise.resolve('session-tok-1'),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  const spy = vi.fn().mockResolvedValue({
    json: () => Promise.reject(new Error('no body')),
    ...response,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('apiFetch', () => {
  it('sends the sessionToken as the Authorization header and returns the parsed body', async () => {
    const spy = stubFetch({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await expect(apiFetch('/api/state')).resolves.toStrictEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/state');
    expect((init.headers as Record<string, string>).Authorization).toBe('session-tok-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('maps a JSON error body to ApiError with its error text, status, and field', async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_config', field: 'boardId' }),
    });

    const err = await apiFetch('/api/config', { method: 'PUT' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('invalid_config');
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).field).toBe('boardId');
  });

  it('falls back to a status-based message when the error body is not JSON', async () => {
    stubFetch({ ok: false, status: 502 });

    const err = await apiFetch('/api/state').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('request failed: 502');
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).field).toBeUndefined();
  });

  it('maps a 500 internal_error body to ApiError message + detail (name/message/stack)', async () => {
    stubFetch({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'internal_error',
        message: 'secure storage failed',
        detail: {
          name: 'Error',
          message: 'secure storage failed',
          stack: 'Error: secure storage failed\n    at getConfig (storage.js:1:1)',
        },
      }),
    });

    const err = await apiFetch('/api/state').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('internal_error: secure storage failed');
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).detail).toStrictEqual({
      name: 'Error',
      message: 'secure storage failed',
      stack: 'Error: secure storage failed\n    at getConfig (storage.js:1:1)',
    });
  });
});

describe('formatApiFailure', () => {
  it('joins Hebrew fallback, ApiError message, and detail.stack for display', () => {
    const err = new ApiError('internal_error: boom', 500, undefined, {
      name: 'Error',
      message: 'boom',
      stack: 'Error: boom\n    at x',
    });
    expect(formatApiFailure(err, 'טעינה נכשלה')).toBe(
      'טעינה נכשלה\n\ninternal_error: boom\n\nError: boom\n    at x'
    );
  });

  it('returns only the fallback for a non-ApiError', () => {
    expect(formatApiFailure(new Error('nope'), 'טעינה נכשלה')).toBe('טעינה נכשלה');
  });
});

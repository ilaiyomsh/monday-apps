// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MondayApiError, createMondayApi } from './mondayApi.js';

function response({ ok = true, status = 200, body = { data: { ok: true } } } = {}) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

describe('createMondayApi GraphQL funnel', () => {
  it('pins the sanctioned API version and applies a bounded timeout signal', async () => {
    const signal = new AbortController().signal;
    const signalFactory = vi.fn(() => signal);
    const fetchImpl = vi.fn().mockResolvedValue(response());
    const api = createMondayApi({ fetchImpl, signalFactory, timeoutMs: 7_500 });

    await expect(api.graphql({ token: 'token-1', query: 'query Ping { me { id } }' }))
      .resolves.toEqual({ ok: true });

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers['API-Version']).toBe('2026-04');
    expect(options.signal).toBe(signal);
    expect(signalFactory).toHaveBeenCalledWith(7_500);
  });

  it('classifies transport failures without losing the original cause', async () => {
    const cause = new Error('offline');
    const api = createMondayApi({ fetchImpl: vi.fn().mockRejectedValue(cause) });

    await expect(api.graphql({ token: 'token', query: 'query { me { id } }' }))
      .rejects.toMatchObject({
        name: 'MondayApiError', code: 'monday_network', cause,
      });
  });

  it('classifies HTTP and malformed-JSON responses separately', async () => {
    const httpApi = createMondayApi({
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status: 503, body: {} })),
    });
    await expect(httpApi.graphql({ token: 'token', query: 'query { me { id } }' }))
      .rejects.toMatchObject({ code: 'monday_http', status: 503 });

    const jsonApi = createMondayApi({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true, status: 200, json: vi.fn().mockRejectedValue(new Error('bad json')),
      }),
    });
    await expect(jsonApi.graphql({ token: 'token', query: 'query { me { id } }' }))
      .rejects.toMatchObject({ code: 'monday_bad_json' });
  });

  it('surfaces GraphQL soft errors with monday extension codes intact', async () => {
    const errors = [{
      message: 'invalid value',
      extensions: { code: 'ColumnValueException', error_code: 'ColumnValueException' },
    }];
    const api = createMondayApi({
      fetchImpl: vi.fn().mockResolvedValue(response({ body: { data: null, errors } })),
    });

    const rejection = api.graphql({ token: 'token', query: 'mutation { x }' });
    await expect(rejection).rejects.toBeInstanceOf(MondayApiError);
    await expect(rejection).rejects.toMatchObject({
      code: 'monday_graphql',
      mondayCode: 'ColumnValueException',
      errors,
    });
  });

  it('rejects a blank OAuth token before making a network request', async () => {
    const fetchImpl = vi.fn();
    const api = createMondayApi({ fetchImpl });

    await expect(api.graphql({ token: ' ', query: 'query { me { id } }' }))
      .rejects.toMatchObject({ code: 'monday_token_missing' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

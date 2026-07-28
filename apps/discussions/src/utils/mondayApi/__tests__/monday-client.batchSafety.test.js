import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeApi: vi.fn(),
  monday: {
    api: vi.fn(),
    setApiVersion: vi.fn(),
    setToken: vi.fn(),
  },
}));

vi.mock('monday-sdk-js', () => ({
  default: () => mocks.monday,
}));

vi.mock('../client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, safeApi: mocks.safeApi };
});

vi.mock('../../logger.js', () => ({
  default: {
    apiError: vi.fn(),
    info: vi.fn(),
  },
}));

import { api, API_VERSION } from '../monday-client.js';

describe('monday api batch safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards retry:false and preserves partial GraphQL data on the thrown error', async () => {
    const query = 'mutation Batch { first: create_item(board_id: 1, item_name: "A") { id } }';
    const variables = { marker: 'batch' };
    const rawResponse = {
      data: { first: { id: '101' }, second: null },
      errors: [{ message: 'second failed', path: ['second'] }],
    };
    mocks.safeApi.mockResolvedValueOnce(rawResponse);

    await expect(api(query, variables, 'batchSafety', { retry: false })).rejects.toMatchObject({
      response: rawResponse,
    });

    expect(mocks.safeApi).toHaveBeenCalledWith(
      mocks.monday,
      'batchSafety',
      query,
      { variables, apiVersion: API_VERSION, retry: false }
    );
  });
});

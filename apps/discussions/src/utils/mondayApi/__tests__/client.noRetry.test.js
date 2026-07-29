import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  default: {
    api: vi.fn(),
    apiResponse: vi.fn(),
    apiError: vi.fn(),
    health: vi.fn(),
    warn: vi.fn(),
  },
}));

import { safeApi } from '../client.js';

describe('safeApi non-idempotent request mode', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not retry a retryable transport failure when retry is false', async () => {
    vi.useFakeTimers();
    const transportError = new Error('Failed to fetch');
    const monday = { api: vi.fn().mockRejectedValue(transportError) };

    const pending = safeApi(
      monday,
      'nonIdempotentBatch',
      'mutation NonIdempotentBatch { create_item(board_id: 1, item_name: "A") { id } }',
      { retry: false }
    );
    const rejection = expect(pending).rejects.toMatchObject({ message: 'Failed to fetch' });
    await vi.runAllTimersAsync();

    await rejection;
    expect(monday.api).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: vi.fn(),
      setItem: vi.fn(async () => ({ data: { success: true } })),
    },
  },
}));

vi.mock('../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import * as topicOrder from '../topicOrder.js';
import { monday } from '../mondayApi/monday-client.js';
import logger from '../logger.js';

const saveFreshTopicOrder =
  topicOrder.saveFreshTopicOrder ??
  (async () => {
    throw new Error('NOT_IMPLEMENTED');
  });

const DISCUSSION_ID = '8123456789';
const STORAGE_KEY = `discussions_topic_order_${DISCUSSION_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  monday.storage.setItem.mockResolvedValue({ data: { success: true } });
});

describe('saveFreshTopicOrder', () => {
  it('persists a string-normalized fresh topic and point order with one storage write and no read', async () => {
    await saveFreshTopicOrder(DISCUSSION_ID, {
      topics: [2001, '2002'],
      points: {
        2001: [3001, '3002'],
        2002: [3003],
      },
    });

    expect(monday.storage.getItem).not.toHaveBeenCalled();
    expect(monday.storage.setItem).toHaveBeenCalledTimes(1);
    expect(monday.storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));

    const storedJson = monday.storage.setItem.mock.calls[0][1];
    expect(JSON.parse(storedJson)).toEqual({
      topics: ['2001', '2002'],
      points: {
        2001: ['3001', '3002'],
        2002: ['3003'],
      },
    });
  });

  it.each([null, undefined, '', 0])(
    'is a no-op when the discussion id is invalid (%s)',
    async (discussionId) => {
      await expect(
        saveFreshTopicOrder(discussionId, {
          topics: ['2001'],
          points: { 2001: ['3001'] },
        })
      ).resolves.toBeUndefined();

      expect(monday.storage.getItem).not.toHaveBeenCalled();
      expect(monday.storage.setItem).not.toHaveBeenCalled();
    }
  );

  it('treats setItem failure as best-effort and logs a warning', async () => {
    const storageError = new Error('storage unavailable');
    monday.storage.setItem.mockRejectedValueOnce(storageError);

    await expect(
      saveFreshTopicOrder(DISCUSSION_ID, {
        topics: ['2001'],
        points: { 2001: ['3001'] },
      })
    ).resolves.toBeUndefined();

    expect(monday.storage.getItem).not.toHaveBeenCalled();
    expect(monday.storage.setItem).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'topicOrder',
      expect.any(String),
      storageError
    );
  });
});

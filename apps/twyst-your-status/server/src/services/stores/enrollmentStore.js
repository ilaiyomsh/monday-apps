import { unwrapStoredValue } from './unwrapStoredValue.js';

/**
 * enrollmentStore — which board+column pairs already carry our webhook.
 * @param {{ secureStorage: { get(k): Promise<any>, set(k,v): Promise<any> } }} deps
 */
export function createEnrollmentStore({ secureStorage }) {
  const keyOf = (accountId, boardId, columnId) => `${accountId}:enrolled:${boardId}:${columnId}`;
  return {
    async get(accountId, boardId, columnId) {
      return unwrapStoredValue(await secureStorage.get(keyOf(accountId, boardId, columnId)));
    },
    async set(accountId, boardId, columnId, webhookId) {
      await secureStorage.set(keyOf(accountId, boardId, columnId), webhookId);
    },
  };
}

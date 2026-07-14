// Production backend: @mondaycom/apps-sdk SecureStorage, normalized to the
// { get, set, delete } backend contract. Pure passthrough — no logic.

import { SecureStorage } from '@mondaycom/apps-sdk';

export function createSecureStorageBackend() {
  const secureStorage = new SecureStorage();
  return {
    async get(key) {
      const value = await secureStorage.get(key);
      return value ?? null;
    },
    async set(key, value) {
      await secureStorage.set(key, value);
    },
    async delete(key) {
      await secureStorage.delete(key);
    },
  };
}

import { SecureStorage } from '@mondaycom/apps-sdk';

function unwrapPrimitive(value) {
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && 'value' in value
  ) {
    return value.value;
  }
  return value;
}
export function createSecureStorageBackend() {
  const storage = new SecureStorage();
  return {
    async get(key) {
      return unwrapPrimitive(await storage.get(key)) ?? null;
    },
    async set(key, value) {
      await storage.set(key, value);
    },
    async delete(key) {
      await storage.delete(key);
    },
  };
}

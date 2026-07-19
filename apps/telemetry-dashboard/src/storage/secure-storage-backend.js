// Production backend: @mondaycom/apps-sdk SecureStorage, normalized to the
// { get, set, delete } backend contract (adapted from deadline-confirm's
// src/storage/secure-storage-backend.js — same platform quirk applies here).
//
// PLATFORM QUIRK (apps-sdk 0.1.4, source-verified + production-observed):
// SecureStorage.set wraps PRIMITIVES as { value } —
// `formalizedValue = isObject(value) ? value : { value }` — and get returns
// the wrapper verbatim. Without unwrapping, a stored string (the
// owner:oauth_token) comes back as an object: Authorization becomes
// '[object Object]' → 401 from monday, and board writes fail-soft silently.
// Objects pass through untouched.

import { SecureStorage } from '@mondaycom/apps-sdk';

function unwrapPrimitive(value) {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    'value' in value
  ) {
    return value.value;
  }
  return value;
}

export function createSecureStorageBackend() {
  const secureStorage = new SecureStorage();
  return {
    async get(key) {
      const value = await secureStorage.get(key);
      return unwrapPrimitive(value) ?? null;
    },
    async set(key, value) {
      await secureStorage.set(key, value);
    },
    async delete(key) {
      await secureStorage.delete(key);
    },
  };
}

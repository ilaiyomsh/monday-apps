// Production backend: @mondaycom/apps-sdk SecureStorage, normalized to the
// { get, set, delete } backend contract.
//
// PLATFORM QUIRK (apps-sdk 0.1.4, source-verified + production-observed
// 2026-07-15): SecureStorage.set wraps PRIMITIVES as { value } —
// `formalizedValue = isObject(value) ? value : { value }` — and get returns
// the wrapper verbatim. Without unwrapping, stored strings (oauth_token,
// link_secret) come back as objects: Authorization becomes
// '[object Object]' → 401 → the admin shows "broken" although the token is
// fine. Objects (config, nonces) pass through untouched.

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
      try {
        const value = await secureStorage.get(key);
        return unwrapPrimitive(value) ?? null;
      } catch (err) {
        const wrapped = new Error(`secure_storage_get_failed: ${String(err?.message ?? err)}`);
        wrapped.cause = err;
        throw wrapped;
      }
    },
    async set(key, value) {
      try {
        await secureStorage.set(key, value);
      } catch (err) {
        const wrapped = new Error(`secure_storage_set_failed: ${String(err?.message ?? err)}`);
        wrapped.cause = err;
        throw wrapped;
      }
    },
    async delete(key) {
      try {
        await secureStorage.delete(key);
      } catch (err) {
        const wrapped = new Error(`secure_storage_delete_failed: ${String(err?.message ?? err)}`);
        wrapped.cause = err;
        throw wrapped;
      }
    },
  };
}

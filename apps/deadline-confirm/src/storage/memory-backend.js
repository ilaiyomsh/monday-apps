// In-memory SecureStorage-compatible backend — local dev + tests only
// (production uses secure-storage-backend.js). Deliberately trivial:
// a Map behind the async backend contract.

export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

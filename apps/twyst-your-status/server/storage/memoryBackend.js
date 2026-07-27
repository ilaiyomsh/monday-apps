export function createMemoryBackend(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    async get(key) {
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async delete(key) {
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries([...values].map(([key, value]) => [key, structuredClone(value)]));
    },
  };
}

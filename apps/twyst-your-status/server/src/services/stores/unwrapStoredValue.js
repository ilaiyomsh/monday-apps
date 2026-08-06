/** Unwrap apps-sdk 0.1.4's `{ value: ... }` primitive wrapping (both shapes). */
export function unwrapStoredValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'value')) {
    return raw.value ?? null;
  }
  return raw;
}

export function validToken(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.token !== 'string' || record.token === '') return null;
  return record;
}

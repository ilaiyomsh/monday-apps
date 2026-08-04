/**
 * guardBase — one source of truth for the base URL of calls to the guard.
 *
 * Since the same-origin unification (round324) the guard server SERVES this
 * SPA, so in every real deployment the API is same-origin: the base is '' and
 * callers fetch relative paths ('/api/guard/*'). There is no build-time guard
 * URL and no CORS.
 *
 * The one exception is the local dev-harness (VITE_MONDAY_MOCK): it runs the
 * SPA on a vite dev server with no backend, so a relative call would hit the
 * dev server. There we return null and callers skip the guard entirely.
 *
 * @param {string|null|undefined} explicit  test/override base; null = skip
 * @returns {string|null}  '' (same-origin), a normalized base URL, or null (skip)
 */
export function resolveGuardBase(explicit) {
  const raw = explicit !== undefined
    ? explicit
    : (import.meta.env?.VITE_MONDAY_MOCK ? null : '');
  if (raw === null) return null;
  return String(raw).replace(/\/$/, '');
}

/**
 * Runtime accessor for design tokens defined in `tokens.css`.
 *
 * Used when JS needs the *value* (hex string) of a token — e.g. for color
 * math, for serializing into Monday API payloads, or for passing through
 * inline styles where a CSS `var()` is not acceptable.
 *
 * For CSS-only consumers (inline style, className) prefer `var(--token-name)`
 * directly or the matching Tailwind utility class — those don't need this.
 */

const cache = new Map<string, string>();

export const getToken = (name: string, fallback: string = ''): string => {
  if (cache.has(name)) return cache.get(name) as string;
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const resolved = value || fallback;
  if (resolved) cache.set(name, resolved);
  return resolved;
};

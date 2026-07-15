// Link-secret lifecycle: generation, constant-time comparison, masking.
// Spec §4 (SecureStorage `link_secret`), §6.3 (compare), §9 (mask/rotate).

import crypto from 'node:crypto';

/**
 * Generate a new link secret: 32 random bytes, base64url-encoded (43 chars,
 * alphabet [A-Za-z0-9_-], no padding).
 * @returns {string}
 */
export function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Constant-time equality between the `k` query param and the stored secret.
 * Both inputs are sha256-hashed first (equalizes length), then compared with
 * crypto.timingSafeEqual — never a raw string compare.
 * Returns false (never throws) when either side is missing, empty, or not a
 * string.
 * @param {unknown} provided - the `k` value from the request
 * @param {unknown} actual - the stored link secret
 * @returns {boolean}
 */
export function secretEquals(provided, actual) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (typeof actual !== 'string' || actual.length === 0) return false;
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const actualHash = crypto.createHash('sha256').update(actual).digest();
  return crypto.timingSafeEqual(providedHash, actualHash);
}

/**
 * Mask a secret for display: '****' + last 4 chars (spec §9 GET /api/state).
 * Returns null for a missing/empty/non-string secret.
 * @param {unknown} secret
 * @returns {string|null}
 */
export function maskSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return null;
  return `****${secret.slice(-4)}`;
}

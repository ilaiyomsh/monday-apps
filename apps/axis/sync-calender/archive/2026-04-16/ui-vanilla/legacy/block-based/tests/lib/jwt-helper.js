import jwt from 'jsonwebtoken';

/**
 * Build an outer JWT exactly like monday sends when invoking an action block.
 *
 * The server's authenticationMiddleware verifies this with MONDAY_SIGNING_SECRET,
 * extracts `shortLivedToken`, and passes it through as the Authorization header
 * to monday's GraphQL API. We pass the user's personal monday API token as
 * `shortLivedToken` so the downstream API calls (create_item, …) actually succeed
 * against the real monday account.
 *
 * @param {Object} params
 * @param {string} params.signingSecret   MONDAY_SIGNING_SECRET
 * @param {string} params.shortLivedToken the user's monday API token (long-lived is fine)
 * @param {number} params.accountId
 * @param {number} params.userId
 * @param {number} params.appId
 * @param {string} params.audUrl          e.g. https://live1-.../actions/sync-events
 */
export function signActionJwt({ signingSecret, shortLivedToken, accountId, userId, appId, audUrl }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      accountId,
      userId,
      platformAppId: appId,
      aud: audUrl,
      exp: now + 300,
      shortLivedToken,
      iat: now,
    },
    signingSecret,
    { algorithm: 'HS256' }
  );
}

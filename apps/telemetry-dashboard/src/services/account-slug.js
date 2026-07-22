// Account-slug resolver (#145) — the ONE enrichment API call the lifecycle
// pipeline makes: `me { account { id slug } }`, fetched ONCE (cached), used
// to build clickable instance URLs (`https://<slug>.monday.com/boards/<id>`).
//
// Owner decision (2026-07-22): NO user name/email lookup — feature events
// keep ids only; install/subscription events already carry identity fields
// natively in their payload.
//
// OWNER-ACCOUNT GATE: the OAuth token sees only the owner's account, so a
// foreign accountId resolves to '' — never guess cross-account URLs.
// Fail-soft: any API failure resolves '' and retries on a later event
// (failure is NOT cached permanently — only for the in-flight call).
//
// All collaborators are injected — this module imports nothing.

const TAG = 'account_slug';

/**
 * @param {object} deps
 * @param {{ fetchMe: () => Promise<{ accountId: string|null, accountSlug: string|null }> }} deps.mondayApi
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {{ getSlug: (accountId: string) => Promise<string> }}
 */
export function createAccountSlugResolver({ mondayApi, logger }) {
  /** @type {{ accountId: string, accountSlug: string } | null} */
  let owner = null;
  /** @type {Promise<void>|null} single-flight fetch gate */
  let inFlight = null;

  async function loadOwner() {
    try {
      const me = await mondayApi.fetchMe();
      if (me && me.accountId != null && typeof me.accountSlug === 'string' && me.accountSlug) {
        owner = { accountId: String(me.accountId), accountSlug: me.accountSlug };
      }
    } catch (err) {
      // Fail-soft: no slug this time; a later event retries (owner stays null).
      logger.warn('account_slug_fetch_failed', TAG, { error: String(err?.message ?? err) });
    }
  }

  return {
    /** '' when unknown, foreign, or the lookup failed. Never throws. */
    async getSlug(accountId) {
      if (!owner) {
        if (!inFlight) {
          inFlight = loadOwner().finally(() => {
            inFlight = null;
          });
        }
        await inFlight;
      }
      if (!owner) return '';
      return String(accountId ?? '') === owner.accountId ? owner.accountSlug : '';
    },
  };
}

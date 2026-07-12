// Registers the dev-harness stub's api() handlers with REAL captured monday
// API responses (never hand-built mocks) — see ./probes/MANIFEST.md for the
// probe → operation → query/variables mapping and the seeded board/team/user
// ids these captures were taken against.
//
// Each probes/*.json file is the FULL monday API response envelope as
// captured (`{ data: {...} }`, sometimes with `extensions`). The dev-harness
// stub's apiHandlers entries only carry the inner `data` payload (the stub
// wraps it back into `{ data, account_id }` itself — see
// src/dev-harness/monday-sdk-stub.js `api()`), so this module unwraps `.data`
// from each capture before registering it.
//
// Matching is by operation-name SUBSTRING against the outgoing query text
// (dev-harness stub's `resolveApi`), matching the exact operation names used
// in src/services/graphqlQueries.js (GetColumnValue, GetLinkedItemsPeople,
// GetTeamsMembers, GetUsersDetails, GetBoardColumns, UpdateColumnValue).

import getColumnValueCapture from './probes/GetColumnValue.json';
import getLinkedItemsPeopleCapture from './probes/GetLinkedItemsPeople.json';
import getTeamsMembersCapture from './probes/GetTeamsMembers.json';
import getUsersDetailsCapture from './probes/GetUsersDetails.json';
import getBoardColumnsCapture from './probes/GetBoardColumns.json';
import updateColumnValueCapture from './probes/UpdateColumnValue.json';

// operation name -> captured envelope (as read from probes/*.json).
const DEFAULT_CAPTURES = {
  GetColumnValue: getColumnValueCapture,
  GetLinkedItemsPeople: getLinkedItemsPeopleCapture,
  GetTeamsMembers: getTeamsMembersCapture,
  GetUsersDetails: getUsersDetailsCapture,
  GetBoardColumns: getBoardColumnsCapture,
  UpdateColumnValue: updateColumnValueCapture,
};

/**
 * Register the app's GraphQL fixtures on the dev-harness stub, keyed by
 * operation-name substring, each serving the corresponding captured probe
 * response (see MANIFEST.md).
 *
 * @param {Object} harness - the dev-harness stub's exported `harness` object
 *   (src/dev-harness/monday-sdk-stub.js), the SAME instance the app's
 *   `monday-sdk-js` import resolves to when VITE_MONDAY_MOCK is set / under
 *   vitest.
 * @param {Object} [overrides] - per-operation-name override, e.g.
 *   `{ GetTeamsMembers: { errors: [...] } }` or
 *   `{ GetColumnValue: { data: customPayload } }` or `{ GetX: { fn } }`.
 *   A provided override REPLACES that single handler entirely (data/errors/fn
 *   shape — see the stub's apiHandlers contract) instead of merging with the
 *   captured default; operation names not in the default set may also be
 *   registered this way.
 */
export function installAppApiHandlers(harness, overrides = {}) {
  const opNames = new Set([...Object.keys(DEFAULT_CAPTURES), ...Object.keys(overrides)]);

  opNames.forEach((opName) => {
    const override = overrides[opName];
    if (override) {
      harness.apiHandlers.push({ match: opName, ...override });
      return;
    }
    const capture = DEFAULT_CAPTURES[opName];
    harness.apiHandlers.push({ match: opName, data: capture.data });
  });
}

export default installAppApiHandlers;

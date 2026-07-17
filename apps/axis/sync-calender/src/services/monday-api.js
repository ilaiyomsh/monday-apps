import logger from './logger.js';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const TAG = 'monday_api';

function operationName(query) {
  const m = query.match(/\b(?:query|mutation)\s+(\w+)/);
  return m ? m[1] : 'UnknownOp';
}

// Coarse latency buckets (D5) so repeated monday_api_latency health signals stay
// low-cardinality per op instead of a distinct message per call (mondayQuery is
// the data-layer funnel). Mirrors the tpc bucket helper.
function latencyBucket(ms) {
  if (ms < 200) return 'fast';
  if (ms < 1000) return 'ok';
  if (ms < 3000) return 'slow';
  return 'very_slow';
}

export async function mondayQuery(token, query, variables = {}) {
  const op = operationName(query);
  logger.debug('api request', TAG, { op, variables });

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': '2026-04',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (netErr) {
    // Network/transport failure (no HTTP status) — record latency health + rethrow.
    logger.health('monday_api_latency', { op, status: 'network_error', bucket: latencyBucket(Date.now() - t0), ok: false });
    throw netErr;
  }

  const response = await res.json();

  // API-latency health (D5): bucketed so it stays cheap on this hot funnel;
  // ships as kind='health' (inert until the Axiom sink is active).
  const ok = !response.errors;
  logger.health('monday_api_latency', { op, status: res.status, bucket: latencyBucket(Date.now() - t0), ok });

  if (response.errors) {
    // Surface the most actionable bits without dumping the full error array.
    const first = response.errors[0] || {};
    const code = first.extensions?.code || null;
    const reason = first.extensions?.error_data?.error_reason || null;
    const columnId = first.extensions?.error_data?.column_id || null;
    logger.error('api error', TAG, {
      op, status: res.status, code, reason, columnId, msg: first.message,
    });
    const err = new Error(JSON.stringify(response.errors));
    err.code = code;
    err.invalidColumnId = columnId;
    throw err;
  }

  logger.debug('api response', TAG, { op, status: res.status });

  return response.data;
}

// Search for an item by the value in a specific column (used to find items by event URL in link column).
// For link columns, items_page_by_column_values matches against the link's display text.
// We write text=url when creating (see buildColumnValues), so the exact URL is the display text here.
//
// extraColumnIds: optional list of column ids whose values to fetch alongside
// the lookup (e.g. the sync-lock checkbox). Returned in `columnValues` keyed by
// column id; values are the parsed `value` JSON (or null when unset on the row).
// Returns { id, columnValues } | null. Callers that don't need extras can read
// only `.id` — `columnValues` is `{}` when no extras were requested.
export async function findItemByColumnValue(token, { boardId, columnId, value, extraColumnIds }) {
  const ids = Array.isArray(extraColumnIds) ? extraColumnIds.filter(Boolean) : [];
  const extrasFragment = ids.length > 0
    ? `column_values(ids: $extraIds) { id value }`
    : '';
  const extraVarDecl = ids.length > 0 ? ', $extraIds: [String!]' : '';
  const query = `
    query FindItem($boardId: ID!, $columnId: String!, $value: String!${extraVarDecl}) {
      items_page_by_column_values(
        board_id: $boardId,
        columns: [{ column_id: $columnId, column_values: [$value] }],
        limit: 1
      ) {
        items {
          id
          ${extrasFragment}
        }
      }
    }
  `;

  const variables = { boardId, columnId, value };
  if (ids.length > 0) variables.extraIds = ids;
  const data = await mondayQuery(token, query, variables);
  const items = data.items_page_by_column_values?.items || [];
  if (items.length === 0) return null;
  const item = items[0];
  const columnValues = {};
  for (const cv of item.column_values || []) {
    let parsed = null;
    if (cv.value != null) {
      try { parsed = JSON.parse(cv.value); } catch { parsed = cv.value; }
    }
    columnValues[cv.id] = parsed;
  }
  return { id: item.id, columnValues };
}

// Substring search using boards.items_page + query_params/contains_text.
// Used as a fallback when the exact-match lookup fails — specifically for
// Microsoft Graph delta tombstones, which carry only the event ID (no
// webLink), so we search for the URL-encoded ID embedded in the previously
// stored webLink.
//
// items_page is a field on Board, not on the root Query — it must be
// reached via boards(ids: …) { items_page(…) }.
//
// extraColumnIds: same contract as findItemByColumnValue — the lookup also
// returns the values of those columns on the matched row so callers don't
// need a second round-trip. Return shape mirrors findItemByColumnValue.
export async function findItemByColumnContains(token, { boardId, columnId, value, extraColumnIds }) {
  const ids = Array.isArray(extraColumnIds) ? extraColumnIds.filter(Boolean) : [];
  const extrasFragment = ids.length > 0
    ? `column_values(ids: $extraIds) { id value }`
    : '';
  const extraVarDecl = ids.length > 0 ? ', $extraIds: [String!]' : '';
  const query = `
    query FindItemContains($boardId: ID!, $columnId: ID!, $value: CompareValue!${extraVarDecl}) {
      boards(ids: [$boardId]) {
        items_page(
          limit: 1,
          query_params: {
            rules: [{ column_id: $columnId, compare_value: $value, operator: contains_text }]
          }
        ) {
          items { id ${extrasFragment} }
        }
      }
    }
  `;

  const variables = { boardId, columnId, value: [value] };
  if (ids.length > 0) variables.extraIds = ids;
  const data = await mondayQuery(token, query, variables);
  const items = data.boards?.[0]?.items_page?.items || [];
  if (items.length === 0) return null;
  const item = items[0];
  const columnValues = {};
  for (const cv of item.column_values || []) {
    let parsed = null;
    if (cv.value != null) {
      try { parsed = JSON.parse(cv.value); } catch { parsed = cv.value; }
    }
    columnValues[cv.id] = parsed;
  }
  return { id: item.id, columnValues };
}

export async function createItem(token, { boardId, itemName, columnValues }) {
  const query = `
    mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `;

  logger.debug('create item', TAG, { boardId, itemName });

  const data = await mondayQuery(token, query, {
    boardId,
    itemName,
    columnValues: JSON.stringify(columnValues),
  });

  return data.create_item.id;
}

export async function updateItem(token, { boardId, itemId, columnValues }) {
  const query = `
    mutation UpdateItem($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
        id
      }
    }
  `;

  logger.debug('update item', TAG, { boardId, itemId });

  const data = await mondayQuery(token, query, {
    boardId,
    itemId,
    columnValues: JSON.stringify(columnValues),
  });

  return data.change_multiple_column_values.id;
}

// Rename an existing item. `change_multiple_column_values` only touches
// column values — item name lives on the item record itself and needs a
// dedicated mutation (otherwise renaming an event in Google leaves the old
// title on the board item).
export async function changeItemName(token, { boardId, itemId, newName }) {
  const query = `
    mutation RenameItem($boardId: ID!, $itemId: ID!, $newName: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $newName) {
        id
      }
    }
  `;
  logger.debug('rename item', TAG, { boardId, itemId });
  const data = await mondayQuery(token, query, { boardId, itemId, newName });
  return data.change_simple_column_value.id;
}

// Fetch status-column label tables for a single board. Returns
//   Map<columnId, { id, index, label }[]>
// used by the status-id migration to translate position→label-id on
// existing policies and conditionals. Columns of other types are dropped.
export async function getStatusColumnLabels(token, boardId, columnIds) {
  const ids = (columnIds || []).filter(Boolean).map(String);
  if (ids.length === 0) return new Map();
  const query = `
    query StatusColumnLabels($boardId: ID!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        columns(ids: $columnIds) {
          id
          type
          settings_str
        }
      }
    }
  `;
  const data = await mondayQuery(token, query, { boardId: String(boardId), columnIds: ids });
  const board = data.boards?.[0];
  const out = new Map();
  if (!board?.columns) return out;
  for (const col of board.columns) {
    if (col.type !== 'status') continue;
    let parsed;
    try { parsed = JSON.parse(col.settings_str || '{}'); } catch { parsed = null; }
    const labels = Array.isArray(parsed?.labels) ? parsed.labels : [];
    const norm = labels
      .map((l) => ({
        id: Number(l.id),
        index: Number(l.index),
        label: typeof l.label === 'string' ? l.label : '',
      }))
      .filter((l) => Number.isInteger(l.id) && Number.isInteger(l.index));
    out.set(String(col.id), norm);
  }
  return out;
}

// Fetch the list of owner user IDs for a board. Custom Objects are boards in
// monday's schema (BoardObjectType.custom_object), so the same query works for
// objectId. Returns string[] of user IDs; empty array if the board is not
// visible to the token holder.
export async function getBoardOwnerIds(token, boardId) {
  const query = `
    query BoardOwners($ids: [ID!]) {
      boards(ids: $ids) {
        id
        owners { id }
      }
    }
  `;
  const data = await mondayQuery(token, query, { ids: [String(boardId)] });
  const board = data.boards?.[0];
  if (!board) return [];
  return (board.owners || []).map((o) => String(o.id));
}

// IANA time zone identifier for the authenticated monday user (e.g.
// "Asia/Jerusalem"). We use this to decide whether a Google event crosses a
// local-day boundary and should therefore be skipped. Returns null if the
// field is absent so callers can fall through without erroring.
export async function fetchMondayUserTimeZone(token) {
  const query = `query Me { me { time_zone_identifier } }`;
  const data = await mondayQuery(token, query);
  return data?.me?.time_zone_identifier || null;
}

// Fetch the authenticated monday identity in one call: user name + email +
// time-zone, and the parent account's id/name/slug. Saved on the config at
// OAuth time (and lazily by the debug endpoint for older configs) so logs
// and debug responses can show "ido@twyst.co.il @ yomsheni-dev.monday.com"
// without re-querying the API on every read.
export async function fetchMondayIdentity(token) {
  const query = `
    query Me {
      me { id name email time_zone_identifier
        account { id name slug }
      }
    }
  `;
  const data = await mondayQuery(token, query);
  const me = data?.me || {};
  const account = me.account || {};
  return {
    userId: me.id ?? null,
    userName: me.name ?? null,
    userEmail: me.email ?? null,
    timeZone: me.time_zone_identifier ?? null,
    accountId: account.id ?? null,
    accountName: account.name ?? null,
    accountSlug: account.slug ?? null,
  };
}

// Resolve a list of monday user ids to {id, name, email} entries. Used by the
// debug endpoint to fill in instance owner identity when the owner has no
// connected config of their own. Returns a map keyed by id (string).
export async function fetchMondayUsers(token, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return {};
  const query = `query Users($ids: [ID!]) { users(ids: $ids) { id name email } }`;
  const data = await mondayQuery(token, query, { ids: ids.map(String) });
  const out = {};
  for (const u of data?.users || []) {
    if (u?.id != null) out[String(u.id)] = { id: u.id, name: u.name ?? null, email: u.email ?? null };
  }
  return out;
}

// Send an in-app notification to `userId`. `targetId` is what the notification
// click navigates to — we pass the Custom Object instance id (objectId), which
// monday accepts as a `Project` target and deep-links to /custom_objects/<id>
// (the admin app), so the recipient lands where they can act (reconnect),
// not on the synced board.
export async function sendNotification(token, { userId, targetId, text }) {
  const query = `
    mutation Notify($userId: ID!, $targetId: ID!, $text: String!) {
      create_notification(user_id: $userId, target_id: $targetId, target_type: Project, text: $text) {
        text
      }
    }
  `;
  await mondayQuery(token, query, { userId: String(userId), targetId: String(targetId), text });
}

export async function deleteItem(token, itemId) {
  const query = `
    mutation DeleteItem($itemId: ID!) {
      delete_item(item_id: $itemId) {
        id
      }
    }
  `;

  logger.debug('delete item', TAG, { itemId });

  const data = await mondayQuery(token, query, { itemId });
  return data.delete_item.id;
}


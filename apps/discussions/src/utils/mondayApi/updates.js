/*
 * monday item "updates" (the posts feed) — backing store for the discussion
 * Summary tab.
 *
 * The summary is a SINGLE editable post on the discussion item:
 *   create_update(item_id, body) -> Update    (first save; body is HTML)
 *   edit_update(id, body)        -> Update!    (later saves; rewrite in place)
 *   delete_update(id)            -> Update     (kept for completeness)
 * Reads come back via items(ids){ updates(ids:) }.
 *
 * monday officially guarantees only <b>/<i>/<br> in `body` and strips unknown
 * tags server-side — see utils/summaryHtml.js for the tag subset we send.
 *
 * Every call goes through api() so assertNoGraphQLErrors runs (safeApi alone
 * does NOT throw on GraphQL soft-errors). create_update returns a NULLABLE
 * Update, so callers must handle null.
 */
import { api } from './monday-client.js';

const UPDATE_FIELDS = `id body text_body created_at updated_at creator { id name }`;

/** Create a new update (post) on an item. Returns the created Update or null. */
export async function createUpdate(itemId, body) {
  const data = await api(
    `mutation ($itemId: ID!, $body: String!) {
       create_update(item_id: $itemId, body: $body) { ${UPDATE_FIELDS} }
     }`,
    { itemId: String(itemId), body: String(body ?? '') },
    'createUpdate'
  );
  return data?.create_update ?? null;
}

/** Rewrite an existing update's body in place. Returns the Update or null. */
export async function editUpdate(updateId, body) {
  const data = await api(
    `mutation ($id: ID!, $body: String!) {
       edit_update(id: $id, body: $body) { ${UPDATE_FIELDS} }
     }`,
    { id: String(updateId), body: String(body ?? '') },
    'editUpdate'
  );
  return data?.edit_update ?? null;
}

/** Fetch one update of an item by its id (to repopulate the editor). */
export async function getItemUpdate(itemId, updateId) {
  const data = await api(
    `query ($itemIds: [ID!], $updateIds: [ID!]) {
       items(ids: $itemIds) {
         id
         updates(ids: $updateIds, limit: 1) { ${UPDATE_FIELDS} }
       }
     }`,
    { itemIds: [String(itemId)], updateIds: [String(updateId)] },
    'getItemUpdate'
  );
  return data?.items?.[0]?.updates?.[0] ?? null;
}

/** Delete an update by id. Returns the deleted Update or null. */
export async function deleteUpdate(updateId) {
  const data = await api(
    `mutation ($id: ID!) { delete_update(id: $id) { id } }`,
    { id: String(updateId) },
    'deleteUpdate'
  );
  return data?.delete_update ?? null;
}

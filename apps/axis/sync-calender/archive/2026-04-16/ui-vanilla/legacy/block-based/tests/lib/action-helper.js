import { signActionJwt } from './jwt-helper.js';
import { postJson, waitFor } from './http.js';
import { findItemsByName } from './monday-query.js';

// Invoke the deployed /actions/sync-events endpoint with a signed JWT wrapping
// the user's monday API token as shortLivedToken. Mirrors what monday sends.
export async function invokeAction({ cfg, inboundFieldValues }) {
  const audUrl = `${cfg.appUrl}/actions/sync-events`;
  const token = signActionJwt({
    signingSecret: cfg.signingSecret,
    shortLivedToken: cfg.mondayApiToken,
    accountId: cfg.accountId,
    userId: cfg.userId,
    appId: cfg.appId,
    audUrl,
  });
  const body = {
    payload: {
      blockKind: 'action',
      credentialsValues: {
        google_credentials: {
          userCredentialsId: 0,
          accessToken: 'test-dummy-access-token',
          userCredentialsParams: {},
          tokenRequestedParams: {},
        },
      },
      inboundFieldValues,
      inputFields: {},
      recipeId: 0,
      integrationId: 0,
    },
    runtimeMetadata: {
      actionUuid: `test-action-${Date.now()}`,
      triggerUuid: `test-trigger-${Date.now()}`,
    },
  };
  return postJson(audUrl, body, { Authorization: token });
}

// Default inbound-field-values shape. Scenarios override specific fields.
export function buildInbound({ cfg, eventId, eventStatus = 'confirmed', itemName, item = {} }) {
  return {
    channelId: cfg.channelId,
    boardId: cfg.boardId,
    linkColumnId: cfg.linkColumnId,
    itemName,
    item,
    eventId,
    eventStatus,
  };
}

// Poll monday until one or more items named `name` appear on the board, or
// until the timeout elapses. Returns the items array (possibly empty).
export async function waitForItemByName({ token, boardId, name, timeoutMs = 8000 }) {
  const found = await waitFor(async () => {
    const items = await findItemsByName({ token, boardId, name });
    return items.length > 0 ? items : null;
  }, { timeoutMs, intervalMs: 500 });
  return found || [];
}

// Poll until no items with `name` exist. Returns true if the item disappeared,
// false on timeout.
export async function waitForItemGone({ token, boardId, name, timeoutMs = 8000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = await findItemsByName({ token, boardId, name });
    if (items.length === 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Extract a specific column value from a monday item fetched via findItemsByName.
export function getColumn(item, columnId) {
  return item?.column_values?.find((c) => c.id === columnId);
}

export function parseColumnValue(col) {
  if (!col?.value) return null;
  try { return JSON.parse(col.value); } catch { return col.value; }
}

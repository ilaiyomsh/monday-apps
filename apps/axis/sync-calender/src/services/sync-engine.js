// Sync engine for the Custom Object path. One-way only: external calendar
// (Google or Microsoft) → monday. Called by:
//   - routes/webhook-config.js on Google push notifications
//   - routes/webhook-microsoft.js on Microsoft Graph notifications (Phase 2)
//   - routes/configs.js on POST /api/configs/:configId/force-sync
//
// Operates on CanonicalEvents only — provider-specific shape is confined to
// src/services/providers/<name>/. To add a provider, register it in
// src/services/provider.js and ensure its listChanges/mapEventToCanonical
// produce the canonical shape (see src/services/providers/canonical-event.js).
//
// Never reads monday item state to diff/merge. Mapped columns on an existing
// item are overwritten with the current calendar values. Unmapped columns
// are left untouched.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { getProvider } from './provider.js';
import { STATUS, RESPONSE } from './providers/canonical-event.js';
import {
  findItemByColumnValue,
  findItemByColumnContains,
  createItem,
  updateItem,
  changeItemName,
  deleteItem,
  fetchMondayUserTimeZone,
} from './monday-api.js';
import { mapEventToColumns, renderColumnValue, resolveSourceAsString } from '../helpers/columns.js';
import { crossesLocalDayBoundary } from '../helpers/date-boundary.js';
import { evaluateConditionals, matchSkip, buildEventContext } from './conditional-evaluator.js';
import logger from './logger.js';
import { buildSyncCtx, buildEventCtx, buildErrorCtx } from '../helpers/log-context.js';

const TAG = 'sync';

// Pull the structured monday-api error out of a thrown Error. monday-api
// stringifies the raw `errors` array into `err.message`, so we re-parse to
// surface `extensions.code` + the human-readable `message` + any column id
// from `error_data`. Falls back to `err.code` / `err.invalidColumnId` which
// monday-api already promotes to top-level fields.
function extractMondayError(err) {
  const raw = err?.message || '';
  let mondayMsg = null;
  if (raw.startsWith('[{')) {
    try {
      const parsed = JSON.parse(raw);
      const first = Array.isArray(parsed) ? parsed[0] : null;
      if (first) mondayMsg = first.message || null;
    } catch { /* fall through */ }
  }
  return {
    code: err?.code || null,
    msg: mondayMsg || raw.slice(0, 200),
    columnId: err?.invalidColumnId || null,
  };
}

// Reduce a thrown error to a single-line cause for the sync log.
function extractCause(err) {
  const { code, msg } = extractMondayError(err);
  if (code) return `${code}: ${(msg || '').slice(0, 140)}`;
  return (msg || '').slice(0, 160);
}

// Decide what to do with one canonical event. Both providers share the same
// RSVP semantics when reading canonical fields, so this lives here rather than
// per-provider — no point dispatching for an identical implementation.
function shouldSyncCanonical(event) {
  if (!event) return false;
  if (event.status === STATUS.CANCELLED) return false;
  if (event.isAllDay) return false;
  if (!event.attendees?.length) return true;
  return event.selfResponse === RESPONSE.ACCEPTED;
}

export function classifyEvent(event) {
  const willSync = shouldSyncCanonical(event);
  const isCancelled = event?.status === STATUS.CANCELLED;
  const selfDeclined = event?.selfResponse === RESPONSE.DECLINED;

  if (!willSync && !isCancelled && !selfDeclined) {
    // Reason fed back to the loop so each skip emits a debuggable log line.
    let reason = 'unknown';
    if (event?.isAllDay) reason = 'all_day';
    else if (event?.attendees?.length && event?.selfResponse !== RESPONSE.ACCEPTED) reason = 'not_accepted';
    return { action: 'skip', reason };
  }
  if (isCancelled || selfDeclined) return { action: 'delete' };
  return { action: 'upsert' };
}

// Return the column values from the first-matching Conditional. Callers track
// match/no-match counts on the run-level `counts` object and surface a single
// aggregated `conditionals_*` field on `sync_done` rather than per-event lines.
function computeConditionalOverrides({ event, policy, config, counts }) {
  const conditionals = Array.isArray(config?.conditionals) ? config.conditionals : [];
  if (conditionals.length === 0) return {};

  const overrideRules = conditionals.filter((c) => c?.action !== 'skip');
  if (overrideRules.length === 0) return {};

  const eligible = new Set(
    Array.isArray(policy?.conditionalEligibleColumns) ? policy.conditionalEligibleColumns : []
  );

  const ctx = buildEventContext(event);
  const match = evaluateConditionals(conditionals, ctx);

  if (counts) counts.conditionals_evaluated = (counts.conditionals_evaluated || 0) + 1;
  if (!match) return {};

  const overrides = {};
  for (const [columnId, value] of Object.entries(match.values || {})) {
    if (!eligible.has(columnId)) continue;
    const rendered = renderColumnValue(value, event);
    if (rendered === undefined) continue;
    overrides[columnId] = rendered;
  }
  if (counts) counts.conditionals_matched = (counts.conditionals_matched || 0) + 1;
  return overrides;
}

// Apply conditional overrides in a single change_multiple_column_values call,
// separate from the base item create/update so a failure doesn't take down
// the item itself. Logs and swallows errors — the base item is already
// correct on the board.
async function applyConditionalOverridesSafely(token, { boardId, itemId, overrides, ctx, event, config }) {
  if (!overrides || Object.keys(overrides).length === 0) return;
  try {
    await updateItem(token, { boardId, itemId, columnValues: overrides });
  } catch (err) {
    logger.error('error', TAG, {
      ...ctx,
      ...buildEventCtx(event, { itemId }),
      ...buildErrorCtx(config, event),
      stage: 'conditional_overrides',
      cause: err.message,
    });
  }
}

function matchedSkipRule({ event, config }) {
  const conditionals = Array.isArray(config?.conditionals) ? config.conditionals : [];
  if (conditionals.length === 0) return null;
  const ctx = buildEventContext(event);
  return matchSkip(conditionals, ctx);
}

function isLockChecked(columnValues, lockColumnId) {
  if (!columnValues || !lockColumnId) return false;
  const cv = columnValues[lockColumnId];
  if (!cv || typeof cv !== 'object') return false;
  return cv.checked === 'true' || cv.checked === true;
}

// applyEvent emits its own per-event log line so the caller (sync-engine /
// backfill loop) just needs to track outcome counts. Returns the outcome
// string for backwards compatibility with backfill's switch.
export async function applyEvent({ event, action, policy, config, token, provider, staleColumnIds, ctx, counts }) {
  const logCtx = ctx || buildSyncCtx(config);
  const emit = (op, itemId, extras) => logger.info(op, TAG, {
    ...logCtx, ...buildEventCtx(event, { itemId }), ...(extras || {}),
  });

  if (action === 'upsert' && matchedSkipRule({ event, config })) {
    emit('skipped', null, { reason: 'user_rule' });
    return 'skipped_rule';
  }

  const eventLink = event?.externalUrl || '';
  const lockExtras = policy.lockColumnId ? [policy.lockColumnId] : [];
  let existingLookup = eventLink
    ? await findItemByColumnValue(token, {
        boardId: policy.boardId,
        columnId: policy.linkColumnId,
        value: eventLink,
        extraColumnIds: lockExtras,
      })
    : null;
  let existingItemId = existingLookup?.id || null;

  // Google delete fallback (recurring instance cancellations have no htmlLink).
  if (!existingItemId && action === 'delete' && !eventLink &&
      provider?.name === 'google' &&
      typeof provider.buildEventUrl === 'function' &&
      event?.id && config?.googleUserEmail) {
    const reconstructed = provider.buildEventUrl(event.id, config.googleUserEmail);
    if (reconstructed) {
      existingLookup = await findItemByColumnValue(token, {
        boardId: policy.boardId,
        columnId: policy.linkColumnId,
        value: reconstructed,
        extraColumnIds: lockExtras,
      });
      existingItemId = existingLookup?.id || null;
    }
  }

  // Microsoft delete fallback (tombstones with no webLink).
  if (!existingItemId && action === 'delete' &&
      provider?.name === 'microsoft' && event?.id) {
    const base64 = event.id.replace(/-/g, '/').replace(/_/g, '+');
    const idNeedle = encodeURIComponent(base64);
    existingLookup = await findItemByColumnContains(token, {
      boardId: policy.boardId,
      columnId: policy.linkColumnId,
      value: idNeedle,
      extraColumnIds: lockExtras,
    });
    existingItemId = existingLookup?.id || null;
  }

  if (existingItemId && policy.lockColumnId) {
    const locked = !isLockChecked(existingLookup?.columnValues, policy.lockColumnId);
    if (locked) {
      emit('skipped', existingItemId, { reason: 'locked' });
      return 'skipped_locked';
    }
  }

  // Past-event guard: don't create items for events that have already ended.
  // Applies only when there is no existing item — updates and deletes always
  // flow through (editing a past meeting that already has an item still
  // propagates; cancellations still delete).
  if (action === 'upsert' && !existingItemId) {
    const endIso = event?.end?.dateTime;
    if (endIso && new Date(endIso).getTime() <= Date.now()) {
      emit('skipped', null, { reason: 'past_event' });
      return 'skipped_past';
    }
  }

  if (action === 'delete') {
    if (existingItemId) {
      await deleteItem(token, existingItemId);
      emit('deleted', existingItemId);
      return 'deleted';
    }
    emit('skipped', null, { reason: 'missing_item' });
    return 'skipped_missing';
  }

  // action === 'upsert'
  const itemNameSource = policy?.itemNameSource || 'eventName';
  const itemName = resolveSourceAsString(event, itemNameSource) || 'Calendar Event';
  const baseColumnValues = mapEventToColumns(event, policy, config.mondayUserId || config.userId);
  const conditionalOverrides = computeConditionalOverrides({ event, policy, config, counts });

  // Auto-recover from InvalidColumnIdException: strip the offending column
  // and retry. A policy can reference multiple stale columns at once, so loop
  // until we succeed or hit the cap. Stripped column ids feed back into the
  // run-level Set so runSyncForConfig can prune the persisted policy.
  const MAX_STRIP_RETRIES = 5;
  async function applyWithRetry(fn, initialCols = baseColumnValues) {
    let cols = { ...initialCols };
    for (let attempt = 0; attempt <= MAX_STRIP_RETRIES; attempt++) {
      try {
        return await fn(cols);
      } catch (err) {
        const stale =
          err.code === 'InvalidColumnIdException' &&
          err.invalidColumnId &&
          cols[err.invalidColumnId];
        if (!stale || attempt === MAX_STRIP_RETRIES) throw err;
        logger.warn('column_stripped', TAG, {
          ...logCtx,
          ...buildEventCtx(event),
          column: err.invalidColumnId,
          attempt: attempt + 1,
        });
        delete cols[err.invalidColumnId];
        if (staleColumnIds) staleColumnIds.add(err.invalidColumnId);
        if (policy?.columnMapping) delete policy.columnMapping[err.invalidColumnId];
      }
    }
  }

  if (existingItemId) {
    await applyWithRetry((cols) =>
      updateItem(token, { boardId: policy.boardId, itemId: existingItemId, columnValues: cols })
    );
    await changeItemName(token, { boardId: policy.boardId, itemId: existingItemId, newName: itemName });
    await applyConditionalOverridesSafely(token, {
      boardId: policy.boardId,
      itemId: existingItemId,
      overrides: conditionalOverrides,
      ctx: logCtx,
      event,
      config,
    });
    emit('updated', existingItemId);
    return 'updated';
  }

  // New rows are auto-checked on the sync-lock column. The owner picked it in
  // Setup; uncheck on monday is the user's "detach this row" signal.
  const createColumnValues = policy.lockColumnId
    ? { ...baseColumnValues, [policy.lockColumnId]: { checked: 'true' } }
    : baseColumnValues;
  const newItemId = await applyWithRetry(
    (cols) => createItem(token, { boardId: policy.boardId, itemName, columnValues: cols }),
    createColumnValues,
  );
  await applyConditionalOverridesSafely(token, {
    boardId: policy.boardId,
    itemId: newItemId,
    overrides: conditionalOverrides,
    ctx: logCtx,
    event,
    config,
  });
  emit('created', newItemId);
  return 'created';
}

export async function runSyncForConfig({ config, policy, trigger }) {
  if (!policy) throw new Error('policy_missing');
  if (!policy.boardId || !policy.linkColumnId || !policy.lockColumnId) throw new Error('policy_not_configured');
  if (!config.mondayAccessToken) throw new Error('monday_access_token_missing');

  const t0 = Date.now();
  const provider = getProvider(config);
  const ctx = buildSyncCtx(config);

  policy = { ...policy, columnMapping: { ...(policy.columnMapping || {}) } };
  const staleColumnIds = new Set();

  // Register (or renew) the provider's push subscription. Idempotent.
  try {
    await provider.ensureSubscription(config);
    const refreshed = await syncConfigStorage.getSyncConfig(config.configId);
    if (refreshed) config = refreshed;
  } catch (err) {
    logger.warn('subscription_failed', TAG, {
      ...ctx, error: err.message,
    });
  }

  // Wrap listChanges so the outer catch sees a stage-tagged error with the
  // Graph/REST response body attached — otherwise we only get err.message,
  // which for Microsoft Graph 400s is just "Provided input is invalid".
  async function listChangesTagged() {
    try {
      return await provider.listChanges(config);
    } catch (err) {
      err.stage = 'provider_list_changes';
      if (err.status === 400 && typeof err.body === 'string') {
        logger.error('error', TAG, {
          ...ctx,
          stage: 'provider_list_changes',
          prv: provider.name,
          status: err.status,
          body: err.body.slice(0, 500),
        });
      }
      throw err;
    }
  }

  let { events, nextSyncState, syncTokenExpired } = await listChangesTagged();

  if (syncTokenExpired) {
    logger.warn('sync_token_reset', TAG, ctx);
    await provider.resetSyncState(config.configId);
    config = (await syncConfigStorage.getSyncConfig(config.configId)) || config;
    ({ events, nextSyncState } = await listChangesTagged());
  }

  // Lazy-fetch monday user TZ for old configs created before we captured it.
  if (!config.mondayTimeZone) {
    try {
      const tz = await fetchMondayUserTimeZone(config.mondayAccessToken);
      if (tz) {
        await syncConfigStorage.updateSyncConfig(config.configId, { mondayTimeZone: tz });
        config = { ...config, mondayTimeZone: tz };
      }
    } catch (err) {
      logger.warn('tz_fetch_failed', TAG, { ...ctx, error: err.message });
    }
  }
  const tz = config.mondayTimeZone || null;

  const counts = { total: events.length, skipped: 0, created: 0, updated: 0, deleted: 0, skipped_missing: 0, skipped_rule: 0, skipped_cross_day: 0, skipped_locked: 0, skipped_past: 0 };

  for (const event of events) {
    const { action, reason } = classifyEvent(event);
    if (action === 'skip') {
      counts.skipped++;
      logger.info('skipped', TAG, { ...ctx, ...buildEventCtx(event), reason });
      continue;
    }

    if (action === 'upsert' && crossesLocalDayBoundary(event, tz)) {
      counts.skipped_cross_day++;
      logger.info('skipped', TAG, { ...ctx, ...buildEventCtx(event), reason: 'cross_day' });
      continue;
    }

    try {
      const outcome = await applyEvent({
        event,
        action,
        policy,
        config,
        token: config.mondayAccessToken,
        provider,
        staleColumnIds,
        ctx,
        counts,
      });
      counts[outcome] = (counts[outcome] || 0) + 1;
    } catch (err) {
      counts.errors = (counts.errors || 0) + 1;
      const cause = extractCause(err);
      // Capture a deduplicated, structured sample of monday-api errors so the
      // owner-notification layer can pick a specific cause (column missing vs.
      // bad status label vs. board deleted) instead of a generic "something
      // failed" message. Cap at 5 distinct signatures per run.
      const sig = extractMondayError(err);
      if (sig.code) {
        if (!counts.errorSamples) counts.errorSamples = [];
        const dup = counts.errorSamples.find((s) =>
          s.code === sig.code && s.msg === sig.msg && s.columnId === sig.columnId);
        if (dup) {
          dup.count++;
        } else if (counts.errorSamples.length < 5) {
          counts.errorSamples.push({ ...sig, count: 1 });
        }
      }
      logger.error('error', TAG, {
        ...ctx,
        ...buildEventCtx(event),
        ...buildErrorCtx(config, event),
        stage: 'apply_event',
        action,
        cause,
      });
      if (/401|unauthorized|not authenticated/i.test(err.message)) throw err;
    }
  }

  if (nextSyncState) {
    await provider.persistSyncState(config.configId, nextSyncState);
  }

  if (staleColumnIds.size > 0) {
    try {
      await syncConfigStorage.updateInstancePolicy(policy.objectId, {
        columnMapping: policy.columnMapping,
      });
      logger.info('policy_pruned', TAG, {
        ...ctx, stale: [...staleColumnIds],
      });
    } catch (err) {
      logger.warn('policy_prune_failed', TAG, {
        ...ctx, error: err.message,
      });
    }
  }

  await syncConfigStorage.updateSyncConfig(config.configId, {
    lastSyncAt: Date.now(),
    lastError: null,
    status: 'active',
  });

  // Single canonical summary line per sync run. Skip noisy zero-count fields.
  // `trigger` records what kicked off this run (webhook | force_sync) so the
  // one INFO line per webhook shows both arrival and outcome — backfill emits
  // its own backfill_done summary and never reaches here. Omitted if unset
  // (formatMessage drops null/undefined).
  const summary = { ...ctx, trigger: trigger || null, total: counts.total, ms: Date.now() - t0 };
  for (const k of ['created', 'updated', 'deleted', 'skipped', 'skipped_missing', 'skipped_rule', 'skipped_cross_day', 'skipped_locked', 'skipped_past', 'errors', 'conditionals_evaluated', 'conditionals_matched']) {
    if (counts[k]) summary[k] = counts[k];
  }
  logger.info('sync_done', TAG, summary);
  return { counts, nextSyncState: nextSyncState || null };
}

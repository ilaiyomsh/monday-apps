// Backfill job for the Custom Object path. Pulls existing Google Calendar
// events in a bounded window (now → +N months) and upserts them onto the
// monday board using the same applyEvent logic delta-sync uses. Fire-and-
// forget: the POST handler kicks it off, returns immediately, and the loop
// checkpoints progress to sync_config.backfill so the UI can poll.
//
// Restart semantics: if the Node process is recycled mid-job, the stored
// cursor lets a re-invocation pick up where it left off without re-fetching
// already-processed pages. The caller is responsible for re-invoking on stuck
// jobs (stale updatedAt) — kept simple in v1.

import syncConfigStorage from '../storage/sync-config-storage.js';
import { getProvider } from './provider.js';
import { classifyEvent, applyEvent } from './sync-engine.js';
import { fetchMondayUserTimeZone } from './monday-api.js';
import { crossesLocalDayBoundary } from '../helpers/date-boundary.js';
import logger from './logger.js';
import { buildSyncCtx, buildEventCtx, buildErrorCtx } from '../helpers/log-context.js';

const TAG = 'backfill';

// Default window: now → +6 months. Hard-coded per product spec.
const DEFAULT_WINDOW_MONTHS = 6;

// Checkpoint to storage every N events to bound writes. Lower = finer-grained
// progress but more storage traffic; higher = fewer writes but chunkier bar.
const CHECKPOINT_EVERY = 10;

function futureIso(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function initialState() {
  return {
    status: 'running',
    total: null,      // unknown until pagination completes
    processed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,          // aggregate; includes the sub-buckets below
    skipped_rule: 0,     // matched a user skip-rule
    skipped_cross_day: 0, // crosses local-day boundary
    skipped_past: 0,     // event already ended (end <= now) and no existing item
    errors: 0,
    cursor: null,     // Google pageToken we're about to fetch
    timeMin: new Date().toISOString(),
    timeMax: futureIso(DEFAULT_WINDOW_MONTHS),
    windowMonths: DEFAULT_WINDOW_MONTHS,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    lastError: null,
  };
}

async function checkpoint(configId, patch) {
  const existing = (await syncConfigStorage.getSyncConfig(configId))?.backfill || {};
  const merged = { ...existing, ...patch, updatedAt: Date.now() };
  await syncConfigStorage.updateSyncConfig(configId, { backfill: merged });
  return merged;
}

async function isCancelled(configId) {
  const cfg = await syncConfigStorage.getSyncConfig(configId);
  return cfg?.backfill?.status === 'cancelling';
}

// Public entry — called by routes/configs.js as fire-and-forget. Any thrown
// error is caught here and persisted as `status: 'error'`.
export async function startBackfill({ configId }) {
  let ctx = { cfg: configId };
  try {
    const config = await syncConfigStorage.getSyncConfig(configId);
    if (!config) throw new Error('config_not_found');
    ctx = buildSyncCtx(config);
    const policy = await syncConfigStorage.getInstancePolicy(config.objectId);
    if (!policy) throw new Error('policy_not_configured');
    if (!policy.boardId || !policy.linkColumnId) throw new Error('policy_not_configured');
    if (!config.mondayAccessToken) throw new Error('monday_access_token_missing');
    logger.info('backfill_started', TAG, ctx);

    // Seed progress. If a previous run left a cursor behind, we resume from it.
    // Also resume from a prior `error` run so transient auth failures don't
    // force the user to re-process the events that already succeeded.
    const existing = config.backfill || {};
    const canResume = (existing.status === 'running' || existing.status === 'error') && existing.cursor;
    const state = canResume
      ? { ...existing, status: 'running', lastError: null, finishedAt: null, updatedAt: Date.now() }
      : initialState();
    await syncConfigStorage.updateSyncConfig(configId, { backfill: state });

    const provider = getProvider(config);
    const userEmail = config.googleUserEmail || config.microsoftUserEmail || null;

    // Refresh the access token at the start of every page so a long-running
    // backfill never carries an expired token across pages. ensureAccessToken
    // is O(1) when the cached token still has > cushion left, so calling it
    // per page is cheap. We re-sync the in-memory config view after each call
    // so a forced refresh (expiresAt=0) doesn't fire on every iteration.
    async function refreshLocalToken({ force = false } = {}) {
      if (force) config.googleAccessTokenExpiresAt = 0;
      const token = await provider.ensureAccessToken(config, syncConfigStorage);
      const fresh = await syncConfigStorage.getSyncConfig(configId);
      if (fresh) {
        config.googleAccessToken = fresh.googleAccessToken ?? config.googleAccessToken;
        config.googleAccessTokenExpiresAt = fresh.googleAccessTokenExpiresAt ?? config.googleAccessTokenExpiresAt;
        config.microsoftAccessToken = fresh.microsoftAccessToken ?? config.microsoftAccessToken;
        config.microsoftTokenExpiresAt = fresh.microsoftTokenExpiresAt ?? config.microsoftTokenExpiresAt;
      }
      return token;
    }

    // Fetch one page with one automatic retry on 401: provider revoked the
    // token (Google returns "Invalid Credentials"), force-refresh and retry.
    async function fetchPageWithAuthRetry(args) {
      let token = await refreshLocalToken();
      try {
        return await provider.listUpcomingPage(token, args);
      } catch (err) {
        const status = err?.code ?? err?.status ?? err?.response?.status;
        if (status !== 401) throw err;
        logger.warn('backfill_token_revoked_retry', TAG, { ...ctx, status });
        token = await refreshLocalToken({ force: true });
        return await provider.listUpcomingPage(token, args);
      }
    }

    // Working copy of policy + columnMapping (same treatment as
    // runSyncForConfig) so applyEvent's auto-recover can prune stale column
    // ids from the in-memory mapping for subsequent events on this run, and
    // we can persist the cleaned mapping at end-of-run.
    const workingPolicy = { ...policy, columnMapping: { ...(policy.columnMapping || {}) } };
    const staleColumnIds = new Set();

    // Lazy-fetch monday TZ so the cross-day filter matches delta-sync behavior.
    let tz = config.mondayTimeZone || null;
    if (!tz) {
      try {
        tz = await fetchMondayUserTimeZone(config.mondayAccessToken);
        if (tz) await syncConfigStorage.updateSyncConfig(configId, { mondayTimeZone: tz });
      } catch (err) {
        logger.warn('tz_fetch_failed', TAG, { ...ctx, error: err.message });
      }
    }

    let pageToken = state.cursor || undefined;
    const counts = {
      processed: state.processed || 0,
      created: state.created || 0,
      updated: state.updated || 0,
      deleted: state.deleted || 0,
      skipped: state.skipped || 0,
      skipped_rule: state.skipped_rule || 0,
      skipped_cross_day: state.skipped_cross_day || 0,
      skipped_past: state.skipped_past || 0,
      errors: state.errors || 0,
    };

    do {
      if (await isCancelled(configId)) {
        await checkpoint(configId, { status: 'cancelled', finishedAt: Date.now(), ...counts });
        logger.info('backfill_cancelled', TAG, { ...ctx, processed: counts.processed });
        return;
      }

      const { events, nextPageToken } = await fetchPageWithAuthRetry({
        timeMin: state.timeMin,
        timeMax: state.timeMax,
        pageToken,
        userEmail,
      });

      for (const event of events) {
        if (await isCancelled(configId)) {
          await checkpoint(configId, { status: 'cancelled', finishedAt: Date.now(), cursor: pageToken || null, ...counts });
          logger.info('backfill_cancelled', TAG, { ...ctx, processed: counts.processed, mid_page: true });
          return;
        }

        const { action } = classifyEvent(event);
        if (action === 'skip') { counts.skipped++; counts.processed++; }
        else if (action === 'upsert' && crossesLocalDayBoundary(event, tz)) {
          counts.skipped_cross_day++;
          counts.skipped++;
          counts.processed++;
        }
        else {
          try {
            const outcome = await applyEvent({
              event, action,
              policy: workingPolicy,
              config,
              token: config.mondayAccessToken,
              provider,
              staleColumnIds,
              ctx,
              counts,
            });
            if (outcome === 'created') counts.created++;
            else if (outcome === 'updated') counts.updated++;
            else if (outcome === 'deleted') counts.deleted++;
            else if (outcome === 'skipped_missing') counts.skipped++;
            else if (outcome === 'skipped_rule') { counts.skipped_rule++; counts.skipped++; }
            else if (outcome === 'skipped_past') { counts.skipped_past++; counts.skipped++; }
            counts.processed++;
          } catch (err) {
            counts.errors++;
            counts.processed++;
            logger.error('error', TAG, {
              ...ctx,
              ...buildEventCtx(event),
              ...buildErrorCtx(config, event),
              stage: 'apply_event',
              action,
              cause: err.message?.slice(0, 200),
            });
            // Don't re-throw auth errors here — we'd rather finish the batch
            // and surface the error count. Stuck-at-0 is obvious to the user.
          }
        }

        if (counts.processed % CHECKPOINT_EVERY === 0) {
          await checkpoint(configId, { ...counts, cursor: pageToken || null });
        }
      }

      pageToken = nextPageToken || undefined;
      await checkpoint(configId, { ...counts, cursor: pageToken || null });
    } while (pageToken);

    if (staleColumnIds.size > 0) {
      try {
        await syncConfigStorage.updateInstancePolicy(workingPolicy.objectId, {
          columnMapping: workingPolicy.columnMapping,
        });
        logger.info('policy_pruned', TAG, { ...ctx, stale: [...staleColumnIds] });
      } catch (err) {
        logger.warn('policy_prune_failed', TAG, { ...ctx, error: err.message });
      }
    }

    await checkpoint(configId, {
      ...counts,
      status: 'done',
      total: counts.processed,
      cursor: null,
      finishedAt: Date.now(),
      lastError: null,
    });
    logger.info('backfill_done', TAG, { ...ctx, ...counts });
  } catch (err) {
    logger.error('error', TAG, { ...ctx, stage: 'backfill', cause: err.message?.slice(0, 200) });
    try {
      await checkpoint(configId, {
        status: 'error',
        finishedAt: Date.now(),
        lastError: String(err.message || err).slice(0, 500),
      });
    } catch (checkpointErr) {
      // The primary backfill error is already shipped above; this secondary
      // failure (couldn't even persist the error checkpoint) is logged as a WARN
      // so a stuck 'running' status that never flips to 'error' is traceable.
      logger.warn('backfill_error_checkpoint_failed', TAG, {
        ...ctx, stage: 'backfill_error_checkpoint', cause: checkpointErr?.message || String(checkpointErr),
      });
    }
  }
}

export async function requestBackfillCancel(configId) {
  const cfg = await syncConfigStorage.getSyncConfig(configId);
  const current = cfg?.backfill;
  if (!current || current.status !== 'running') return false;
  await syncConfigStorage.updateSyncConfig(configId, {
    backfill: { ...current, status: 'cancelling', updatedAt: Date.now() },
  });
  return true;
}

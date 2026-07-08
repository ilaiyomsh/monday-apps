import { Router } from 'express';
import { authenticationMiddleware } from '../middlewares/authentication.js';
import * as googleCalendar from '../services/google-calendar.js';
import {
  findItemByColumnValue,
  createItem,
  updateItem,
  deleteItem,
  changeItemName,
} from '../services/monday-api.js';
import subscriptionStorage from '../storage/subscription-storage.js';
import { getBaseUrl } from '../helpers/environment.js';
import logger from '../services/logger.js';

const router = Router();
const TAG = 'route_actions';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// In production we've seen monday invoke /actions/sync-events within ~3s of
// the fire trigger response, while the webhook's setTriggerCache can take
// 5-10s when SecureStorage is flaky. To close that race, poll the cache for
// several seconds before giving up instead of 500'ing on the first miss.
// 10s accommodates one inner retry cycle (up to ~4s with backoff) plus a
// second outer poll attempt with fresh backoff.
const CACHE_POLL_MAX_WAIT_MS = 10000;
const CACHE_POLL_INTERVAL_MS = 400;

async function readTriggerCacheWithRetry(triggerUuid) {
  const deadline = Date.now() + CACHE_POLL_MAX_WAIT_MS;
  let attempt = 0;
  for (;;) {
    const cache = await subscriptionStorage.getTriggerCache(triggerUuid);
    if (cache) return { cache, attempt };
    if (Date.now() >= deadline) return { cache: null, attempt };
    attempt++;
    await new Promise((r) => setTimeout(r, CACHE_POLL_INTERVAL_MS));
  }
}

// Transform a resolved trigger-output value into monday column_values format.
// ISO datetime strings become {date, time} in UTC — monday's date column stores
// times in UTC and renders in the user's timezone, so we must convert from the
// event's wall time (e.g. Asia/Jerusalem) to UTC before writing.
function normalizeColumnValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const iso = d.toISOString();
        return { date: iso.substring(0, 10), time: iso.substring(11, 19) };
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw };
  }
  return raw;
}

function buildColumnValuesFromItem({ linkColumnId, eventUrl, item, peopleColumnId, assignedUserId }) {
  const values = {};
  for (const [columnId, raw] of Object.entries(item || {})) {
    const normalized = normalizeColumnValue(raw);
    if (normalized !== null) values[columnId] = normalized;
  }
  if (linkColumnId && eventUrl) {
    // text must equal url so items_page_by_column_values can match the link column
    values[linkColumnId] = { url: eventUrl, text: eventUrl };
  }
  if (peopleColumnId && assignedUserId) {
    const idNum = Number(assignedUserId);
    if (!Number.isNaN(idNum)) {
      values[peopleColumnId] = { personsAndTeams: [{ id: idNum, kind: 'person' }] };
    }
  }
  return values;
}

async function handleSingleEvent({
  mondayToken,
  boardId,
  linkColumnId,
  eventId,
  eventStatus,
  eventUrl,
  itemName,
  item,
  peopleColumnId,
  assignedUserId,
}) {
  if (!boardId || !linkColumnId) {
    logger.error('missing boardId or linkColumnId in action', TAG, { boardId, linkColumnId });
    return;
  }

  const existingItemId = eventUrl
    ? await findItemByColumnValue(mondayToken, {
        boardId,
        columnId: linkColumnId,
        value: eventUrl,
      })
    : null;

  if (eventStatus === 'cancelled') {
    if (existingItemId) {
      await deleteItem(mondayToken, existingItemId);
      logger.info('event deleted', TAG, { eventId, itemId: existingItemId });
    } else {
      logger.info('cancelled event has no matching item, skipping', TAG, { eventId });
    }
    return;
  }

  const columnValues = buildColumnValuesFromItem({
    linkColumnId,
    eventUrl,
    item,
    peopleColumnId,
    assignedUserId,
  });
  const resolvedName = itemName || '(no title)';

  if (existingItemId) {
    await updateItem(mondayToken, { boardId, itemId: existingItemId, columnValues });
    // change_multiple_column_values only touches columns — the item's name
    // needs its own mutation.
    try {
      await changeItemName(mondayToken, { boardId, itemId: existingItemId, newName: resolvedName });
    } catch (err) {
      logger.warn('failed to rename item (continuing)', TAG, { eventId, itemId: existingItemId, error: err.message });
    }
    logger.info('event updated', TAG, { eventId, itemId: existingItemId, newName: resolvedName });
  } else {
    const newItemId = await createItem(mondayToken, {
      boardId,
      itemName: resolvedName,
      columnValues,
    });
    logger.info('event created', TAG, { eventId, itemId: newItemId });
  }
}

router.post('/actions/sync-events', authenticationMiddleware, async (req, res) => {
  try {
    const { shortLivedToken } = req.session;
    const { credentialsValues, inboundFieldValues } = req.body.payload;
    // monday places runtimeMetadata at the TOP of the request body (sibling of
    // `payload`), not inside payload — confirmed against production samples.
    const runtimeMetadata = req.body.runtimeMetadata;

    const accessToken = credentialsValues?.google_credentials?.accessToken;
    const triggerUuid = runtimeMetadata?.triggerUuid;

    // User-configured inputs only — routing comes from the trigger cache, not here.
    const boardId = inboundFieldValues?.boardId;
    const linkColumnId = inboundFieldValues?.linkColumnId;
    const peopleColumnId = inboundFieldValues?.peopleColumnId;
    const itemName = inboundFieldValues?.itemName;
    const item = inboundFieldValues?.item || {};

    logger.info('action invoked', TAG, {
      triggerUuid,
      boardId,
      linkColumnId,
      peopleColumnId,
      itemName,
      item: JSON.stringify(item),
      hasGoogleToken: !!accessToken,
    });

    if (!triggerUuid) {
      logger.error('action invoked without triggerUuid in runtimeMetadata', TAG);
      return res.status(400).json({ error: 'triggerUuid required' });
    }

    const { cache, attempt } = await readTriggerCacheWithRetry(triggerUuid);
    if (!cache) {
      // Cache miss after polling — either TTL expired, fire never wrote one,
      // or webhook's cache write never completed. Return 500 so monday retries
      // at its own (~60s) cadence; next webhook push will also pick it up via
      // syncToken.
      logger.error('trigger cache miss after polling', TAG, { triggerUuid, polledFor: attempt });
      return res.status(500).json({ error: 'trigger cache miss' });
    }
    if (attempt > 0) {
      logger.info('trigger cache resolved after polling', TAG, { triggerUuid, attempts: attempt });
    }

    // Consume-once: delete the cache entry immediately so action retries do
    // not re-process (the cache is intended as one-shot hand-off).
    try {
      await subscriptionStorage.deleteTriggerCache(triggerUuid);
    } catch (err) {
      logger.warn('failed to delete trigger cache entry', TAG, { triggerUuid, error: err.message });
    }

    const { subscriptionId, eventId, eventStatus, eventLink } = cache;
    logger.info('trigger cache consumed', TAG, { triggerUuid, subscriptionId, eventId, eventStatus });

    // Refresh the stored Google accessToken so the webhook always has a valid one
    // for its next invocation ("activity solution" for token expiry).
    if (accessToken) {
      try {
        await subscriptionStorage.updateSubscription(subscriptionId, {
          accessToken,
          accessTokenUpdatedAt: Date.now(),
        });
      } catch (err) {
        logger.warn('failed to refresh stored accessToken', TAG, {
          subscriptionId,
          error: err.message,
        });
      }
    }

    const subscription = await subscriptionStorage.getSubscription(subscriptionId);
    const assignedUserId = subscription?.userId;

    await handleSingleEvent({
      mondayToken: shortLivedToken,
      boardId,
      linkColumnId,
      eventId,
      eventStatus,
      eventUrl: eventLink,
      itemName,
      item,
      peopleColumnId,
      assignedUserId,
    });

    await maybeRenewWatchChannel({ subscriptionId, accessToken });
    logger.info('sync complete', TAG, { subscriptionId, eventId });
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('action sync-events failed', TAG, { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'sync failed' });
  }
});

async function maybeRenewWatchChannel({ subscriptionId, accessToken }) {
  const subscription = await subscriptionStorage.getSubscription(subscriptionId);
  if (!subscription) return;

  const expirationMs = Number(subscription.expiration);
  if (!expirationMs || expirationMs - Date.now() >= ONE_DAY_MS) return;

  logger.info('watch channel near expiration, renewing', TAG, {
    subscriptionId,
    expiration: expirationMs,
  });

  try {
    await googleCalendar.stopChannel(accessToken, subscriptionId, subscription.resourceId);
  } catch (err) {
    logger.warn('failed to stop old channel during renew', TAG, { error: err.message });
  }

  const { resourceId, expiration } = await googleCalendar.watchCalendar(accessToken, {
    channelId: subscriptionId,
    baseUrl: getBaseUrl(),
  });

  await subscriptionStorage.updateSubscription(subscriptionId, { resourceId, expiration });
  await subscriptionStorage.removeFromSubscriptionIndex(subscriptionId);
  await subscriptionStorage.addToSubscriptionIndex({
    subscriptionId,
    webhookUrl: subscription.webhookUrl,
    userId: subscription.userId,
    expiration,
  });

  logger.info('watch channel renewed', TAG, { subscriptionId, expiration });
}

export default router;

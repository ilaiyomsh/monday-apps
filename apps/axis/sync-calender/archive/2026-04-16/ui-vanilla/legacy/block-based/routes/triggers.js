import { Router } from 'express';
import { authenticationMiddleware } from '../middlewares/authentication.js';
import * as googleCalendar from '../services/google-calendar.js';
import subscriptionStorage from '../storage/subscription-storage.js';
import { getBaseUrl } from '../helpers/environment.js';
import logger from '../services/logger.js';

const router = Router();
const TAG = 'route_triggers';

router.post('/triggers/subscribe', authenticationMiddleware, async (req, res) => {
  try {
    const { userId, accountId } = req.session;
    const payload = req.body.payload || {};
    const {
      webhookUrl,
      subscriptionId,
      previousSubscriptionId,
      recipeId,
      integrationId,
      credentialsValues,
    } = payload;
    const accessToken = credentialsValues?.google_credentials?.accessToken;

    logger.info('subscribe received', TAG, {
      userId,
      accountId,
      subscriptionId,
      previousSubscriptionId,
      webhookUrl,
      recipeId,
      integrationId,
      hasAccessToken: !!accessToken,
    });

    if (!subscriptionId) {
      logger.error('subscribe missing subscriptionId', TAG);
      return res.status(400).json({ error: 'subscriptionId required' });
    }

    // Migration path: if monday is resubscribing after a recipe edit, salvage
    // the old subscription's syncToken so events emitted between the two calls
    // are preserved on the next webhook fire.
    let migratedSyncToken = null;
    if (previousSubscriptionId) {
      const old = await subscriptionStorage.getSubscription(previousSubscriptionId);
      if (old) {
        migratedSyncToken = old.syncToken;
        logger.info('subscribe: migrating syncToken from previousSubscriptionId', TAG, {
          previousSubscriptionId,
          syncTokenPresent: !!migratedSyncToken,
        });
        try {
          await googleCalendar.stopChannel(accessToken, previousSubscriptionId, old.resourceId);
        } catch (err) {
          logger.warn('subscribe: failed to stop previous google channel', TAG, {
            previousSubscriptionId,
            error: err.message,
          });
        }
        await subscriptionStorage.deleteSubscription(previousSubscriptionId);
        await subscriptionStorage.removeUserSubscription(old.userId, previousSubscriptionId);
        await subscriptionStorage.removeFromSubscriptionIndex(previousSubscriptionId);
      } else {
        logger.warn('subscribe: previousSubscriptionId has no stored state', TAG, {
          previousSubscriptionId,
        });
      }
    }

    const { resourceId, expiration } = await googleCalendar.watchCalendar(accessToken, {
      channelId: String(subscriptionId),
      baseUrl: getBaseUrl(),
    });

    let syncToken = migratedSyncToken;
    if (!syncToken) {
      const initial = await googleCalendar.getInitialSyncToken(accessToken);
      syncToken = initial.syncToken;
    }

    const userEmail = await googleCalendar.fetchUserEmail(accessToken);
    logger.info('subscribe userEmail resolved', TAG, { subscriptionId, userEmail });

    await subscriptionStorage.setSubscription(subscriptionId, {
      webhookUrl,
      syncToken,
      userId,
      accountId,
      userEmail,
      resourceId,
      expiration,
      accessToken,
      accessTokenUpdatedAt: Date.now(),
      createdAt: Date.now(),
    });

    await subscriptionStorage.addUserSubscription(userId, subscriptionId);
    await subscriptionStorage.addToSubscriptionIndex({
      subscriptionId,
      webhookUrl,
      userId,
      expiration,
    });

    logger.info('subscribe complete', TAG, { subscriptionId });
    return res.status(200).json({ webhookId: subscriptionId });
  } catch (err) {
    logger.error('subscribe failed', TAG, { error: err.message });
    return res.status(500).json({ error: 'subscribe failed' });
  }
});

router.post('/triggers/unsubscribe', authenticationMiddleware, async (req, res) => {
  try {
    const payload = req.body.payload || {};
    const { webhookId: subscriptionId, unsubscribeReason } = payload;
    const accessToken = payload?.credentialsValues?.google_credentials?.accessToken;

    logger.info('unsubscribe received', TAG, {
      subscriptionId,
      unsubscribeReason,
      userId: req.session?.userId,
      hasAccessToken: !!accessToken,
    });

    // When monday resubscribes after a recipe edit, it sends unsubscribe first
    // then subscribe with previousSubscriptionId. Leave the state in place so
    // the subscribe handler can migrate the syncToken.
    if (unsubscribeReason === 'resubscribing') {
      logger.info('unsubscribe: resubscribing reason, skipping cleanup (subscribe will migrate)', TAG, {
        subscriptionId,
      });
      return res.status(200).header('Content-Type', 'application/json').end();
    }

    const subscription = await subscriptionStorage.getSubscription(subscriptionId);

    if (subscription && accessToken) {
      try {
        await googleCalendar.stopChannel(accessToken, subscriptionId, subscription.resourceId);
        logger.info('google watch channel stopped', TAG, { subscriptionId });
      } catch (err) {
        logger.warn('failed to stop google watch channel', TAG, { subscriptionId, error: err.message });
      }
    }

    if (subscription) {
      await subscriptionStorage.deleteSubscription(subscriptionId);
      await subscriptionStorage.removeUserSubscription(subscription.userId, subscriptionId);
      await subscriptionStorage.removeFromSubscriptionIndex(subscriptionId);
      logger.info('subscription storage cleaned up', TAG, { subscriptionId });
    }

    return res.status(200).header('Content-Type', 'application/json').end();
  } catch (err) {
    logger.error('unsubscribe failed', TAG, { error: err.message });
    return res.status(500).json({ error: 'unsubscribe failed' });
  }
});

export default router;

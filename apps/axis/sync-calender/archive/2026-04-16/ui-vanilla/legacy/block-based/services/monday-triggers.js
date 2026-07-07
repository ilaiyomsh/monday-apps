import jwt from 'jsonwebtoken';
import logger from './logger.js';

const TAG = 'monday_triggers';

// Fires a trigger to monday's webhookUrl and returns the triggerUuid monday
// assigns to this invocation. The caller uses that UUID as the key to cache
// per-event routing data for the action to pick up via runtimeMetadata.triggerUuid.
// Returns null if the fire fails (network/5xx/non-JSON body).
export async function fireTrigger(webhookUrl, outputFields = {}) {
  try {
    const appId = Number(process.env.MONDAY_APP_ID);
    const jwtToken = jwt.sign(
      { appId },
      process.env.MONDAY_SIGNING_SECRET
    );

    const body = JSON.stringify({ trigger: { outputFields } });
    logger.info('fire trigger request', TAG, { appId, outputFields });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: jwtToken,
      },
      body,
    });

    const responseText = await response.text();
    if (!response.ok) {
      logger.error('fire trigger failed', TAG, { status: response.status, body: responseText });
      return null;
    }

    logger.info('fire trigger response', TAG, { status: response.status, body: responseText });

    try {
      const parsed = JSON.parse(responseText);
      return parsed?.triggerUuid || null;
    } catch (err) {
      logger.warn('fire trigger response was not JSON', TAG, { body: responseText });
      return null;
    }
  } catch (err) {
    logger.error('trigger fire error', TAG, { error: err.message });
    return null;
  }
}

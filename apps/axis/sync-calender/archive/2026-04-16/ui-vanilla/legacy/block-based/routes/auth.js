import { Router } from 'express';
import { google } from 'googleapis';
import logger from '../services/logger.js';

const router = Router();
const TAG = 'route_auth';

// Provider Unique Identifier endpoint — called by monday's Credentials feature to identify
// the Google account associated with the stored token.
router.post('/auth/google-identifier', async (req, res) => {
  try {
    const { token, userId, accountId } = req.body || {};
    logger.info('google identifier received', TAG, {
      userId,
      accountId,
      hasToken: !!token,
    });

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });

    const opts = process.env.GOOGLE_API_BASE_URL
      ? { rootUrl: process.env.GOOGLE_API_BASE_URL }
      : {};
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client, ...opts });
    const userInfoRes = await oauth2.userinfo.get();
    const email = userInfoRes.data?.email;

    logger.info('google identifier resolved', TAG, {
      status: userInfoRes.status,
      email,
    });

    return res.json({
      providerUniqueIdentifier: email,
      displayName: email,
    });
  } catch (err) {
    logger.error('google identifier failed', TAG, { error: err.message });
    return res.status(500).json({ error: 'failed to resolve google identifier' });
  }
});

export default router;

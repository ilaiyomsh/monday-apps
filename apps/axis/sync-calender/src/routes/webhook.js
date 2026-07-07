import { Router } from 'express';
import { webhookConfigHandler } from './webhook-config.js';

const router = Router();

// Google calendar push notification endpoint. All /webhook/calendar traffic
// belongs to the Custom Object admin path (channel tokens are `config_<id>`).
// The v3 block-based handler was retired on 2026-04-20; its pre-retirement
// version lives at legacy/block-based/routes/webhook.js.full.
router.post('/webhook/calendar', webhookConfigHandler);

export default router;

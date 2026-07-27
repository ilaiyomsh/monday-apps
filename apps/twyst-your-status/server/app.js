import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSessionMiddleware } from './auth/jwt.js';
import { errorMiddleware } from './errorMiddleware.js';
import logger from './logger.js';
import { createOAuthApiRouter, createOAuthCallbackRouter } from './routes/oauth.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createWorkflowRouter } from './routes/workflow.js';

const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

export function createApp({
  store,
  mondayApi,
  webhookManager,
  enforcementService,
  tokenProvider,
  oauthClient,
  env,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const requireSession = createSessionMiddleware({ clientSecret: env.clientSecret });
  app.use('/api', requireSession);
  app.use('/api', createWorkflowRouter({ store, mondayApi, webhookManager, tokenProvider }));
  app.use('/api/oauth', createOAuthApiRouter({ store, tokenProvider, env }));
  app.use('/oauth', createOAuthCallbackRouter({ store, oauthClient, env }));
  app.use('/webhooks', createWebhookRouter({ tokenProvider, enforcementService, env }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
  }

  app.use(errorMiddleware(logger));
  return app;
}

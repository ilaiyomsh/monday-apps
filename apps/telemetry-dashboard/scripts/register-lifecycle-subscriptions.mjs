#!/usr/bin/env node
// Register feature-level lifecycle subscriptions for every app in
// scripts/lifecycle-apps.config.json, pointing them all at the
// telemetry-dashboard webhook: <webhookBaseUrl>/api/webhooks/lifecycle.
//
// Generalized from apps/axis/sync-calender/scripts/register-lifecycle-subscriptions.mjs.
//
// Usage:
//   node scripts/register-lifecycle-subscriptions.mjs [--dry-run] [--app <slug>]
//
// For each configured feature it runs update_app_lifecycle_subscription with
// ALL lifecycle events for the feature's kind (is_sync: false — async mode),
// then verifies via get_app_lifecycle_subscriptions(app_id).
//
// Token resolution: MONDAY_API_TOKEN env var, else ~/.config/mapps/.mappsrc
// (JSON field `accessToken`). The token value is never printed.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
const API_VERSION = '2026-04';
const CONFIG_URL = new URL('./lifecycle-apps.config.json', import.meta.url);

// ALL lifecycle event actions per feature kind (monday API 2026-04).
const EVENTS_BY_KIND = {
  AppFeatureBoardView: ['delete', 'duplicate', 'restore'],
  AppFeatureBoardColumnExtension: ['delete', 'duplicate', 'export'],
  AppFeatureColumn: ['create', 'delete', 'board_deleted', 'board_restored'],
  AppFeatureObject: [
    'archive',
    'create',
    'delete',
    'duplicate',
    'import',
    'publish',
    'restore',
    'unpublish',
    'update_attributes',
  ],
};

const HELP = `register-lifecycle-subscriptions.mjs — register feature lifecycle webhooks

Usage:
  node scripts/register-lifecycle-subscriptions.mjs [options]

Options:
  --dry-run       Print the planned mutations without calling the API
  --app <slug>    Only process the app whose name or appSlug matches <slug>
  --help          Show this help

Reads scripts/lifecycle-apps.config.json:
  { "webhookBaseUrl": "...", "apps": [{ "name", "appId", "appSlug", "features": [{ "featureSlug", "kind" }] }] }

webhookBaseUrl must be filled (telemetry-dashboard live URL). Entries with an
empty featureSlug (or appSlug) are skipped with a warning.

Token: MONDAY_API_TOKEN env var, else accessToken from ~/.config/mapps/.mappsrc.
`;

function resolveToken() {
  if (process.env.MONDAY_API_TOKEN) return process.env.MONDAY_API_TOKEN;
  const rcPath = join(homedir(), '.config', 'mapps', '.mappsrc');
  try {
    const parsed = JSON.parse(readFileSync(rcPath, 'utf8'));
    if (typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0) {
      return parsed.accessToken;
    }
    console.error(`note: ${rcPath} has no accessToken field`);
  } catch (err) {
    console.error(`note: could not read ${rcPath} (${err.message})`);
  }
  return null;
}

async function graphql(token, query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`monday API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)} (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`monday API HTTP ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(`monday API errors: ${JSON.stringify(json.errors).slice(0, 800)}`);
  }
  if (!json.data) throw new Error('monday API response has no data');
  return json.data;
}

function buildRegisterMutation({ entityId, kind, webhookUrl }) {
  const eventLines = EVENTS_BY_KIND[kind]
    .map(
      (action) =>
        `        { event_type: ${JSON.stringify(`${kind}:${action}`)}, webhook_url: ${JSON.stringify(webhookUrl)}, is_sync: false }`
    )
    .join('\n');
  return `mutation {
  update_app_lifecycle_subscription(
    entity_identifier: ${JSON.stringify(entityId)}
    entity_type: "appFeature"
    input: {
      lifecycle_events: [
${eventLines}
      ]
    }
  ) { id event_type webhook_url is_sync }
}`;
}

function buildVerifyQuery(appId) {
  return `query {
  get_app_lifecycle_subscriptions(app_id: ${JSON.stringify(String(appId))}) {
    id entity_id event_type webhook_url is_sync
  }
}`;
}

function loadConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_URL, 'utf8');
  } catch (err) {
    console.error(`cannot read lifecycle-apps.config.json next to this script: ${err.message}`);
    process.exit(1);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error(`lifecycle-apps.config.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(config.apps)) {
    console.error('lifecycle-apps.config.json must have an "apps" array');
    process.exit(1);
  }
  return config;
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      app: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const dryRun = values['dry-run'];
  const config = loadConfig();

  const base = String(config.webhookBaseUrl ?? '').replace(/\/+$/, '');
  if (!base) {
    console.error('webhookBaseUrl is empty in lifecycle-apps.config.json — fill it with the telemetry-dashboard live URL first');
    process.exit(1);
  }
  if (!/^https:\/\//.test(base)) {
    console.error(`webhookBaseUrl must start with https:// — got: ${base}`);
    process.exit(1);
  }
  const webhookUrl = `${base}/api/webhooks/lifecycle`;

  let apps = config.apps;
  if (values.app) {
    apps = apps.filter((a) => a.name === values.app || a.appSlug === values.app);
    if (apps.length === 0) {
      console.error(`--app ${values.app} matched nothing; available: ${config.apps.map((a) => a.name || a.appSlug || a.appId).join(', ')}`);
      process.exit(1);
    }
  }

  let token = null;
  if (!dryRun) {
    token = resolveToken();
    if (!token) {
      console.error('missing token: set MONDAY_API_TOKEN or run `mapps init -t <token>` first');
      process.exit(1);
    }
  }

  console.log(`webhook URL: ${webhookUrl}${dryRun ? '  (dry run — no API calls)' : ''}`);

  const failures = [];
  for (const app of apps) {
    const label = app.name || app.appSlug || app.appId;
    const features = Array.isArray(app.features) ? app.features : [];

    if (features.length === 0) {
      console.warn(`\n[${label}] no features configured — skipping (app-level webhooks are registered in the Developer Center, not here)`);
      continue;
    }
    if (!app.appSlug) {
      console.warn(`\n[${label}] appSlug is empty — skipping all its features (fill it from the Developer Center)`);
      continue;
    }

    let registeredAny = false;
    for (const feature of features) {
      if (!feature.featureSlug) {
        console.warn(`[${label}] feature with empty featureSlug — skipping (fill it from the Developer Center feature URL slug)`);
        continue;
      }
      if (!EVENTS_BY_KIND[feature.kind]) {
        console.warn(`[${label}] feature ${feature.featureSlug} has unknown kind "${feature.kind}" — skipping (expected one of: ${Object.keys(EVENTS_BY_KIND).join(', ')})`);
        continue;
      }

      const entityId = `${app.appSlug}::${feature.featureSlug}`;
      const mutation = buildRegisterMutation({ entityId, kind: feature.kind, webhookUrl });

      if (dryRun) {
        console.log(`\n[${label}] planned mutation for ${entityId}:\n${mutation}`);
        continue;
      }

      console.log(`\n[${label}] registering ${EVENTS_BY_KIND[feature.kind].length} ${feature.kind} events for ${entityId}…`);
      try {
        const data = await graphql(token, mutation);
        console.log(JSON.stringify(data.update_app_lifecycle_subscription, null, 2));
        registeredAny = true;
      } catch (err) {
        console.error(`[${label}] registration failed for ${entityId}: ${err.message}`);
        failures.push(`${label}/${feature.featureSlug}`);
      }
    }

    if (!dryRun && registeredAny) {
      try {
        const data = await graphql(token, buildVerifyQuery(app.appId));
        console.log(`[${label}] current subscriptions (app_id ${app.appId}):`);
        console.log(JSON.stringify(data.get_app_lifecycle_subscriptions, null, 2));
      } catch (err) {
        console.error(`[${label}] verification query failed: ${err.message}`);
        failures.push(`${label}/verify`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\ndone with ${failures.length} failure(s): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\ndone.');
}

main().catch((err) => {
  console.error(`register-lifecycle-subscriptions failed: ${err.message}`);
  process.exit(1);
});

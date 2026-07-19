#!/usr/bin/env node
// Simulate monday lifecycle / app-event webhooks against a running
// telemetry-dashboard server (local or deployed) to verify the webhook
// routes end-to-end: JWT auth, challenge echo, and 202 fast-ack.
//
// Usage:
//   node scripts/simulate-webhook.mjs --url <base> --kind challenge
//   node scripts/simulate-webhook.mjs --url <base> --secret <s> --slug <appSlug> --kind lifecycle
//   node scripts/simulate-webhook.mjs --url <base> --secret <s> --slug <appSlug> --kind app-events
//   node scripts/simulate-webhook.mjs --url <base> --secret wrong --slug <appSlug> --kind lifecycle --expect-fail
//
// Exit code 0 iff the response matches the expectation:
//   challenge   -> 200 with the challenge echoed back
//   lifecycle / app-events with a valid secret -> 202
//   --expect-fail -> 401
//
// Secret values and signed tokens are never printed.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

// jsonwebtoken comes from the app's own node_modules (scripts run inside the
// repo); createRequire resolves it from this script's directory upward, which
// is robust to the pnpm symlink layout.
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const KINDS = ['lifecycle', 'app-events', 'challenge'];

const HELP = `simulate-webhook.mjs — POST signed sample webhooks at telemetry-dashboard

Usage:
  node scripts/simulate-webhook.mjs --url <base> --kind <kind> [options]

Options:
  --url <base>      Server base URL, e.g. http://localhost:8080 (required)
  --kind <kind>     One of: ${KINDS.join(' | ')} (required)
  --secret <s>      Secret to sign the JWT with (required for lifecycle/app-events;
                    signing secret for lifecycle, client secret for app-events)
  --slug <appSlug>  App slug the event pretends to come from (required for
                    lifecycle/app-events; must match a key in the server's secret map)
  --expect-fail     Expect a 401 (use with a wrong secret to verify fail-closed auth)
  --help            Show this help

Routes hit:
  lifecycle / challenge -> POST <base>/api/webhooks/lifecycle
  app-events            -> POST <base>/api/webhooks/app-events
`;

function buildPayload(kind, slug, challenge) {
  if (kind === 'challenge') {
    return { challenge };
  }
  if (kind === 'lifecycle') {
    // Feature-level lifecycle event shape (API 2026-04+). back_to_url omitted
    // on purpose so the server does not fire a callback at a fake URL.
    return {
      type: 'AppFeatureObject:create',
      payload: {
        app_feature: { id: 12345, name: `${slug}-feature` },
        appFeatureId: 12345,
        boardId: 4567890,
        instanceId: 987654,
      },
      accountId: 999001,
      userId: 111001,
    };
  }
  // app-events: Developer Center app-level webhook shape.
  return {
    type: 'install',
    data: {
      app_id: 11704868,
      user_id: 111001,
      user_email: 'sim@example.com',
      user_name: 'Sim User',
      account_id: 999001,
      account_name: 'Sim Account',
      account_slug: 'sim-account',
      account_tier: 'pro',
      account_max_users: 25,
      timestamp: new Date().toISOString(),
      version_data: { major: 1, minor: 0, patch: 0, type: 'major' },
      subscription: null,
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      secret: { type: 'string' },
      slug: { type: 'string' },
      kind: { type: 'string' },
      'expect-fail': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (!values.url) {
    console.error('missing --url <base> (e.g. http://localhost:8080)');
    process.exit(1);
  }
  if (!values.kind || !KINDS.includes(values.kind)) {
    console.error(`missing or invalid --kind — expected one of: ${KINDS.join(', ')}`);
    process.exit(1);
  }
  const needsAuth = values.kind !== 'challenge';
  if (needsAuth && !values.secret) {
    console.error(`--secret is required for --kind ${values.kind}`);
    process.exit(1);
  }
  if (needsAuth && !values.slug) {
    console.error(`--slug is required for --kind ${values.kind}`);
    process.exit(1);
  }

  const base = values.url.replace(/\/+$/, '');
  const route = values.kind === 'app-events' ? '/api/webhooks/app-events' : '/api/webhooks/lifecycle';
  const target = `${base}${route}`;
  const challenge = randomUUID();
  const eventId = `sim-${randomUUID()}`;
  const payload = buildPayload(values.kind, values.slug, challenge);

  const headers = {
    'Content-Type': 'application/json',
    'X-Apps-Event-Id': eventId,
  };
  if (needsAuth) {
    headers.Authorization = jwt.sign(
      { accountId: 999001, userId: 111001, slug: values.slug },
      values.secret,
      { expiresIn: '5m' }
    );
  }

  console.log(`POST ${target}  kind=${values.kind}${needsAuth ? ` slug=${values.slug}` : ''} eventId=${eventId}`);
  let res;
  try {
    res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (err) {
    console.error(`request failed: ${err.message}`);
    process.exit(1);
  }
  const bodyText = await res.text();
  console.log(`status: ${res.status}`);
  console.log(`body: ${bodyText}`);

  let ok;
  let expected;
  if (values['expect-fail']) {
    expected = '401';
    ok = res.status === 401;
  } else if (values.kind === 'challenge') {
    expected = '200 with the challenge echoed back';
    let echoed = null;
    try {
      echoed = JSON.parse(bodyText)?.challenge ?? null;
    } catch (err) {
      console.error(`challenge response is not JSON: ${err.message}`);
    }
    ok = res.status === 200 && echoed === challenge;
  } else {
    expected = '202';
    ok = res.status === 202;
  }

  if (!ok) {
    console.error(`FAIL: expected ${expected}, got ${res.status}`);
    process.exit(1);
  }
  console.log(`OK: matched expectation (${expected})`);
}

main().catch((err) => {
  console.error(`simulate-webhook failed: ${err.message}`);
  process.exit(1);
});

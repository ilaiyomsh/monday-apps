// Register lifecycle subscriptions for the Custom Object feature.
//
// Usage:
//   MONDAY_API_TOKEN=<collaborator-token> \
//   APP_SLUG=yomsheni-dev_calendarsync \
//   FEATURE_SLUG=calendar-sync-admin \
//   LIVE_URL=https://live1-service-27549619-d2f728f4.us.monday.app \
//   node scripts/register-lifecycle-subscriptions.mjs
//
// Or, with defaults for this project, simply:
//   MONDAY_API_TOKEN=<token> node scripts/register-lifecycle-subscriptions.mjs

const TOKEN = process.env.MONDAY_API_TOKEN;
const APP_SLUG = process.env.APP_SLUG || 'yomsheni-dev_calendarsync';
const FEATURE_SLUG = process.env.FEATURE_SLUG || 'calendar-sync-admin';
const LIVE_URL = process.env.LIVE_URL || 'https://live1-service-27549619-d2f728f4.us.monday.app';
const APP_ID = process.env.MONDAY_APP_ID || '11119011';

if (!TOKEN) {
  console.error('missing MONDAY_API_TOKEN env var');
  process.exit(1);
}

const ENTITY_ID = `${APP_SLUG}::${FEATURE_SLUG}`;
const WEBHOOK = `${LIVE_URL}/lifecycle/custom-object`;

const REGISTER = `
mutation {
  update_app_lifecycle_subscription(
    entity_identifier: "${ENTITY_ID}"
    entity_type: "appFeature"
    input: {
      lifecycle_events: [
        { event_type: "AppFeatureObject:create",            webhook_url: "${WEBHOOK}", is_sync: true  }
        { event_type: "AppFeatureObject:delete",            webhook_url: "${WEBHOOK}", is_sync: false }
        { event_type: "AppFeatureObject:update_attributes", webhook_url: "${WEBHOOK}", is_sync: true  }
      ]
    }
  ) { id event_type webhook_url is_sync }
}
`;

const VERIFY = `
query {
  get_app_lifecycle_subscriptions(app_id: "${APP_ID}") {
    id entity_id event_type webhook_url is_sync
  }
}
`;

async function run(query, label) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN,
      'API-Version': '2026-04',
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(json, null, 2));
  if (json.errors?.length) {
    console.error(`\n${label} returned errors — aborting.`);
    process.exit(1);
  }
  return json;
}

console.log(`Registering lifecycle for ${ENTITY_ID}`);
console.log(`Webhook URL: ${WEBHOOK}`);
await run(REGISTER, 'update_app_lifecycle_subscription');
await run(VERIFY, 'get_app_lifecycle_subscriptions');
console.log('\nDone.');

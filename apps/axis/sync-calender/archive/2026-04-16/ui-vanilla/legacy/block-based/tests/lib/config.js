import 'dotenv/config';

function required(key, note) {
  const val = process.env[key];
  if (!val) {
    const hint = note ? ` (${note})` : '';
    throw new Error(`Missing required env var: ${key}${hint}`);
  }
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

export function loadTestConfig() {
  return {
    signingSecret: required('MONDAY_SIGNING_SECRET', 'from Dev Center → Build → General settings'),
    mondayApiToken: required(
      'MONDAY_API_TOKEN',
      'your personal monday API token — used as shortLivedToken inside the outer JWT'
    ),
    appUrl: optional('TEST_APP_URL', 'https://live1-service-27549619-d2f728f4.us.monday.app'),
    channelId: required(
      'TEST_CHANNEL_ID',
      'channelId from a recent successful subscribe — grep logs for "subscribe complete"'
    ),
    boardId: Number(optional('TEST_BOARD_ID', '1953193772')),
    linkColumnId: optional('TEST_LINK_COLUMN_ID', 'link_mm2dfvy3'),
    dateColumnId: optional('TEST_DATE_COLUMN_ID', 'date_mkqwkw4q'),
    textColumnId: optional('TEST_TEXT_COLUMN_ID', 'text_mkqwc4p1'),
    appId: Number(optional('MONDAY_APP_ID', '11119011')),
    accountId: Number(optional('TEST_ACCOUNT_ID', '27549619')),
    userId: Number(optional('TEST_USER_ID', '71077014')),
  };
}

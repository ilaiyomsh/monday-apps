#!/usr/bin/env node
// Create the "App Lifecycle Events" monday board for telemetry-dashboard.
//
// Creates a PRIVATE board, the lifecycle columns, and one group per app slug,
// then prints the two env lines ready for `mapps code:env`:
//
//   LIFECYCLE_BOARD_ID=<id>
//   LIFECYCLE_BOARD_COLUMNS=<minified json>
//
// Usage:
//   node scripts/create-events-board.mjs [--name "App Lifecycle Events"] [--workspace <id>]
//
// Token resolution: MONDAY_API_TOKEN env var, else ~/.config/mapps/.mappsrc
// (JSON field `accessToken`). The token value is never printed.
//
// Progress goes to stderr; stdout carries ONLY the two env lines.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
const API_VERSION = '2026-04';

const APP_SLUGS = [
  'axis-day-off',
  'axis-planner',
  'axis-sync-calender',
  'axis-tracker',
  'deadline-confirm',
  'discussions',
  'team-people-column',
];

// key = LIFECYCLE_BOARD_COLUMNS json key; defaults only for the status column.
const COLUMNS = [
  { key: 'event_time', title: 'Event Time', type: 'date' },
  {
    key: 'category',
    title: 'Category',
    type: 'status',
    defaults: { labels: { 1: 'Lifecycle', 2: 'Install', 3: 'Subscription' } },
  },
  { key: 'event_type', title: 'Event Type', type: 'text' },
  { key: 'app', title: 'App', type: 'text' },
  { key: 'feature', title: 'Feature', type: 'text' },
  { key: 'account_id', title: 'Account ID', type: 'text' },
  { key: 'user_id', title: 'User ID', type: 'text' },
  { key: 'details', title: 'Details', type: 'long_text' },
  { key: 'event_id', title: 'Event ID', type: 'text' },
];

const HELP = `create-events-board.mjs — create the App Lifecycle Events board

Usage:
  node scripts/create-events-board.mjs [options]

Options:
  --name <name>        Board name (default: "App Lifecycle Events")
  --workspace <id>     Numeric workspace id to create the board in (optional)
  --help               Show this help

Token: MONDAY_API_TOKEN env var, else accessToken from ~/.config/mapps/.mappsrc.

Prints (stdout, ready for mapps code:env):
  LIFECYCLE_BOARD_ID=<board id>
  LIFECYCLE_BOARD_COLUMNS=<minified json: {"event_time":"<col id>",...}>
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

async function graphql(token, query, variables = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
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

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string', default: 'App Lifecycle Events' },
      workspace: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.workspace && !/^\d+$/.test(values.workspace)) {
    console.error(`--workspace must be a numeric id, got: ${values.workspace}`);
    process.exit(1);
  }

  const token = resolveToken();
  if (!token) {
    console.error('missing token: set MONDAY_API_TOKEN or run `mapps init -t <token>` first');
    process.exit(1);
  }

  // 1. Board (private).
  const workspaceArg = values.workspace ? `, workspace_id: ${values.workspace}` : '';
  const createBoard = `mutation CreateBoard($name: String!) {
    create_board(board_name: $name, board_kind: private${workspaceArg}) { id }
  }`;
  console.error(`creating private board "${values.name}"${values.workspace ? ` in workspace ${values.workspace}` : ''}…`);
  const boardData = await graphql(token, createBoard, { name: values.name });
  const boardId = boardData.create_board?.id;
  if (!boardId) throw new Error('create_board returned no id');
  console.error(`board created: ${boardId}`);

  // 2. Columns.
  const createColumn = `mutation CreateColumn($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) {
    create_column(board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) { id }
  }`;
  const columnIds = {};
  for (const col of COLUMNS) {
    const data = await graphql(token, createColumn, {
      boardId,
      title: col.title,
      columnType: col.type,
      defaults: col.defaults ? JSON.stringify(col.defaults) : null,
    });
    const colId = data.create_column?.id;
    if (!colId) throw new Error(`create_column returned no id for "${col.title}"`);
    columnIds[col.key] = colId;
    console.error(`column created: ${col.key} (${col.type}) → ${colId}`);
  }

  // 3. One group per app slug.
  const createGroup = `mutation CreateGroup($boardId: ID!, $groupName: String!) {
    create_group(board_id: $boardId, group_name: $groupName) { id }
  }`;
  for (const slug of APP_SLUGS) {
    const data = await graphql(token, createGroup, { boardId, groupName: slug });
    console.error(`group created: ${slug} → ${data.create_group?.id ?? '?'}`);
  }

  // 4. The two env lines — stdout only, ready for mapps code:env.
  console.log(`LIFECYCLE_BOARD_ID=${boardId}`);
  console.log(`LIFECYCLE_BOARD_COLUMNS=${JSON.stringify(columnIds)}`);
}

main().catch((err) => {
  console.error(`create-events-board failed: ${err.message}`);
  process.exit(1);
});

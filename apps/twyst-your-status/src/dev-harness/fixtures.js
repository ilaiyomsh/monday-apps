// SOURCE: dev-harness fixture shapes assembled from real monday SDK payloads
// observed across apps/discussions and apps/Axis (tracker/Planner/Day-off).
// Copied verbatim into scaffolded apps (no template placeholders) so vite,
// vitest and plain `node` can import it directly.
//
// Every fixture mirrors the REAL shape monday-sdk-js delivers (res.data is the
// payload; ids are numbers for boardId/itemId but strings for user/account ids,
// exactly as the live SDK sends them). Do not "clean up" these shapes ג€” tests
// that pass against tidied mocks fail against the live iframe.

export const USERS = [
  { id: '11111111', name: '׳™׳“׳™׳“׳™׳” ׳›׳”׳', photo_url: { thumb: null } },
  { id: '22222222', name: '׳ ׳•׳¢׳” ׳׳•׳™', photo_url: { thumb: null } },
  { id: '33333333', name: 'Dana Fischer', photo_url: { thumb: null } },
];

const USER_BASE = {
  id: '11111111',
  name: '׳™׳“׳™׳“׳™׳” ׳›׳”׳',
  isAdmin: true,
  isGuest: false,
  isViewOnly: false,
  countryCode: 'IL',
  currentLanguage: 'he',
  timeFormat: '24H',
  timeZoneOffset: 3,
};

const ACCOUNT = { id: '9999999' };

const COMMON = {
  theme: 'light',
  user: USER_BASE,
  account: ACCOUNT,
  app: { id: 11775054, clientId: 'dev-harness' },
  appVersion: { versionData: { major: 2, minor: 1, patch: 0 } },
  instanceId: 55555555,
  instanceType: 'board_view',
};

// One context fixture per scaffold feature type. `placement` only exists for
// column_view (columnPickers vs settings ג€” settings has NO itemId, exactly like
// production).
export const CONTEXTS = {
  board_view: {
    ...COMMON,
    instanceType: 'board_view',
    boardId: 1234567890,
    boardIds: [1234567890],
    workspaceId: 7654321,
    viewMode: 'fullScreen',
  },
  item_view: {
    ...COMMON,
    instanceType: 'item_view',
    boardId: 1234567890,
    itemId: 2222222222,
    workspaceId: 7654321,
  },
  dashboard_widget: {
    ...COMMON,
    instanceType: 'dashboard_widget',
    boardIds: [1234567890, 1234567891],
    widgetId: 33333333,
  },
  column_view_click: {
    ...COMMON,
    instanceType: 'column_view',
    placement: 'columnPickers',
    boardId: 1234567890,
    itemId: 2222222222,
    selectedItemIds: [2222222222],
    columnId: 'status',
    columnType: 'color',
  },
  column_view_settings: {
    ...COMMON,
    instanceType: 'column_view',
    placement: 'settings',
    boardId: 1234567890,
    columnId: 'status',
    columnType: 'color',
    // NOTE: no itemId here ג€” production settings placement never has one.
  },
};

export const THEMES = ['light', 'dark', 'night', 'black'];

// Role presets for harness.setUser(role).
export const ROLES = {
  admin: { isAdmin: true, isGuest: false, isViewOnly: false },
  member: { isAdmin: false, isGuest: false, isViewOnly: false },
  viewer: { isAdmin: false, isGuest: false, isViewOnly: true },
  guest: { isAdmin: false, isGuest: true, isViewOnly: false },
};

// Default GraphQL responses served by the stub's api() for common starter
// queries. Keyed by a substring matched against the query text.
const STATUS_GUARD_LABELS = [
  { id: 0, color: 0, label: 'ממתין', index: 0, is_done: false, is_deactivated: false, hex: '#fdab3d' },
  { id: 1, color: 1, label: 'מאושר אוטומטית', index: 1, is_done: true, is_deactivated: false, hex: '#00c875' },
  { id: 2, color: 2, label: 'נדחה', index: 2, is_done: false, is_deactivated: false, hex: '#df2f4a' },
];

const STATUS_GUARD_COLUMN = {
  id: 'status',
  title: 'סטטוס',
  type: 'status',
  settings: { labels: STATUS_GUARD_LABELS },
};

// App-specific responses mirror src/test-utils/probes/status-column-context.json,
// captured from a disposable WZ- board on 2026-07-27.
export const API_FIXTURES = [
  {
    match: 'UpdateStatusColumnValue',
    data: { change_column_value: { id: '2222222222' } },
  },
  {
    match: 'GetStatusColumnSettings',
    data: {
      boards: [{ id: '1234567890', columns: [STATUS_GUARD_COLUMN] }],
    },
  },
  {
    match: 'GetStatusColumnContext',
    data: {
      boards: [{ id: '1234567890', columns: [STATUS_GUARD_COLUMN] }],
      items: [
        {
          id: '2222222222',
          name: 'משימת דמו',
          column_values: [
            {
              id: 'status',
              type: 'status',
              text: 'מאושר אוטומטית',
              value: '{"index":1}',
              index: 1,
              label: 'מאושר אוטומטית',
              is_done: true,
              label_style: { color: '#00c875', border: '#00b461' },
            },
          ],
        },
      ],
    },
  },
  {
    match: 'users',
    data: { users: USERS },
  },
  {
    match: 'items_page',
    data: {
      boards: [
        {
          id: '1234567890',
          name: '׳׳•׳— ׳“׳׳•',
          items_count: 2,
          items_page: {
            cursor: null,
            items: [
              {
                id: '2222222222',
                name: '׳׳©׳™׳׳” ׳¨׳׳©׳•׳ ׳”',
                state: 'active',
                group: { id: 'topics', title: '׳§׳‘׳•׳¦׳” ׳' },
                column_values: [
                  { id: 'status', type: 'status', text: '׳‘׳¢׳‘׳•׳“׳”', value: '{"index":0}' },
                  { id: 'person', type: 'people', text: '׳™׳“׳™׳“׳™׳” ׳›׳”׳', value: '{"personsAndTeams":[{"id":11111111,"kind":"person"}]}' },
                  { id: 'date4', type: 'date', text: '2026-07-15', value: '{"date":"2026-07-15"}' },
                ],
              },
              {
                id: '2222222223',
                name: '׳׳©׳™׳׳” ׳©׳ ׳™׳™׳”',
                state: 'active',
                group: { id: 'topics', title: '׳§׳‘׳•׳¦׳” ׳' },
                column_values: [
                  { id: 'status', type: 'status', text: '׳‘׳•׳¦׳¢', value: '{"index":1}' },
                  { id: 'person', type: 'people', text: '', value: null },
                  { id: 'date4', type: 'date', text: '', value: null },
                ],
              },
            ],
          },
        },
      ],
    },
  },
  {
    match: 'boards',
    data: {
      boards: [
        {
          id: '1234567890',
          name: '׳׳•׳— ׳“׳׳•',
          description: null,
          state: 'active',
          board_kind: 'public',
          columns: [
            { id: 'name', title: '׳©׳', type: 'name', settings: {} },
            { id: 'status', title: '׳¡׳˜׳˜׳•׳¡', type: 'status', settings: { labels: { 0: 'בעבודה', 1: 'בוצע', 2: 'תקוע' }, labels_colors: { 0: { color: '#fdab3d' }, 1: { color: '#00c875' }, 2: { color: '#e2445c' } } } },
            { id: 'person', title: '׳׳—׳¨׳׳™', type: 'people', settings: {} },
            { id: 'date4', title: '׳×׳׳¨׳™׳', type: 'date', settings: {} },
          ],
          groups: [{ id: 'topics', title: '׳§׳‘׳•׳¦׳” ׳', color: '#579bfc' }],
        },
      ],
    },
  },
  {
    match: 'items',
    data: {
      items: [
        {
          id: '2222222222',
          name: '׳׳©׳™׳׳” ׳¨׳׳©׳•׳ ׳”',
          board: { id: '1234567890', name: '׳׳•׳— ׳“׳׳•' },
          column_values: [
            { id: 'status', type: 'status', text: '׳‘׳¢׳‘׳•׳“׳”', value: '{"index":0}' },
          ],
          subitems: [],
        },
      ],
    },
  },
];

export const DEFAULT_SETTINGS = {
  // settings_version mirrors what a real widget/view settings payload carries.
  field_1: null,
};


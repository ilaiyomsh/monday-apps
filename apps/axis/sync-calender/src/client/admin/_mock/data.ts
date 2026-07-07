// In-memory mock state for the dev/mock harness. Persisted to localStorage
// under a single key so refreshes don't wipe the test scenario.
//
// This module never runs in production — it's only imported from main.tsx
// when `import.meta.env.VITE_MOCK === '1'`.

export interface MockState {
  objectId: string;
  boardId: string;
  me: { id: string; name: string; email: string; accountId: string };
  owners: string[];
  // Mock monday board columns. `settings` is a JSON scalar (parsed object)
  // matching the API 2026-04 Column.settings field.
  columns: Array<{
    id: string;
    title: string;
    type: string;
    settings?: Record<string, unknown>;
  }>;
  // Mock linked board items (for board_relation pickers)
  linkedBoards: Record<string, Array<{ id: string; name: string }>>;
  // Policy + config persisted by the mock fetch layer
  policy: unknown;
  configs: unknown[];
}

const STORAGE_KEY = '__sync_calender_mock_state_v2';

function defaultState(): MockState {
  const objectId = 'obj-mock-1';
  const boardId = 'board-mock-1';
  const meId = '111';
  const linkedBoardId = 'linked-board-1';

  const columns = [
    { id: 'name', title: 'Item', type: 'name' },
    { id: 'link_col', title: 'Event Link', type: 'link' },
    { id: 'date_col', title: 'Date', type: 'date' },
    { id: 'people_col', title: 'People', type: 'people' },
    {
      id: 'status_col',
      title: 'Status',
      type: 'status',
      settings: {
        labels: [
          { id: 1, color: 1, label: 'To do', index: 0, is_done: false, is_deactivated: false, hex: '#c4c4c4' },
          { id: 7, color: 7, label: 'In progress', index: 1, is_done: false, is_deactivated: false, hex: '#fdab3d' },
          { id: 9, color: 9, label: 'Done', index: 2, is_done: true, is_deactivated: false, hex: '#00c875' },
          { id: 12, color: 12, label: 'Blocked', index: 3, is_done: false, is_deactivated: false, hex: '#e2445c' },
        ],
      },
    },
    {
      id: 'project_col',
      title: 'Project',
      type: 'board_relation',
      settings: { boardIds: [linkedBoardId], allowCreateReflectionColumn: false },
    },
    {
      id: 'priority_col',
      title: 'Priority',
      type: 'status',
      settings: {
        labels: [
          { id: 2, color: 2, label: 'Low', index: 0, is_done: false, is_deactivated: false, hex: '#c4c4c4' },
          { id: 4, color: 4, label: 'Medium', index: 1, is_done: false, is_deactivated: false, hex: '#fdab3d' },
          { id: 8, color: 8, label: 'High', index: 2, is_done: false, is_deactivated: false, hex: '#e2445c' },
          { id: 11, color: 11, label: 'Critical', index: 3, is_done: false, is_deactivated: false, hex: '#784bd1' },
        ],
      },
    },
    { id: 'notes_col', title: 'Notes', type: 'long_text' },
  ];

  const linkedBoards: Record<string, Array<{ id: string; name: string }>> = {
    [linkedBoardId]: [
      { id: '1001', name: 'Project Alpha' },
      { id: '1002', name: 'Project Beta' },
      { id: '1003', name: 'Project Gamma' },
      { id: '1004', name: 'Internal R&D' },
      { id: '1005', name: 'Client: Acme Corp' },
    ],
  };

  const now = Date.now();
  const policy = {
    objectId,
    accountId: '999',
    ownerUserId: meId,
    verifiedOwnerIds: [meId],
    workspaceId: null,
    boardId,
    linkColumnId: 'link_col',
    peopleColumnId: 'people_col',
    itemNameSource: 'eventName',
    columnMapping: {
      date_col: { type: 'date', source: 'startDate' },
      notes_col: {
        type: 'long_text',
        tokens: [{ kind: 'var', value: 'description' }],
      },
    },
    conditionalEligibleColumns: ['status_col', 'project_col'],
    createdAt: now,
    updatedAt: now,
  };

  const myConfig = {
    configId: 'config-mock-me',
    accountId: '999',
    objectId,
    userId: meId,
    workspaceId: null,
    googleUserEmail: 'alice@example.com',
    hasGoogleConnection: true,
    hasMondayConnection: true,
    status: 'active',
    lastSyncAt: now - 60_000,
    lastError: null,
    conditionals: [],
    createdAt: now,
    updatedAt: now,
  };

  return {
    objectId,
    boardId,
    me: { id: meId, name: 'Alice Owner', email: 'alice@example.com', accountId: '999' },
    owners: [meId],
    columns,
    linkedBoards,
    policy,
    configs: [myConfig],
  };
}

export function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const fresh = defaultState();
  saveState(fresh);
  return fresh;
}

export function saveState(s: MockState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function resetState(): MockState {
  const fresh = defaultState();
  saveState(fresh);
  return fresh;
}

// Single shared reference the SDK + fetch mocks both read/write. Lazily
// initialized — must call initMockState() from install.ts before any mock
// consumer reads it.
export const state = {} as MockState;

export function initMockState() {
  Object.assign(state, loadState());
  if (typeof window !== 'undefined') {
    (window as unknown as { __mock: unknown }).__mock = {
      state,
      save: () => saveState(state),
      reset: () => {
        const next = resetState();
        Object.assign(state, next);
        location.reload();
      },
    };
  }
}

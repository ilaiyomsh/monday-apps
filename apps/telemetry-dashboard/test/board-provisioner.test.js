// Contract tests for src/services/board-provisioner.js — the in-app board
// provisioning flow (POST /api/settings/board). Under test: a PRIVATE board is
// created, all 9 board-schema columns are created (in order, status defaults
// forwarded), the board's first/default group becomes the single events group,
// the assembled config is persisted via storage.setBoardConfig, and — unlike
// the webhook path — failures PROPAGATE (after logging) so the route reports
// them. mondayApi/storage/logger are injected fakes — zero network.

import { describe, it, expect, vi } from 'vitest';
import { createBoardProvisioner } from '../src/services/board-provisioner.js';
import { BOARD_COLUMNS, DEFAULT_BOARD_NAME } from '../src/services/board-schema.js';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeMondayApi(overrides = {}) {
  let n = 0;
  return {
    createBoard: vi.fn(async () => ({ id: 'board-77', groups: [{ id: 'grp-default', title: 'Group Title' }] })),
    // Each column gets a deterministic distinct id: col_0, col_1, …
    createColumn: vi.fn(async () => `col_${n++}`),
    ...overrides,
  };
}

function makeStorage(overrides = {}) {
  return { setBoardConfig: vi.fn(async () => {}), ...overrides };
}

function make({ mondayApi = makeMondayApi(), storage = makeStorage(), logger = makeLogger() } = {}) {
  return { mondayApi, storage, logger, provisioner: createBoardProvisioner({ mondayApi, storage, logger }) };
}

describe('board-provisioner — happy path', () => {
  it('creates a private board, all 9 columns in schema order, and persists the config', async () => {
    const { provisioner, mondayApi, storage } = make();

    const config = await provisioner.provision();

    // Private board with the default name.
    expect(mondayApi.createBoard).toHaveBeenCalledWith({
      name: DEFAULT_BOARD_NAME,
      kind: 'private',
      workspaceId: null,
    });

    // One createColumn per schema column, in order, with title/type/defaults.
    expect(mondayApi.createColumn).toHaveBeenCalledTimes(BOARD_COLUMNS.length);
    BOARD_COLUMNS.forEach((col, i) => {
      expect(mondayApi.createColumn.mock.calls[i][0]).toEqual({
        boardId: 'board-77',
        title: col.title,
        columnType: col.type,
        defaults: col.defaults ?? null,
      });
    });

    // Config: board id, the default group as the single group, full column map.
    const expectedColumns = {};
    BOARD_COLUMNS.forEach((col, i) => {
      expectedColumns[col.key] = `col_${i}`;
    });
    expect(config).toEqual({ boardId: 'board-77', groupId: 'grp-default', columns: expectedColumns });
    expect(storage.setBoardConfig).toHaveBeenCalledWith(config);
  });

  it('forwards a custom name and workspaceId', async () => {
    const { provisioner, mondayApi } = make();

    await provisioner.provision({ name: '  My Events  ', workspaceId: 9 });

    expect(mondayApi.createBoard).toHaveBeenCalledWith({
      name: 'My Events', // trimmed
      kind: 'private',
      workspaceId: 9,
    });
  });

  it('stores groupId null when the new board reports no groups (item lands in default group)', async () => {
    const mondayApi = makeMondayApi({
      createBoard: vi.fn(async () => ({ id: 'b1', groups: [] })),
    });
    const { provisioner, storage } = make({ mondayApi });

    const config = await provisioner.provision();

    expect(config.groupId).toBeNull();
    expect(storage.setBoardConfig).toHaveBeenCalledWith(expect.objectContaining({ groupId: null }));
  });
});

describe('board-provisioner — failures propagate (after logging)', () => {
  it('rethrows and does NOT persist when createBoard fails', async () => {
    const mondayApi = makeMondayApi({
      createBoard: vi.fn(async () => {
        throw new Error('monday API HTTP 500');
      }),
    });
    const { provisioner, storage, logger } = make({ mondayApi });

    await expect(provisioner.provision()).rejects.toThrow('monday API HTTP 500');
    expect(storage.setBoardConfig).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('board_provision_failed', 'board_provisioner', expect.any(Object));
  });

  it('rethrows when a column create fails partway through', async () => {
    let n = 0;
    const mondayApi = makeMondayApi({
      createColumn: vi.fn(async () => {
        if (n++ === 3) throw new Error('budget exhausted');
        return `col_${n}`;
      }),
    });
    const { provisioner, storage } = make({ mondayApi });

    await expect(provisioner.provision()).rejects.toThrow('budget exhausted');
    expect(storage.setBoardConfig).not.toHaveBeenCalled();
  });

  it('preserves the no_write_token code so the route can map it to a 409', async () => {
    const err = Object.assign(new Error('no_write_token'), { code: 'no_write_token' });
    const mondayApi = makeMondayApi({ createBoard: vi.fn(async () => { throw err; }) });
    const { provisioner } = make({ mondayApi });

    await expect(provisioner.provision()).rejects.toMatchObject({ code: 'no_write_token' });
  });
});

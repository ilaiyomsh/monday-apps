import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncAndPersistPersonalTypes,
  MissingStatusColumnRevisionError,
} from '../components/Settings/SettingsDialog';
import { mondayApi } from '../services/mondayApi';
import { isPersonalTypeLabelInUse, PersonalTypeInUseError } from '../services/vacationService';
import { DEFAULT_SETTINGS } from '../types';
import type { DayOffSettings, PersonalTypeOption } from '../types';

/**
 * error-guard: the plain `throw new Error('Missing status column revision')`
 * (SettingsDialog.tsx:261, pre-fix) shipped to Axiom with no identity — every
 * occurrence looked the same as any other unlabeled Error. This locks the fixed
 * contract: the thrown error is a named class with a stable `code`, so the
 * shipped record is filterable (err_name/err_code, see error-kit's axiomSink).
 *
 * Also characterizes the surrounding sync/diff logic (extracted to module scope
 * from a component-local useCallback so it is unit-testable) to guard the
 * extraction didn't change behavior — in particular the PersonalTypeInUseError
 * path that day-off's SettingsDialog.onSave relies on to display inline instead
 * of rethrowing to the shell.
 */

vi.mock('../services/mondayApi', () => ({
  mondayApi: {
    getStatusColumnSnapshotMeta: vi.fn(),
    getStatusColumnSnapshot: vi.fn(),
    updateStatusColumnSettings: vi.fn(),
  },
}));

vi.mock('../services/vacationService', async () => {
  const actual = await vi.importActual<typeof import('../services/vacationService')>(
    '../services/vacationService',
  );
  return {
    ...actual,
    isPersonalTypeLabelInUse: vi.fn(),
  };
});

vi.mock('../core', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getMetaMock = vi.mocked(mondayApi.getStatusColumnSnapshotMeta);
const getSnapshotMock = vi.mocked(mondayApi.getStatusColumnSnapshot);
const updateMock = vi.mocked(mondayApi.updateStatusColumnSettings);
const inUseMock = vi.mocked(isPersonalTypeLabelInUse);

const label = (over: Partial<PersonalTypeOption> = {}): PersonalTypeOption => ({
  id: '1',
  title: 'Reserves',
  color: '#000',
  colorValue: 0,
  index: 0,
  ...over,
});

function settingsWith(over: Partial<DayOffSettings>): DayOffSettings {
  return {
    ...DEFAULT_SETTINGS,
    vacationBoardId: 'board-1',
    columns: { ...DEFAULT_SETTINGS.columns, personalTypeColumnId: 'ptype' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncAndPersistPersonalTypes', () => {
  it('throws a named, coded MissingStatusColumnRevisionError when the live snapshot has no revision', async () => {
    getMetaMock.mockResolvedValue({ labels: [], revision: undefined });
    const next = settingsWith({ personalTypes: [label()] }); // edited != live([]) -> not isSame

    const err = await syncAndPersistPersonalTypes(next).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingStatusColumnRevisionError);
    expect(err).toMatchObject({
      name: 'MissingStatusColumnRevisionError',
      code: 'MISSING_STATUS_COLUMN_REVISION',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rethrows PersonalTypeInUseError for a deactivated label still referenced on the board', async () => {
    const live = [label({ id: '9', title: 'Old' })];
    getMetaMock.mockResolvedValue({ labels: live, revision: 'rev-1' });
    inUseMock.mockResolvedValue(true);
    // edited is empty -> "Old" (id 9) is deactivated and checked for use.
    const next = settingsWith({ personalTypes: [] });

    await expect(syncAndPersistPersonalTypes(next)).rejects.toBeInstanceOf(PersonalTypeInUseError);
    expect(inUseMock).toHaveBeenCalledWith('board-1', 'ptype', '9');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('skips the write and returns the live snapshot when the draft already matches', async () => {
    const live = [label()];
    getMetaMock.mockResolvedValue({ labels: live, revision: 'rev-1' });
    const next = settingsWith({ personalTypes: [label()] });

    const result = await syncAndPersistPersonalTypes(next);

    expect(updateMock).not.toHaveBeenCalled();
    expect(getSnapshotMock).not.toHaveBeenCalled();
    expect(result.personalTypes).toEqual(live);
  });

  it('writes the diffed labels and returns a fresh snapshot when the draft changed', async () => {
    const live = [label({ id: '1', title: 'Reserves' })];
    getMetaMock.mockResolvedValue({ labels: live, revision: 'rev-1' });
    getSnapshotMock.mockResolvedValue([label({ id: '1', title: 'Reserves (renamed)' })]);
    const next = settingsWith({ personalTypes: [label({ id: '1', title: 'Reserves (renamed)' })] });

    const result = await syncAndPersistPersonalTypes(next);

    expect(updateMock).toHaveBeenCalledWith('board-1', 'ptype', 'rev-1', expect.any(Array), expect.any(Set));
    expect(result.personalTypes).toEqual([label({ id: '1', title: 'Reserves (renamed)' })]);
  });
});

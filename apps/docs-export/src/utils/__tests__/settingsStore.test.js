/**
 * settingsStore — monday.storage persistence for the settings blob.
 *
 * Two live-verified quirks drive most of these tests:
 *   1. A configured instance can transiently read back `success:true, value:null`.
 *      Trusting that first null once shipped an onboarding wizard to instances
 *      that were already configured (Axis Planner incident). The dev harness
 *      reproduces it via failures.storageFalseEmptyFirstRead.
 *   2. `monday.storage.setItem` can RESOLVE even when the write did not persist,
 *      so a save is only confirmed by reading it back.
 * Plus: loading must NEVER throw (it gates render) and must fall back
 * instanceId → boardId → 'default', because a board_view's instanceId is the
 * boardViewId and older blobs were written under the boardId.
 *
 * Storage runs against the real dev-harness SDK stub (shared `harness` state),
 * not a hand-written mock — the response ENVELOPES are what this module parses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { harness } from 'monday-sdk-js';
import { monday } from '../../services/monday-sdk';
import logger from '../logger';
import {
  loadSettings,
  saveSettings,
  settingsKeyCandidates,
  SETTINGS_KEY_BASE,
  __clearMemoryCache,
} from '../settingsStore';

const CONTEXT = { instanceId: 55555555, boardId: 1234567890 };
const KEY = 'global:docs_export_settings_55555555';
const BOARD_KEY = 'global:docs_export_settings_1234567890';
const DEFAULT_KEY = 'global:docs_export_settings_default';

const SETTINGS = {
  version: 1,
  boardId: '18424252636',
  columns: { action: 'wzaction', committee: 'wzmirror', report: 'wzreport', date: 'wzdate', person: 'wzpeople' },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [{ id: 'b1', type: 'text', text: 'שלום' }, { id: 'b2', type: 'table' }],
};

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
  __clearMemoryCache();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settingsKeyCandidates', () => {
  it('prefers the instance key, then the board key, then default', () => {
    expect(settingsKeyCandidates(CONTEXT)).toEqual([
      `${SETTINGS_KEY_BASE}_55555555`,
      `${SETTINGS_KEY_BASE}_1234567890`,
      `${SETTINGS_KEY_BASE}_default`,
    ]);
  });

  it('de-duplicates when instanceId and boardId are the same value', () => {
    expect(settingsKeyCandidates({ instanceId: 7, boardId: 7 })).toEqual([
      `${SETTINGS_KEY_BASE}_7`,
      `${SETTINGS_KEY_BASE}_default`,
    ]);
  });

  it('falls back to the default key alone for an empty context', () => {
    expect(settingsKeyCandidates({})).toEqual([`${SETTINGS_KEY_BASE}_default`]);
    expect(settingsKeyCandidates(undefined)).toEqual([`${SETTINGS_KEY_BASE}_default`]);
  });
});

describe('loadSettings', () => {
  it('reads the blob stored under the instance key', async () => {
    harness.seedStorage(KEY, SETTINGS);

    await expect(loadSettings(CONTEXT)).resolves.toEqual(SETTINGS);
  });

  it('falls back to the boardId key when the instance key holds nothing', async () => {
    harness.seedStorage(BOARD_KEY, SETTINGS);

    await expect(loadSettings(CONTEXT)).resolves.toEqual(SETTINGS);
  });

  it('falls back to the default key last', async () => {
    harness.seedStorage(DEFAULT_KEY, SETTINGS);

    await expect(loadSettings(CONTEXT)).resolves.toEqual(SETTINGS);
  });

  it('prefers the instance key over the board key when BOTH exist', async () => {
    harness.seedStorage(KEY, SETTINGS);
    harness.seedStorage(BOARD_KEY, { ...SETTINGS, boardId: 'STALE' });

    await expect(loadSettings(CONTEXT)).resolves.toMatchObject({ boardId: '18424252636' });
  });

  it('survives the false-empty first read instead of reporting an unconfigured instance', async () => {
    harness.seedStorage(KEY, SETTINGS);
    harness.failures.storageFalseEmptyFirstRead = true;

    await expect(loadSettings(CONTEXT)).resolves.toEqual(SETTINGS);
  });

  it('returns null when nothing is stored under any candidate key', async () => {
    await expect(loadSettings(CONTEXT)).resolves.toBe(null);
  });

  it('returns null and LOGS when the stored value is corrupt JSON', async () => {
    harness.seedStorage(KEY, '{not json');
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(loadSettings(CONTEXT)).resolves.toBe(null);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws when storage itself fails — it warns and reports no settings', async () => {
    vi.spyOn(monday.storage, 'getItem').mockRejectedValue(new Error('storage unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(loadSettings(CONTEXT)).resolves.toBe(null);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when monday answers success:false', async () => {
    vi.spyOn(monday.storage, 'getItem').mockResolvedValue({ data: { success: false, error: 'nope' } });
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(loadSettings(CONTEXT)).resolves.toBe(null);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('saveSettings', () => {
  it('merges the partial over the stored blob, deep-merging role maps and replacing blocks', async () => {
    harness.seedStorage(KEY, SETTINGS);

    const merged = await saveSettings(CONTEXT, {
      columns: { committee: 'wzmirror2' },
      blocks: [{ id: 'b9', type: 'table' }],
    });

    expect(merged.columns).toEqual({
      action: 'wzaction',
      committee: 'wzmirror2',
      report: 'wzreport',
      date: 'wzdate',
      person: 'wzpeople',
    });
    expect(merged.blocks).toEqual([{ id: 'b9', type: 'table' }]);
    expect(merged.weekStartsOn).toBe(0);
    expect(JSON.parse(harness.readStorage(KEY))).toEqual(merged);
  });

  it('writes to the PRIMARY key even when the blob was loaded from the board fallback', async () => {
    harness.seedStorage(BOARD_KEY, SETTINGS);

    await saveSettings(CONTEXT, { weekStartsOn: 1 });

    expect(JSON.parse(harness.readStorage(KEY)).weekStartsOn).toBe(1);
    // the stale fallback copy is left alone rather than silently rewritten
    expect(JSON.parse(harness.readStorage(BOARD_KEY)).weekStartsOn).toBe(0);
  });

  it('persists a first-ever save when nothing is stored yet', async () => {
    const saved = await saveSettings(CONTEXT, { boardId: '18424252636' });

    expect(saved).toEqual({ boardId: '18424252636' });
    expect(JSON.parse(harness.readStorage(KEY))).toEqual({ boardId: '18424252636' });
  });

  it('throws and logs when the write RESOLVES but did not persist (read-back mismatch)', async () => {
    // the live quirk: setItem answers success without storing anything
    vi.spyOn(monday.storage, 'setItem').mockResolvedValue({ data: { success: true, version: 3 } });
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(saveSettings(CONTEXT, { weekStartsOn: 1 })).rejects.toThrow(/did not persist/i);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('throws and logs when monday reports the write failed in-band', async () => {
    vi.spyOn(monday.storage, 'setItem').mockResolvedValue({ data: { success: false }, errorMessage: 'quota' });
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(saveSettings(CONTEXT, { weekStartsOn: 1 })).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('degrades to memory with a warning (never throws) when there is no instance at all', async () => {
    vi.spyOn(monday.storage, 'setItem').mockRejectedValue(new Error('storage unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn');

    const saved = await saveSettings({}, { weekStartsOn: 1 });

    expect(saved).toEqual({ weekStartsOn: 1 });
    expect(warnSpy).toHaveBeenCalled();
    // the in-memory value is what the next load in this session sees
    await expect(loadSettings({})).resolves.toEqual({ weekStartsOn: 1 });
  });
});

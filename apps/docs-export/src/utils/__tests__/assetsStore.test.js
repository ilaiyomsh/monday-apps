/**
 * assetsStore — the uploaded .docx template, deliberately kept under its OWN
 * monday.storage key.
 *
 * The split is not cosmetic: the settings blob is read on every boot and gates
 * render, so hundreds of KB of template bytes must never travel with it. These
 * tests pin the split (a distinct key), the 6MB budget (monday's per-object cap
 * is ~6MB, and exceeding it is rejected BEFORE the write with a Hebrew message
 * the owner can act on), and the same two storage quirks the settings store
 * faces: the false-empty first read, and a setItem that resolves without
 * persisting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { harness } from 'monday-sdk-js';
import { monday } from '../../services/monday-sdk';
import logger from '../logger';
import {
  loadTemplate,
  saveTemplate,
  assetsKeyCandidates,
  TEMPLATE_MAX_BYTES,
  ASSETS_KEY_BASE,
  __clearMemoryCache,
} from '../assetsStore';

const CONTEXT = { instanceId: 55555555, boardId: 1234567890 };
const KEY = 'global:docs_export_assets_55555555';
const BOARD_KEY = 'global:docs_export_assets_1234567890';

// A .docx is delivered to the store as base64 (no data: prefix).
const TEMPLATE_B64 = 'UEsDBBQABgAIAAAAIQDfpNJsWgEAACAFAAATAAgCW0NvbnRlbnRfVHlwZXNd';

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

describe('assetsKeyCandidates', () => {
  it('uses its own key base, never the settings one', () => {
    expect(ASSETS_KEY_BASE).toBe('docs_export_assets');
    expect(assetsKeyCandidates(CONTEXT)).toEqual([
      `${ASSETS_KEY_BASE}_55555555`,
      `${ASSETS_KEY_BASE}_1234567890`,
      `${ASSETS_KEY_BASE}_default`,
    ]);
  });
});

describe('saveTemplate / loadTemplate', () => {
  it('round-trips the base64 through its own storage key', async () => {
    await expect(saveTemplate(CONTEXT, TEMPLATE_B64)).resolves.toBe(TEMPLATE_B64);

    expect(JSON.parse(harness.readStorage(KEY))).toEqual({ templateDocx: TEMPLATE_B64 });
    expect(harness.readStorage('global:docs_export_settings_55555555')).toBe(null);
    await expect(loadTemplate(CONTEXT)).resolves.toBe(TEMPLATE_B64);
  });

  it('clears the template when passed null or an empty string', async () => {
    await saveTemplate(CONTEXT, TEMPLATE_B64);

    await expect(saveTemplate(CONTEXT, null)).resolves.toBe(null);
    expect(JSON.parse(harness.readStorage(KEY))).toEqual({ templateDocx: null });
    await expect(loadTemplate(CONTEXT)).resolves.toBe(null);

    await saveTemplate(CONTEXT, TEMPLATE_B64);
    await expect(saveTemplate(CONTEXT, '')).resolves.toBe(null);
  });

  it('reads a template written under the boardId key (fallback)', async () => {
    harness.seedStorage(BOARD_KEY, { templateDocx: TEMPLATE_B64 });

    await expect(loadTemplate(CONTEXT)).resolves.toBe(TEMPLATE_B64);
  });

  it('survives the false-empty first read', async () => {
    harness.seedStorage(KEY, { templateDocx: TEMPLATE_B64 });
    harness.failures.storageFalseEmptyFirstRead = true;

    await expect(loadTemplate(CONTEXT)).resolves.toBe(TEMPLATE_B64);
  });

  it('returns null when no template was ever uploaded', async () => {
    await expect(loadTemplate(CONTEXT)).resolves.toBe(null);
  });

  it('returns null and warns (never throws) when storage fails', async () => {
    vi.spyOn(monday.storage, 'getItem').mockRejectedValue(new Error('storage unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(loadTemplate(CONTEXT)).resolves.toBe(null);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null and LOGS when the stored assets blob is corrupt', async () => {
    harness.seedStorage(KEY, '{not json');
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(loadTemplate(CONTEXT)).resolves.toBe(null);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the 6MB budget', () => {
  it('rejects an over-budget template BEFORE writing, with code "quota" and a Hebrew message', async () => {
    const setSpy = vi.spyOn(monday.storage, 'setItem');
    const tooBig = 'A'.repeat(TEMPLATE_MAX_BYTES + 1);

    let caught;
    try {
      await saveTemplate(CONTEXT, tooBig);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBe('quota');
    expect(caught.message).toContain('6MB');
    expect(caught.message).toMatch(/[֐-׿]/); // Hebrew, shown to the owner as-is
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('accepts a template sitting exactly ON the limit', async () => {
    const exact = 'A'.repeat(TEMPLATE_MAX_BYTES);

    await expect(saveTemplate(CONTEXT, exact)).resolves.toBe(exact);
    expect(TEMPLATE_MAX_BYTES).toBe(6 * 1024 * 1024);
  });
});

describe('write verification', () => {
  it('throws and logs when setItem resolves but the bytes did not persist', async () => {
    vi.spyOn(monday.storage, 'setItem').mockResolvedValue({ data: { success: true, version: 2 } });
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(saveTemplate(CONTEXT, TEMPLATE_B64)).rejects.toThrow(/did not persist/i);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('degrades to memory with a warning (never throws) when there is no instance at all', async () => {
    vi.spyOn(monday.storage, 'setItem').mockRejectedValue(new Error('storage unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(saveTemplate({}, TEMPLATE_B64)).resolves.toBe(TEMPLATE_B64);
    expect(warnSpy).toHaveBeenCalled();
    await expect(loadTemplate({})).resolves.toBe(TEMPLATE_B64);
  });
});

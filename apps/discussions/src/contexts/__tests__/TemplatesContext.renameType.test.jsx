import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round304 — renaming a discussion type is a MULTI-STORE migration: the type's
 * name is the key of its template, its color, the assignment on standalone
 * topic/participant templates, and its export-assets storage key. If any of them
 * is missed the renamed template looks empty, colorless, or loses the header/footer
 * file it was set up with. This locks that all of them move together.
 */

const { storage } = vi.hoisted(() => ({
  storage: { getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  monday: { storage },
}));
vi.mock('../MondayContext.jsx', () => ({
  useMondayContext: () => ({ context: { instanceId: '7' } }),
}));

import { TemplatesProvider, useTemplates } from '../TemplatesContext.jsx';
import { typeExportAssetsKey, legacyTypeExportAssetsKey } from '../../utils/exportAssets.js';

const KEYS = {
  topics: 'discussions_templates_7',
  people: 'discussions_participant_templates_7',
  types: 'discussions_type_templates_7',
  colors: 'discussions_type_colors_7',
  // round360 — writes land on the digest key; the legacy %-encoded key is where a
  // pre-round360 account's data may still sit, so the seed uses it (proving the
  // rename migrates it forward too).
  assets: (name) => typeExportAssetsKey({ instanceId: '7' }, name),
  legacyAssets: (name) => legacyTypeExportAssetsKey({ instanceId: '7' }, name),
};

const stored = {};
const value = (v) => ({ data: { value: JSON.stringify(v) } });
const writeFor = (key) => storage.setItem.mock.calls.filter(([k]) => k === key).at(-1);

let ctx = null;
function Probe() {
  ctx = useTemplates();
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  ctx = null;
  Object.assign(stored, {
    [KEYS.topics]: { templates: [
      { id: 'T1', name: 'נושאים לסבב', discussionType: 'סבב', topics: [{ name: 'נ', points: [] }] },
      { id: 'T2', name: 'ללא שיוך', discussionType: null, topics: [{ name: 'מ', points: [] }] },
    ] },
    [KEYS.people]: { templates: [
      { id: 'P1', name: 'צוות סבב', discussionType: 'סבב', participants: [{ id: 'u1', name: 'א' }] },
    ] },
    [KEYS.types]: { templates: [
      { id: 'TT1', discussionType: 'סבב', topics: [{ name: 'נושא', points: ['נקודה'] }], participants: [], exportTemplate: { headerMode: 'upload' } },
      { id: 'TT2', discussionType: 'תכנון', topics: [], participants: [] },
    ] },
    [KEYS.colors]: { colors: { 'סבב': 'done-green', 'תכנון': 'purple' } },
    [KEYS.legacyAssets('סבב')]: { templateDocx: 'UEsDBBQ=' },
  });
  storage.getItem.mockImplementation(async (key) => (stored[key] ? value(stored[key]) : {}));
  // round358 — saves now VERIFY by reading the key back, so the mock has to echo
  // writes like real storage does; a write-blind getItem reads as a lost write and
  // fails the save (which is exactly the protection, but not what this file tests).
  storage.setItem.mockImplementation(async (key, val) => { stored[key] = JSON.parse(val); return { data: { success: true } }; });
  storage.deleteItem.mockResolvedValue({ success: true });

  render(<TemplatesProvider><Probe /></TemplatesProvider>);
  await waitFor(() => expect(ctx?.loading).toBe(false));
});

describe('TemplatesContext.renameDiscussionType', () => {
  it('re-keys the type template, its color, both assignment kinds, and moves the export assets', async () => {
    await act(async () => { await ctx.renameDiscussionType('סבב', 'סבב שבועי'); });

    // 1. the per-type template — moved, content intact, still ONE per type
    const types = JSON.parse(writeFor(KEYS.types)[1]).templates;
    expect(types.map((t) => t.discussionType)).toEqual(['סבב שבועי', 'תכנון']);
    expect(types[0].topics).toEqual([{ name: 'נושא', points: ['נקודה'] }]);
    expect(types[0].exportTemplate).toEqual({ headerMode: 'upload' });

    // 2. the color follows the name
    expect(JSON.parse(writeFor(KEYS.colors)[1]).colors).toEqual({ 'סבב שבועי': 'done-green', 'תכנון': 'purple' });

    // 3. standalone templates assigned to the type follow it
    expect(JSON.parse(writeFor(KEYS.topics)[1]).templates.map((t) => t.discussionType))
      .toEqual(['סבב שבועי', null]);
    expect(JSON.parse(writeFor(KEYS.people)[1]).templates[0].discussionType).toBe('סבב שבועי');

    // 4. the export brand file moves to the new name's digest key, and BOTH of the
    // old name's keys (digest + legacy) are dropped
    expect(JSON.parse(writeFor(KEYS.assets('סבב שבועי'))[1]).templateDocx).toBe('UEsDBBQ=');
    expect(storage.deleteItem).toHaveBeenCalledWith(KEYS.assets('סבב'));
    expect(storage.deleteItem).toHaveBeenCalledWith(KEYS.legacyAssets('סבב'));

    // and the in-memory store the UI reads is updated too
    await waitFor(() => expect(ctx.typeTemplates.map((t) => t.discussionType)).toEqual(['סבב שבועי', 'תכנון']));
  });

  it('writes nothing for a missing or unchanged name', async () => {
    await act(async () => {
      expect(await ctx.renameDiscussionType('סבב', 'סבב')).toBe(false);
      expect(await ctx.renameDiscussionType('', 'חדש')).toBe(false);
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.deleteItem).not.toHaveBeenCalled();
  });

  /*
   * PR review — the persist helpers normally swallow a storage failure (log + keep
   * the in-memory change). For a rename that is data loss: the monday label has
   * already changed, so a refresh comes back to data keyed by the old name. The
   * migration must therefore REJECT, and a retry must be able to finish the job.
   */
  it('REJECTS when a storage write fails, instead of reporting a successful rename', async () => {
    storage.setItem.mockRejectedValue(new Error('storage unavailable'));
    await act(async () => {
      await expect(ctx.renameDiscussionType('סבב', 'סבב שבועי'))
        .rejects.toMatchObject({ code: 'rename_store_failed' });
    });
  });

  it('a RETRY after such a failure re-flushes every store (the in-memory state is already migrated)', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await act(async () => {
      await expect(ctx.renameDiscussionType('סבב', 'סבב שבועי')).rejects.toBeTruthy();
    });
    storage.setItem.mockResolvedValue({ success: true });
    storage.setItem.mockClear();
    await act(async () => { await ctx.renameDiscussionType('סבב', 'סבב שבועי'); });
    // All four stores are written again — including the assignment stores, whose
    // content no longer "changes" on the retry but whose STORAGE is still stale.
    for (const key of [KEYS.types, KEYS.colors, KEYS.topics, KEYS.people]) {
      expect(writeFor(key), key).toBeTruthy();
    }
    expect(JSON.parse(writeFor(KEYS.types)[1]).templates.map((t) => t.discussionType))
      .toEqual(['סבב שבועי', 'תכנון']);
    expect(JSON.parse(writeFor(KEYS.topics)[1]).templates[0].discussionType).toBe('סבב שבועי');
  });

  it('does not touch templates of OTHER types (a rename is never a bulk edit)', async () => {
    await act(async () => { await ctx.renameDiscussionType('סבב', 'סבב שבועי'); });
    const types = JSON.parse(writeFor(KEYS.types)[1]).templates;
    const other = types.find((t) => t.discussionType === 'תכנון');
    expect(other.id).toBe('TT2');
    expect(JSON.parse(writeFor(KEYS.topics)[1]).templates[1].name).toBe('ללא שיוך');
  });
});

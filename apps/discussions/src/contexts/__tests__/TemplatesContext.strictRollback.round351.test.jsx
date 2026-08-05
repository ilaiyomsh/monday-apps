import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round351 (review finding, the last of the seeding chain) — a STRICT write that fails must ROLL
 * BACK the optimistic in-memory update.
 *
 * `persistTypes` commits to memory first and persists second, which is what makes a UI edit feel
 * instant. For a caller that ACTS on the result that order is a trap: the write rejects, the
 * template stays in memory anyway, and a retry in the SAME session sees it, concludes "already
 * there", and adds the type's dropdown label — while durable storage never got the agenda. After a
 * reload the owner can select "דיון כללי" and get an empty discussion.
 *
 * In user terms: the app wrote it on the whiteboard, failed to put it in the safe, and then trusted
 * the whiteboard.
 */

const { storage } = vi.hoisted(() => ({
  storage: { getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ monday: { storage } }));
vi.mock('../MondayContext.jsx', () => ({
  useMondayContext: () => ({ context: { instanceId: '7' } }),
}));

import { TemplatesProvider, useTemplates } from '../TemplatesContext.jsx';

const TYPES_KEY = 'discussions_type_templates_7';
const EXISTING = { id: 'T1', discussionType: 'הנהלה', topics: [{ name: 'נושא', points: [] }] };

let ctx = null;
function Probe() {
  ctx = useTemplates();
  return null;
}

const mount = async () => {
  render(<TemplatesProvider><Probe /></TemplatesProvider>);
  await waitFor(() => expect(ctx?.loading).toBe(false));
};

beforeEach(async () => {
  vi.clearAllMocks();
  ctx = null;
  storage.getItem.mockImplementation(async (key) => (
    key === TYPES_KEY
      ? { data: { value: JSON.stringify({ templates: [EXISTING] }) } }
      : { data: { value: null } }
  ));
  storage.setItem.mockImplementation(async () => ({}));
});

describe('round351 — a failed STRICT write leaves nothing behind in memory', () => {
  /*
   * The whole finding, observed where it is unambiguous: THE NEXT WRITE'S PAYLOAD.
   *
   * Every write is built from the in-memory list, so the list's real content shows up in what
   * gets persisted next. A follow-up write of a DIFFERENT type is the discriminator: with the
   * rollback the payload is [הנהלה, כספים]; without it the failed "דיון כללי" is still in memory
   * and rides along as a THIRD entry — a template the store was never told about, resurrected by
   * the next unrelated save.
   *
   * (An earlier version of this test asserted `ctx.typeTemplates` after the rejection and passed
   * with the rollback REMOVED — the re-render it depended on had not happened yet, so it proved
   * nothing. The payload does not depend on render timing.)
   */
  it('leaves no ghost behind — the next write carries only what was really saved', async () => {
    await mount();
    storage.setItem.mockRejectedValueOnce(new Error('storage down'));
    await expect(
      ctx.upsertTypeTemplate({ discussionType: 'דיון כללי', topics: [] }, { strict: true })
    ).rejects.toThrow('storage down');

    await ctx.upsertTypeTemplate({ discussionType: 'כספים', topics: [] }, { strict: true });
    const written = JSON.parse(storage.setItem.mock.calls.filter(([k]) => k === TYPES_KEY).at(-1)[1]);
    expect(written.templates.map((t) => t.discussionType).sort()).toEqual(['הנהלה', 'כספים']);
  });

  // And a RETRY of the same type behaves like a fresh session: it is written again, as an ADD
  // rather than a replace of a phantom entry, and the store ends up with both types.
  it('lets a RETRY write the template again instead of assuming it exists', async () => {
    await mount();
    storage.setItem.mockRejectedValueOnce(new Error('storage down'));
    await expect(
      ctx.upsertTypeTemplate({ discussionType: 'דיון כללי', topics: [] }, { strict: true })
    ).rejects.toThrow();

    await ctx.upsertTypeTemplate({ discussionType: 'דיון כללי', topics: [{ name: 'פתיחה', points: [] }] }, { strict: true });
    const written = JSON.parse(storage.setItem.mock.calls.filter(([k]) => k === TYPES_KEY).at(-1)[1]);
    expect(written.templates.map((t) => t.discussionType).sort()).toEqual(['דיון כללי', 'הנהלה']);
    expect(written.templates.find((t) => t.discussionType === 'דיון כללי').topics).toHaveLength(1);
  });

  /*
   * NON-strict stays optimistic, deliberately. Those callers are UI surfaces that show their own
   * failure toast and would rather keep the user's edit on screen than have it vanish under them —
   * rolling back there would be a different bug, not a fix.
   */
  it('keeps the optimistic update for a NON-strict write', async () => {
    await mount();
    storage.setItem.mockRejectedValueOnce(new Error('storage down'));
    await ctx.upsertTypeTemplate({ discussionType: 'דיון כללי', topics: [] });
    await waitFor(() => expect(ctx.typeTemplates.map((t) => t.discussionType).sort()).toEqual(['דיון כללי', 'הנהלה']));
  });

  // And a SUCCESSFUL strict write keeps its result — the rollback must not fire on the happy path.
  it('keeps the new template when the strict write succeeds', async () => {
    await mount();
    await ctx.upsertTypeTemplate({ discussionType: 'דיון כללי', topics: [] }, { strict: true });
    await waitFor(() => expect(ctx.typeTemplates.map((t) => t.discussionType).sort()).toEqual(['דיון כללי', 'הנהלה']));
  });
});

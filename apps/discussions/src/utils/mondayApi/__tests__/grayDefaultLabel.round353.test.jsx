import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round353 §3 (owner, with screenshots) — the GRAY DEFAULT label (stable id 5) IS the empty
 * state, on both sides of the wire:
 *
 *   1. PROVISIONING writes the "not yet" texts onto label id 5 itself — "טרם החל" (status) /
 *      "טרם נבחרה" (priority) — instead of minting extra labels. The owner deleted the extra
 *      labels by hand and renamed the gray one; a fresh install must come out that way.
 *      Colors ride on label IDS (create_column ignores labels_colors — verified live
 *      2026-08-04/05, sandbox 16291824): priority = black(10) / dark-purple(14) /
 *      bright-blue(7) / turquoise(16), skipping id 1 so the inert done-marker points at
 *      nothing real.
 *   2. THE APP exposes that label's text as `emptyLabel` from useStatusOptions, so an EMPTY
 *      cell can render "טרם החל" instead of the app-invented "ללא סטאטוס" — monday never
 *      auto-assigns id 5 to an empty cell, so the app has to do the rendering itself.
 */

const { api, state } = vi.hoisted(() => {
  const state = { boardSeq: 0 };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      if (s.includes('workspace { id }')) return { boards: [{ id: String(vars.ids[0]), workspace: { id: 'WS1' } }] };
      if (s.includes('folders(')) return { folders: [] };
      if (s.includes('create_folder')) return { create_folder: { id: 'F1' } };
      if (s.includes('create_board')) { state.boardSeq += 1; return { create_board: { id: `B${state.boardSeq}` } }; }
      if (s.includes('update_board_hierarchy')) return { update_board_hierarchy: { success: true } };
      if (s.includes('create_column')) return { create_column: { id: `col-${vars.title}` } };
      if (s.includes('create_dropdown_managed_column')) return { create_dropdown_managed_column: { id: 'mc-1' } };
      if (s.includes('attach_dropdown_managed_column')) return { attach_dropdown_managed_column: { id: 'col-type' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'x' } };
      if (s.includes('columns { id title type settings_str }')) {
        return { boards: [{ columns: [{ id: 'subcol', title: 'Subitems', type: 'subtasks', settings_str: '{"boardIds":[777]}' }] }] };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../managedColumns.js', () => ({
  detectManagedDropdownColumnId: vi.fn(async () => 'mc-1'),
  findManagedDropdownColumnByTitle: vi.fn(async () => null),
}));

import logger from '../../logger.js';
import { provisionAllBoards } from '../provisionBoards.js';
import { useStatusOptions } from '../../../hooks/useStatusOptions.js';
import { setActiveConfig } from '../board-config-store.js';

// The exact JSON each tasks-board status column was created with, keyed off the wire call —
// asserting the REQUEST payload, not an exported constant, so re-wiring breaks this too.
const columnDefaults = (title) => {
  const call = api.mock.calls.find(
    ([q, vars]) => String(q).includes('create_column') && vars.title === title && vars.defaults
  );
  return call ? JSON.parse(call[1].defaults) : null;
};

beforeEach(() => {
  state.boardSeq = 0;
  vi.clearAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

describe('round353 §3 — provisioning puts the empty-state texts on the gray label itself', () => {
  it('status: "טרם החל" IS label 5 (gray), first in display order — no extra label for it', async () => {
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const d = columnDefaults('סטאטוס');
    expect(d).toBeTruthy();
    expect(d.labels['5']).toBe('טרם החל');
    // the old shape shipped it as a SEPARATE blue label (id 3) — that id must be gone
    expect(d.labels['3']).toBeUndefined();
    expect(d.labels_positions_v2).toEqual({ 5: 0, 0: 1, 2: 2, 1: 3 });
    expect(d.done_colors).toEqual([1]);
  });

  it('priority: "טרם נבחרה" IS label 5, and the palette ids give black/dark-purple/blue/turquoise', async () => {
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const d = columnDefaults('עדיפות');
    expect(d).toBeTruthy();
    expect(d.labels).toEqual({ 5: 'טרם נבחרה', 10: 'דחופה', 14: 'גבוהה', 7: 'בינונית', 16: 'נמוכה' });
    expect(d.labels_positions_v2).toEqual({ 5: 0, 10: 1, 14: 2, 7: 3, 16: 4 });
    // id 1 (the immovable done marker) must stay unused on a column where "done" is meaningless
    expect(d.labels['1']).toBeUndefined();
  });
});

describe('round353 §3 — useStatusOptions exposes the gray label as emptyLabel', () => {
  let ctx = null;
  function Probe({ boardKey, alias }) {
    ctx = useStatusOptions(boardKey, alias);
    return null;
  }
  const mountFor = async (boardId, colId, columnAnswer) => {
    setActiveConfig({
      boards: { tasks: { id: boardId } },
      columns: { tasks: { statusID: { id: colId } } },
    });
    api.mockImplementationOnce(async () => ({ boards: [{ columns: [columnAnswer] }] }));
    render(<Probe boardKey="tasks" alias="statusID" />);
    await waitFor(() => expect(ctx?.loading).toBe(false));
  };

  it('typed settings: emptyLabel is label id 5\'s text', async () => {
    await mountFor('9001', 'st1', {
      id: 'st1',
      settings: { labels: [
        { id: 5, label: 'טרם החל', hex: '#c4c4c4', index: 0 },
        { id: 0, label: 'בעבודה', hex: '#fdab3d', index: 1 },
        { id: 1, label: 'בוצע', hex: '#00c875', index: 3, is_done: true },
      ] },
      settings_str: null,
    });
    expect(ctx.emptyLabel).toBe('טרם החל');
    // and it is still a REAL pickable option, first in display order
    expect(ctx.options[0]).toMatchObject({ id: 5, label: 'טרם החל' });
  });

  it('legacy settings_str: emptyLabel comes from labels["5"]', async () => {
    await mountFor('9002', 'st2', {
      id: 'st2',
      settings: null,
      settings_str: JSON.stringify({
        labels: { 5: 'טרם נבחרה', 10: 'דחופה' },
        labels_positions_v2: { 5: 0, 10: 1 },
        labels_colors: { 5: { color: '#c4c4c4' }, 10: { color: '#333333' } },
      }),
    });
    expect(ctx.emptyLabel).toBe('טרם נבחרה');
  });

  /*
   * round354 (Codex P1 on the release PR) — an UPGRADED board provisioned with the OLD
   * priority scheme carries "נמוכה" on id 5 (the old defaults used gray-5 for Low, LAST in
   * display order). Exposing id 5's text unconditionally would render every empty priority
   * cell as "נמוכה" there — unset becomes indistinguishable from Low. The gate: id 5 counts
   * as the empty state only when it is FIRST in display order, which is where an
   * empty-state label lives by definition (and where provisioning + the owner's manual
   * fixes put it) — old-scheme "נמוכה" sits last and stays a plain option.
   */
  it('old-scheme priority (נמוכה on id 5, LAST) does NOT become the empty label', async () => {
    await mountFor('9004', 'st4', {
      id: 'st4',
      settings: null,
      settings_str: JSON.stringify({
        labels: { 2: 'דחופה', 0: 'גבוהה', 9: 'בינונית', 5: 'נמוכה' },
        labels_positions_v2: { 2: 0, 0: 1, 9: 2, 5: 3 },
      }),
    });
    expect(ctx.emptyLabel).toBeNull();
    // it is still a perfectly normal option — only its empty-state role is denied
    expect(ctx.labelById[5]).toBe('נמוכה');
  });

  it('a BLANK gray label yields emptyLabel null — callers keep their fallback text', async () => {
    await mountFor('9003', 'st3', {
      id: 'st3',
      settings: { labels: [
        { id: 5, label: '', hex: '#c4c4c4', index: 0 },
        { id: 0, label: 'בעבודה', hex: '#fdab3d', index: 1 },
      ] },
      settings_str: null,
    });
    expect(ctx.emptyLabel).toBeNull();
  });
});

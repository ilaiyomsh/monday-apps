import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round320 (owner request) — the rows INSIDE "פרטי הדיון" can be reordered, the way
 * the sections themselves already can: which line is at the top (תאריך) and which
 * sits under which (מנהל, then whoever follows).
 *
 * The renderer has always emitted the rows in their stored order — `buildMeta`
 * iterates `section.fields` — and `seedExportTemplate` has always preserved that
 * order because the owner owns it. What was missing was any way to CHANGE it, so
 * this pins the editor half: a grip per row, wired to the same dnd-kit context the
 * section list uses, writing the new order into the template.
 *
 * Drag itself is a pointer gesture that jsdom cannot perform faithfully, so the
 * reorder is exercised through the pure helper the drag handler calls, and the
 * editor is checked for the handles that make it reachable. The end-to-end order
 * (stored order → document) is pinned in peopleMetaExport/participantsExportLines.
 */

const storage = { getItem: vi.fn(async () => ({ data: { value: null } })), setItem: vi.fn(async () => ({})) };
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({})),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(),
  getBoardId: () => null,
  getColumns: () => ({}),
}));

import ExportTemplateTab, { reorderMetaFields, META_FIELD_DRAG_PREFIX } from '../ExportTemplateTab.jsx';
import { DEFAULT_EXPORT_TEMPLATE } from '../../../utils/mondayApi/boards.config.js';

const keysOf = (tpl) => tpl.sections.find((s) => s.key === 'meta').fields.map((f) => f.key);

beforeEach(() => { vi.clearAllMocks(); });

describe('reorderMetaFields — the pure move behind the drag', () => {
  it('moves a row to the dropped position and leaves the rest in order', () => {
    const next = reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'leadText', 'dateText');
    expect(keysOf(next)).toEqual([
      'leadText', 'dateText', 'participantsText', 'coordinatorText', 'typesText', 'previousText',
    ]);
  });

  it('moves DOWN as well as up — the owner drags either way', () => {
    const next = reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'dateText', 'coordinatorText');
    expect(keysOf(next)).toEqual([
      'participantsText', 'leadText', 'coordinatorText', 'dateText', 'typesText', 'previousText',
    ]);
  });

  it('is a no-op for a row dropped on itself, or for keys that are not rows here', () => {
    expect(reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'dateText', 'dateText')).toBe(DEFAULT_EXPORT_TEMPLATE);
    expect(reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'dateText', 'topics')).toBe(DEFAULT_EXPORT_TEMPLATE);
    expect(reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'nope', 'dateText')).toBe(DEFAULT_EXPORT_TEMPLATE);
  });

  it('keeps every other field property, and does not mutate the template it was given', () => {
    const snapshot = JSON.stringify(DEFAULT_EXPORT_TEMPLATE);
    const next = reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'previousText', 'dateText');
    const moved = next.sections.find((s) => s.key === 'meta').fields[0];
    expect(moved).toEqual({ key: 'previousText', enabled: true, label: 'דיון קודם' });
    expect(JSON.stringify(DEFAULT_EXPORT_TEMPLATE)).toBe(snapshot);
  });

  it('leaves the SECTION order alone — this moves a row, not the block it lives in', () => {
    const next = reorderMetaFields(DEFAULT_EXPORT_TEMPLATE, 'leadText', 'dateText');
    expect(next.sections.map((s) => s.key)).toEqual(DEFAULT_EXPORT_TEMPLATE.sections.map((s) => s.key));
  });
});

describe('the editor offers a handle on every row of פרטי הדיון', () => {
  const Host = () => {
    const [template, setTemplate] = React.useState(DEFAULT_EXPORT_TEMPLATE);
    return (
      <ExportTemplateTab
        template={template}
        setTemplate={(fn) => setTemplate((prev) => (typeof fn === 'function' ? fn(prev) : fn))}
        assets={null}
        setAssets={() => {}}
      />
    );
  };

  it('renders one drag handle per meta row, keyed so a row can never be confused with a section', async () => {
    render(<Host />);
    screen.getByLabelText('עוד').click();

    await waitFor(() => expect(document.querySelectorAll('[data-meta-field-grip]').length).toBe(6));
    const keys = [...document.querySelectorAll('[data-meta-field-grip]')]
      .map((n) => n.getAttribute('data-meta-field-grip'));
    expect(keys).toEqual([
      'dateText', 'participantsText', 'leadText', 'coordinatorText', 'typesText', 'previousText',
    ]);
    // The drag ids are namespaced: one DndContext carries both lists, and a bare
    // key would collide with the section of the same name.
    expect(META_FIELD_DRAG_PREFIX).toBe('metafield:');
  });
});

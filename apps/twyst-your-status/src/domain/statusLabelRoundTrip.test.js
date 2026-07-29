/**
 * `update_status_column` REPLACES the labels array, so a field the payload omits is
 * cleared — not left alone. `is_done` and `description` are accepted by
 * `UpdateStatusLabelInput`, and a payload without them wiped the column's
 * `done_colors` from `[1]` to `[]` on a live board (probe-verified 2026-07-29).
 *
 * That made every labels save lossy: renaming one label dropped the "Done"
 * designation and every label description on the column. These pin the read →
 * draft → payload → mutation round trip that stops it.
 */

import { describe, expect, it } from 'vitest';

import { normalizeStatusLabels } from './statusPolicy.js';
import {
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createLabelsDraft,
} from './statusLabelDraft.js';

/** The shape monday returns from `columns { settings }`. */
const liveSettings = {
  labels: [
    {
      id: 0, color: 0, label: 'בעבודה', index: 0, is_done: false, is_deactivated: false, hex: '#fdab3d',
    },
    {
      id: 1, color: 1, label: 'בוצע', index: 1, is_done: true, is_deactivated: false, hex: '#00c875', description: 'סיימנו',
    },
    {
      id: 2, color: 2, label: 'תקוע', index: 2, is_done: false, is_deactivated: false, hex: '#df2f4a',
    },
  ],
};

describe('normalizeStatusLabels', () => {
  it('reads is_done and description off the live settings', () => {
    const labels = normalizeStatusLabels(liveSettings);
    expect(labels[1].isDone).toBe(true);
    expect(labels[1].description).toBe('סיימנו');
    expect(labels[0].isDone).toBe(false);
  });
});

describe('createLabelsDraft', () => {
  it('carries is_done and description into the draft so a save can send them back', () => {
    const draft = createLabelsDraft(normalizeStatusLabels(liveSettings));
    const done = draft.find((label) => label.id === '1');
    expect(done.isDone).toBe(true);
    expect(done.description).toBe('סיימנו');
  });

  it('shows the hex monday actually stored, not one re-derived from the colour index', () => {
    // monday overrides some colours server-side (the reserved id 5 renders grey
    // whatever enum was sent), so the stored hex is the only truthful swatch.
    const draft = createLabelsDraft(normalizeStatusLabels({
      labels: [{
        id: 5, color: 5, label: 'ריק', index: 0, is_deactivated: false, hex: '#c4c4c4',
      }],
    }));
    expect(draft[0].color).toBe('#c4c4c4');
  });
});

describe('buildStatusLabelsUpdatePayload', () => {
  it('emits is_done and description for every row it sends', () => {
    const live = normalizeStatusLabels(liveSettings);
    const payload = buildStatusLabelsUpdatePayload(createLabelsDraft(live), live);
    const done = payload.find((label) => label.id === 1);
    expect(done.isDone).toBe(true);
    expect(done.description).toBe('סיימנו');
    expect(payload.find((label) => label.id === 0).isDone).toBe(false);
  });

  it('keeps is_done on a row the user did not touch while renaming another', () => {
    const live = normalizeStatusLabels(liveSettings);
    const draft = createLabelsDraft(live)
      .map((label) => (label.id === '2' ? { ...label, label: 'חסום' } : label));
    const payload = buildStatusLabelsUpdatePayload(draft, live);
    expect(payload.find((label) => label.id === 1).isDone).toBe(true);
    expect(payload.find((label) => label.id === 2).label).toBe('חסום');
  });

  it('carries is_done through onto a DEACTIVATED row too', () => {
    const live = normalizeStatusLabels(liveSettings);
    const draft = createLabelsDraft(live).filter((label) => label.id !== '1');
    const payload = buildStatusLabelsUpdatePayload(draft, live);
    const parked = payload.find((label) => label.id === 1);
    expect(parked.isDeactivated).toBe(true);
    expect(parked.isDone).toBe(true);
  });
});

describe('buildUpdateStatusColumnMutation', () => {
  it('serialises is_done and description as GraphQL fields', () => {
    const mutation = buildUpdateStatusColumnMutation([
      {
        id: 1, color: 'done_green', label: 'בוצע', index: 0, isDone: true, description: 'סיימנו', isDeactivated: false,
      },
    ]);
    expect(mutation).toMatch(/is_done: true/);
    expect(mutation).toMatch(/description: "סיימנו"/);
  });

  it('omits is_done when false and description when absent, rather than sending nulls', () => {
    const mutation = buildUpdateStatusColumnMutation([
      {
        id: 2, color: 'stuck_red', label: 'תקוע', index: 0, isDone: false, isDeactivated: false,
      },
    ]);
    expect(mutation).not.toMatch(/is_done/);
    expect(mutation).not.toMatch(/description/);
  });

  it('escapes a description containing quotes', () => {
    const mutation = buildUpdateStatusColumnMutation([
      {
        id: 3, color: 'dark_blue', label: 'x', index: 0, description: 'say "hi"', isDeactivated: false,
      },
    ]);
    expect(mutation).toContain(JSON.stringify('say "hi"'));
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round315 — the participants sub-editor of the export template (the ONE editor
 * behind all three surfaces: Settings' general template, a discussion TYPE's
 * template, and the per-export dialog).
 */

// The account's custom profile fields, as the live API would return them.
const metas = vi.fn(async () => [{ id: '750658', title: 'Pluga' }]);
vi.mock('../../../utils/mondayApi/userProfiles.js', () => ({
  fetchUserCustomFieldMetas: (...a) => metas(...a),
}));
// The preview renders a real .docx — irrelevant here and slow.
vi.mock('../ExportPreview.jsx', () => ({ default: () => <div data-testid="preview" /> }));

import ExportTemplateTab, {
  participantPartRows,
  toggleParticipantPart,
  moveParticipantPart,
  setParticipantPartSep,
} from '../ExportTemplateTab.jsx';
import { DEFAULT_EXPORT_TEMPLATE, DEFAULT_PARTICIPANT_SEPARATOR } from '../../../utils/mondayApi/boards.config.js';

const FIELD = { key: 'participantsText', enabled: true, label: 'משתתפים', perLine: false, parts: [{ key: 'name', sep: ', ' }] };
const METAS = [{ id: '750658', title: 'Pluga' }];

beforeEach(() => { vi.clearAllMocks(); });

describe('participantPartRows — what the editor offers', () => {
  it('lists the selected parts first, then every remaining available part', () => {
    const rows = participantPartRows(FIELD, METAS);
    expect(rows.map((r) => r.key)).toEqual(['name', 'title', 'cf:750658']);
    expect(rows.map((r) => r.selected)).toEqual([true, false, false]);
    expect(rows.map((r) => r.label)).toEqual(['שם', 'תפקיד (Title)', 'Pluga']);
  });

  it('reflects the stored ORDER, not the availability order', () => {
    const field = { ...FIELD, parts: [{ key: 'cf:750658', sep: ', ' }, { key: 'name', sep: ' ' }] };
    const rows = participantPartRows(field, METAS);
    expect(rows.map((r) => r.key)).toEqual(['cf:750658', 'name', 'title']);
    expect(rows.filter((r) => r.selected).map((r) => r.sep)).toEqual([', ', ' ']);
  });

  it('marks the first selected part and the move bounds', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ' ' }, { key: 'title', sep: ', ' }] };
    const rows = participantPartRows(field, METAS).filter((r) => r.selected);
    expect(rows.map((r) => r.first)).toEqual([true, false]);
    expect(rows.map((r) => r.canUp)).toEqual([false, true]);
    expect(rows.map((r) => r.canDown)).toEqual([true, false]);
  });

  it('keeps a selected custom field whose account definition is gone, under its stored label', () => {
    const field = { ...FIELD, parts: [{ key: 'cf:999', sep: ', ', label: 'תואר' }] };
    const rows = participantPartRows(field, METAS);
    expect(rows[0]).toMatchObject({ key: 'cf:999', label: 'תואר', selected: true });
  });

  it('offers שם + תפקיד alone when the account has no custom fields', () => {
    expect(participantPartRows(FIELD, []).map((r) => r.key)).toEqual(['name', 'title']);
  });
});

describe('the pure part editors', () => {
  it('adds a part at the END of the composition, with the default separator', () => {
    const next = toggleParticipantPart(FIELD, 'title');
    expect(next.parts).toEqual([{ key: 'name', sep: ', ' }, { key: 'title', sep: DEFAULT_PARTICIPANT_SEPARATOR }]);
  });

  it('stores a custom field part with its label, so it survives the definition disappearing', () => {
    const next = toggleParticipantPart(FIELD, 'cf:750658', 'Pluga');
    expect(next.parts[1]).toEqual({ key: 'cf:750658', sep: DEFAULT_PARTICIPANT_SEPARATOR, label: 'Pluga' });
  });

  it('removes a part', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }] };
    expect(toggleParticipantPart(field, 'title').parts).toEqual([{ key: 'name', sep: ', ' }]);
  });

  it('moves a part up and down within the composition', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }] };
    expect(moveParticipantPart(field, 'title', -1).parts.map((p) => p.key)).toEqual(['title', 'name']);
    expect(moveParticipantPart(field, 'name', 1).parts.map((p) => p.key)).toEqual(['title', 'name']);
  });

  it('refuses to move past the edges (returns the field untouched)', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }] };
    expect(moveParticipantPart(field, 'name', -1)).toBe(field);
    expect(moveParticipantPart(field, 'title', 1)).toBe(field);
    expect(moveParticipantPart(field, 'nope', -1)).toBe(field);
  });

  it('sets the separator of ONE part only', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }] };
    expect(setParticipantPartSep(field, 'title', ' — ').parts).toEqual([
      { key: 'name', sep: ', ' }, { key: 'title', sep: ' — ' },
    ]);
    expect(setParticipantPartSep(field, 'missing', ' ')).toBe(field);
  });

  it('is pure — the field it was given is never mutated', () => {
    const field = { ...FIELD, parts: [{ key: 'name', sep: ', ' }] };
    const snapshot = JSON.stringify(field);
    toggleParticipantPart(field, 'title');
    moveParticipantPart(field, 'name', 1);
    setParticipantPartSep(field, 'name', ' ');
    expect(JSON.stringify(field)).toBe(snapshot);
  });
});

const PER_LINE_TEXT = 'כל אדם בשורה נפרדת';

describe('the editor as rendered', () => {
  const Host = ({ onChange }) => {
    const [template, setTemplate] = React.useState(DEFAULT_EXPORT_TEMPLATE);
    return (
      <ExportTemplateTab
        template={template}
        setTemplate={(fn) => setTemplate((prev) => {
          const next = typeof fn === 'function' ? fn(prev) : fn;
          onChange?.(next);
          return next;
        })}
        assets={null}
        setAssets={() => {}}
      />
    );
  };
  /*
   * round319 — the composition is read off the template's ONE people setting. It was
   * `participantsText`'s own until round316; the editor no longer writes there, and
   * these cases assert the setting the renderer now reads.
   */
  const peopleOf = (tpl) => tpl.people;
  // Only the מטא section expands, via the chevron on its row.
  const openMeta = async () => {
    fireEvent.click(screen.getByLabelText('עוד'));
    await waitFor(() => expect(screen.getByText(PER_LINE_TEXT)).toBeTruthy());
  };
  // One block for all people rows (was one per row in round316).
  const block = () => within(document.querySelector('[data-people-field="all"]'));

  it('offers the per-line choice and the account custom field once the metas load', async () => {
    render(<Host />);
    await openMeta();
    await waitFor(() => expect(block().getByText('Pluga')).toBeTruthy());
    expect(block().getByText('שם')).toBeTruthy();
    expect(block().getByText('תפקיד (Title)')).toBeTruthy();
  });

  it(`turning on "${'כל אדם בשורה נפרדת'}" writes perLine into the ONE people setting`, async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    fireEvent.click(screen.getByText(PER_LINE_TEXT));
    await waitFor(() => expect(peopleOf(latest).perLine).toBe(true));
  });

  it('checking תפקיד appends it to the composition', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    fireEvent.click(block().getByLabelText('תפקיד (Title)'));
    await waitFor(() => expect(peopleOf(latest).parts.map((p) => p.key)).toEqual(['name', 'title']));
  });

  it('the arrow reorders the composition', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    fireEvent.click(block().getByLabelText('תפקיד (Title)'));
    await waitFor(() => expect(block().getByLabelText('הקדם את תפקיד (Title)')).toBeTruthy());
    fireEvent.click(block().getByLabelText('הקדם את תפקיד (Title)'));
    await waitFor(() => expect(peopleOf(latest).parts.map((p) => p.key)).toEqual(['title', 'name']));
  });

  it('the separator dropdown appears only for a part that FOLLOWS another', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    // The first (and only) selected part has nothing before it → no separator.
    expect(block().queryByLabelText('מפריד לפני שם')).toBeNull();
    fireEvent.click(block().getByLabelText('תפקיד (Title)'));
    const sep = await waitFor(() => block().getByLabelText('מפריד לפני תפקיד (Title)'));
    fireEvent.change(sep, { target: { value: ' ' } });
    await waitFor(() => expect(peopleOf(latest).parts[1].sep).toBe(' '));
  });
});

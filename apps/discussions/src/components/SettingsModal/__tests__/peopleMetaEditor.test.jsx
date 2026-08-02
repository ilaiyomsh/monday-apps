import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round316 — the editor side: every people row of פרטי דיון gets its own
 * line-per-person + parts controls, and a template stored before this round must
 * GAIN the new מרכז דיון row (until now stored meta fields were kept verbatim, so a
 * field added to the schema later stayed invisible forever).
 */

const metas = vi.fn(async () => [{ id: '750658', title: 'Pluga' }]);
vi.mock('../../../utils/mondayApi/userProfiles.js', () => ({
  fetchUserCustomFieldMetas: (...a) => metas(...a),
}));
vi.mock('../ExportPreview.jsx', () => ({ default: () => <div data-testid="preview" /> }));

import ExportTemplateTab from '../ExportTemplateTab.jsx';
import { seedExportTemplate } from '../SettingsModal.jsx';
import { DEFAULT_EXPORT_TEMPLATE, PEOPLE_META_FIELDS } from '../../../utils/mondayApi/boards.config.js';

const metaFields = (tpl) => tpl.sections.find((s) => s.key === 'meta').fields;

beforeEach(() => { vi.clearAllMocks(); });

describe('seedExportTemplate — back-filling the new people row', () => {
  it('adds מרכז דיון to a template stored before this round', () => {
    const stored = {
      ...DEFAULT_EXPORT_TEMPLATE,
      sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => (
        s.key === 'meta'
          ? { ...s, fields: s.fields.filter((f) => f.key !== 'coordinatorText').map((f) => ({ ...f })) }
          : s
      )),
    };
    const seeded = seedExportTemplate(stored);
    const keys = metaFields(seeded).map((f) => f.key);
    expect(keys).toContain('coordinatorText');
    // Inserted at its default position, right after the lead row.
    expect(keys.indexOf('coordinatorText')).toBe(keys.indexOf('leadText') + 1);
  });

  it('leaves the fields the instance already owns exactly as they were', () => {
    // Stored BEFORE round319, so it carries no `people` key — the format still
    // lives on the rows, which is what the migration below has to pick up.
    const { people: _unused, ...preRound319 } = DEFAULT_EXPORT_TEMPLATE;
    const stored = {
      ...preRound319,
      sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => (
        s.key === 'meta'
          ? {
            ...s,
            fields: [
              { key: 'participantsText', enabled: true, label: 'נוכחים', perLine: true, parts: [{ key: 'title', sep: ', ' }] },
              { key: 'dateText', enabled: false, label: 'תאריך' },
            ],
          }
          : s
      )),
    };
    const seededTpl = seedExportTemplate(stored);
    const seeded = metaFields(seededTpl);
    const participants = seeded.find((f) => f.key === 'participantsText');
    // round319 — the row keeps what is genuinely its own (label, enabled); the FORMAT
    // it used to carry is lifted onto the template's one people setting, and the
    // per-row copy is stripped so there is a single source of truth.
    expect(participants).toEqual({ key: 'participantsText', enabled: true, label: 'נוכחים' });
    expect(seededTpl.people).toEqual({
      perLine: true,
      parts: [{ key: 'title', sep: ', ' }],
      includeExternal: false,
    });
    expect(seeded.find((f) => f.key === 'dateText').enabled).toBe(false);
    // Their ORDER survives too — the owner owns it.
    expect(seeded.map((f) => f.key).slice(0, 2)).toEqual(['participantsText', 'dateText']);
  });

  it('does not mutate the stored object it was given', () => {
    const stored = JSON.parse(JSON.stringify(DEFAULT_EXPORT_TEMPLATE));
    stored.sections.find((s) => s.key === 'meta').fields = [{ key: 'dateText', enabled: true, label: 'תאריך' }];
    const snapshot = JSON.stringify(stored);
    seedExportTemplate(stored);
    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  it('seeds a brand-new instance with ONE neutral people setting, and rows that carry no format', () => {
    const seededTpl = seedExportTemplate(null);
    expect(seededTpl.people).toEqual({ perLine: false, parts: [{ key: 'name', sep: ', ' }], includeExternal: false });
    metaFields(seededTpl)
      .filter((f) => Object.keys(PEOPLE_META_FIELDS).includes(f.key))
      .forEach((field) => {
        expect(field.perLine).toBeUndefined();
        expect(field.parts).toBeUndefined();
      });
  });

  /*
   * round319 — the upgrade path. An instance that configured the participants row
   * under round315/316 must keep that configuration when it moves to the shared
   * setting, or the first save after the upgrade silently resets the owner's export.
   */
  it('adopts a pre-round319 row configuration instead of resetting it', () => {
    const { people: _unused, ...preRound319 } = DEFAULT_EXPORT_TEMPLATE;
    const stored = {
      ...preRound319,
      sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => (
        s.key === 'meta'
          ? {
            ...s,
            fields: s.fields.map((f) => (f.key === 'participantsText'
              ? { ...f, perLine: true, parts: [{ key: 'cf:750658', sep: ', ' }, { key: 'name', sep: ' ' }] }
              : f)),
          }
          : s
      )),
    };
    expect(seedExportTemplate(stored).people).toEqual({
      perLine: true,
      parts: [{ key: 'cf:750658', sep: ', ' }, { key: 'name', sep: ' ' }],
      includeExternal: false,
    });
  });

  it('prefers the PARTICIPANTS row when the old rows disagree — it is the one with a list in it', () => {
    const { people: _unused, ...preRound319 } = DEFAULT_EXPORT_TEMPLATE;
    /*
     * The lead row is placed FIRST on purpose. The stored field order is the owner's
     * (seedExportTemplate preserves it), so "whichever people row comes first wins"
     * and "the participants row wins" are the same answer in the shipped order and
     * only differ here — which is exactly the bug this pins.
     */
    const stored = {
      ...preRound319,
      sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => {
        if (s.key !== 'meta') return s;
        const others = s.fields.filter((f) => f.key !== 'participantsText' && f.key !== 'leadText');
        return {
          ...s,
          fields: [
            { key: 'leadText', enabled: true, label: 'מוביל דיון', perLine: true, parts: [{ key: 'title', sep: ', ' }] },
            { key: 'participantsText', enabled: true, label: 'משתתפים', perLine: false, parts: [{ key: 'name', sep: ', ' }] },
            ...others,
          ],
        };
      }),
    };
    expect(seedExportTemplate(stored).people).toMatchObject({ perLine: false, parts: [{ key: 'name', sep: ', ' }] });
  });

  it('keeps a people setting the instance already has', () => {
    const stored = { ...DEFAULT_EXPORT_TEMPLATE, people: { perLine: true, parts: [{ key: 'title', sep: ' — ' }], includeExternal: true } };
    expect(seedExportTemplate(stored).people).toEqual({
      perLine: true,
      parts: [{ key: 'title', sep: ' — ' }],
      includeExternal: true,
    });
  });
});

describe('the editor renders ONE shared people block (round319)', () => {
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
  const openMeta = async () => {
    fireEvent.click(screen.getByLabelText('עוד'));
    await waitFor(() => expect(document.querySelectorAll('[data-people-field]').length).toBe(1));
  };
  const block = () => within(document.querySelector('[data-people-field="all"]'));

  it('renders exactly one block for all people rows — not one per row', async () => {
    render(<Host />);
    await openMeta();
    const keys = [...document.querySelectorAll('[data-people-field]')].map((n) => n.getAttribute('data-people-field'));
    expect(keys).toEqual(['all']);
    // The three rows are still there as rows — only their FORMAT was unified.
    expect(screen.getByDisplayValue('משתתפים')).toBeTruthy();
    expect(screen.getByDisplayValue('מוביל דיון')).toBeTruthy();
    expect(screen.getByDisplayValue('מרכז דיון')).toBeTruthy();
  });

  it('names the split for people in general, not for one row\'s role', async () => {
    render(<Host />);
    await openMeta();
    expect(block().getByText('כל אדם בשורה נפרדת')).toBeTruthy();
  });

  it('per-line writes the ONE setting, and no row carries its own', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    fireEvent.click(block().getByText('כל אדם בשורה נפרדת'));
    await waitFor(() => expect(latest.people.perLine).toBe(true));
    metaFields(latest)
      .filter((f) => Object.keys(PEOPLE_META_FIELDS).includes(f.key))
      .forEach((f) => expect(f.perLine).toBeUndefined());
  });

  it('a checked part lands on the ONE setting, so every row gets it', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    await waitFor(() => expect(block().getByLabelText('Pluga')).toBeTruthy());
    fireEvent.click(block().getByLabelText('Pluga'));
    await waitFor(() => expect(latest.people.parts.map((p) => p.key)).toEqual(['name', 'cf:750658']));
    metaFields(latest)
      .filter((f) => Object.keys(PEOPLE_META_FIELDS).includes(f.key))
      .forEach((f) => expect(f.parts).toBeUndefined());
  });

  it('offers the externals choice, off until the owner asks for it', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    const label = 'משתתפים חיצוניים כחלק מרשימת המשתתפים';
    expect(block().getByText(label)).toBeTruthy();
    expect(DEFAULT_EXPORT_TEMPLATE.people.includeExternal).toBe(false);
    fireEvent.click(block().getByText(label));
    await waitFor(() => expect(latest.people.includeExternal).toBe(true));
  });

  it('offers the account custom field and תפקיד once, in that block', async () => {
    render(<Host />);
    await openMeta();
    await waitFor(() => expect(block().getByText('Pluga')).toBeTruthy());
    expect(block().getByText('תפקיד (Title)')).toBeTruthy();
    expect(screen.getAllByText('תפקיד (Title)')).toHaveLength(1);
  });
});

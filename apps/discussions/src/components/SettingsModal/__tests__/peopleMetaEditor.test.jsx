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
    const stored = {
      ...DEFAULT_EXPORT_TEMPLATE,
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
    const seeded = metaFields(seedExportTemplate(stored));
    const participants = seeded.find((f) => f.key === 'participantsText');
    expect(participants).toEqual({ key: 'participantsText', enabled: true, label: 'נוכחים', perLine: true, parts: [{ key: 'title', sep: ', ' }] });
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

  it('seeds every people row of a brand-new instance with the neutral defaults', () => {
    const seeded = metaFields(seedExportTemplate(null));
    Object.keys(PEOPLE_META_FIELDS).forEach((key) => {
      const field = seeded.find((f) => f.key === key);
      expect(field).toBeTruthy();
      expect(field.perLine).toBe(false);
      expect(field.parts.map((p) => p.key)).toEqual(['name']);
    });
  });
});

describe('the editor renders the controls per people row', () => {
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
    await waitFor(() => expect(document.querySelectorAll('[data-people-field]').length).toBe(3));
  };
  const block = (key) => within(document.querySelector(`[data-people-field="${key}"]`));
  const fieldOf = (tpl, key) => metaFields(tpl).find((f) => f.key === key);

  it('gives משתתפים, מוביל דיון and מרכז דיון a block each — and nothing to the text rows', async () => {
    render(<Host />);
    await openMeta();
    const keys = [...document.querySelectorAll('[data-people-field]')].map((n) => n.getAttribute('data-people-field'));
    expect(keys).toEqual(['participantsText', 'leadText', 'coordinatorText']);
  });

  it('names the people it splits: "כל משתתף" for the participants row, "כל אדם" for the role rows', async () => {
    render(<Host />);
    await openMeta();
    expect(block('participantsText').getByText('כל משתתף בשורה נפרדת')).toBeTruthy();
    expect(block('leadText').getByText('כל אדם בשורה נפרדת')).toBeTruthy();
    expect(block('coordinatorText').getByText('כל אדם בשורה נפרדת')).toBeTruthy();
  });

  it('per-line on the LEAD row writes only that row', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    fireEvent.click(block('leadText').getByText('כל אדם בשורה נפרדת'));
    await waitFor(() => expect(fieldOf(latest, 'leadText').perLine).toBe(true));
    expect(fieldOf(latest, 'participantsText').perLine).toBe(false);
    expect(fieldOf(latest, 'coordinatorText').perLine).toBe(false);
  });

  it('a part checked on the COORDINATOR row lands only on that row', async () => {
    let latest = null;
    render(<Host onChange={(t) => { latest = t; }} />);
    await openMeta();
    await waitFor(() => expect(block('coordinatorText').getByLabelText('Pluga')).toBeTruthy());
    fireEvent.click(block('coordinatorText').getByLabelText('Pluga'));
    await waitFor(() => expect(fieldOf(latest, 'coordinatorText').parts.map((p) => p.key)).toEqual(['name', 'cf:750658']));
    expect(fieldOf(latest, 'leadText').parts.map((p) => p.key)).toEqual(['name']);
    expect(fieldOf(latest, 'participantsText').parts.map((p) => p.key)).toEqual(['name']);
  });

  it('offers the account custom field in every people block', async () => {
    render(<Host />);
    await openMeta();
    await waitFor(() => expect(document.querySelectorAll('[data-people-field] input[type="checkbox"]').length).toBeGreaterThan(3));
    Object.keys(PEOPLE_META_FIELDS).forEach((key) => {
      expect(block(key).getByText('Pluga')).toBeTruthy();
      expect(block(key).getByText('תפקיד (Title)')).toBeTruthy();
    });
  });
});

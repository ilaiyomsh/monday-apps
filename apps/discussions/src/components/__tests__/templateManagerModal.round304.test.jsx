import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round304 (owner spec) — the templates screen:
 *  1. creating a type drops the user straight into its editor (בעלי תפקידים /
 *     אג'נדה / תבנית ייצוא) instead of back on the list,
 *  2. the type template's NAME can be changed from that editor (it had no
 *     reachable rename affordance at all).
 */

const mockUseTemplates = vi.fn();
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => mockUseTemplates(),
}));

const mockUseSettings = vi.fn(() => ({ settings: {} }));
vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => mockUseSettings(),
}));

const { typeOptions, addDropdownLabel, renameDropdownLabel } = vi.hoisted(() => ({
  typeOptions: { current: [{ id: 1, label: 'סוג A' }, { id: 2, label: 'סוג B' }] },
  addDropdownLabel: vi.fn().mockResolvedValue({ id: 3, managedColumnId: null }),
  renameDropdownLabel: vi.fn().mockResolvedValue({ managedColumnId: null, unchanged: false }),
}));
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({
    options: typeOptions.current,
    labels: typeOptions.current.map((o) => o.label),
    loading: false,
  }),
  addDropdownLabel: (...a) => addDropdownLabel(...a),
  renameDropdownLabel: (...a) => renameDropdownLabel(...a),
}));

vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({ discussionLeadID: { id: 'lead' } }),
}));
vi.mock('@generated/utils/mondayApi/peopleColumns.js', () => ({
  ensurePeopleColumns: () => {},
  getColumnTitle: () => null,
  subscribe: () => () => {},
  getVersion: () => 0,
}));
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: () => <div data-testid="person-picker" />,
}));
// The export sub-tab pulls in the docx preview stack — not what these tests are about.
vi.mock('@generated/components/SettingsModal/ExportTemplateTab.jsx', () => ({
  default: () => <div data-testid="export-tab" />,
}));
vi.mock('@generated/components/SettingsModal/SettingsModal.jsx', () => ({
  seedExportTemplate: (t) => t || { headerMode: 'config', sections: [] },
}));

const mockLoggerError = vi.fn();
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: (...a) => mockLoggerError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { TemplateManagerModal } from '../TemplateManagerModal';

function setup({ typeTemplates = [], extra = {} } = {}) {
  const f = {
    createTemplate: vi.fn(), updateTemplate: vi.fn(), deleteTemplate: vi.fn(),
    createParticipantTemplate: vi.fn(), updateParticipantTemplate: vi.fn(), deleteParticipantTemplate: vi.fn(),
    upsertTypeTemplate: vi.fn().mockResolvedValue(true),
    deleteTypeTemplate: vi.fn(),
    typeColor: () => 'var(--color-done-green)',
    typeColorName: () => 'done-green',
    setTypeColor: vi.fn().mockResolvedValue(true),
    assignRandomTypeColor: vi.fn().mockResolvedValue('done-green'),
    loadTypeExportAssets: vi.fn().mockResolvedValue({ headerLogo: null, footerLogo: null, templateDocx: null }),
    saveTypeExportAssets: vi.fn().mockResolvedValue(true),
    renameDiscussionType: vi.fn().mockResolvedValue(true),
    ...extra,
  };
  mockUseTemplates.mockReturnValue({
    templates: [], participantTemplates: [], typeTemplates, loading: false, ...f,
  });
  render(<TemplateManagerModal />);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  typeOptions.current = [{ id: 1, label: 'סוג A' }, { id: 2, label: 'סוג B' }];
  addDropdownLabel.mockResolvedValue({ id: 3, managedColumnId: null });
  renameDropdownLabel.mockResolvedValue({ managedColumnId: null, unchanged: false });
});

describe('creating a type opens its template editor (round304 §1)', () => {
  it('the add-type popup lands on the editor sub-tabs, not back on the list', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /הוסף סוג דיון חדש/ }));
    fireEvent.change(screen.getByLabelText('שם סוג הדיון'), { target: { value: 'סוג חדש' } });
    fireEvent.click(screen.getByRole('button', { name: 'צור' }));

    await waitFor(() => expect(addDropdownLabel).toHaveBeenCalledTimes(1));
    expect(addDropdownLabel.mock.calls[0][0]).toMatchObject({ title: 'סוג חדש', alias: 'discussionTypeID' });
    // the editor is open on the new type: its three sub-tabs + the type name as title
    await waitFor(() => expect(screen.getByRole('tab', { name: 'בעלי תפקידים' })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: "אג'נדה" })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'תבנית ייצוא' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'סוג חדש' })).toBeInTheDocument();
    // the popup closed behind it
    expect(screen.queryByLabelText('שם סוג הדיון')).toBeNull();
  });

  it('the inline "create from search" row opens the editor too', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('חיפוש או הוספת סוג דיון'), { target: { value: 'סוג נדיר' } });
    fireEvent.click(screen.getByRole('button', { name: /צור סוג דיון/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'בעלי תפקידים' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'סוג נדיר' })).toBeInTheDocument();
  });

  it('a FAILED create keeps the user on the list (nothing to configure)', async () => {
    addDropdownLabel.mockRejectedValue(new Error('permission'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: /הוסף סוג דיון חדש/ }));
    fireEvent.change(screen.getByLabelText('שם סוג הדיון'), { target: { value: 'סוג חדש' } });
    fireEvent.click(screen.getByRole('button', { name: 'צור' }));
    await waitFor(() => expect(mockLoggerError).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'בעלי תפקידים' })).toBeNull();
  });
});

describe('renaming a type template (round304 §2)', () => {
  const openEditorOnA = () => {
    fireEvent.click(screen.getByText('סוג A'));
    fireEvent.click(screen.getByRole('button', { name: 'שינוי שם התבנית' }));
  };

  it('renames the monday label by its id AND re-keys the stored template, then shows the new name', async () => {
    const f = setup({ typeTemplates: [{ id: 'TT1', discussionType: 'סוג A', topics: [], lead: [], coordinator: [], participants: [] }] });
    openEditorOnA();
    fireEvent.change(screen.getByLabelText('שם התבנית'), { target: { value: 'ישיבת הנהלה' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור שם' }));

    await waitFor(() => expect(renameDropdownLabel).toHaveBeenCalledTimes(1));
    expect(renameDropdownLabel.mock.calls[0][0]).toMatchObject({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'ישיבת הנהלה',
    });
    // the stored template/color/assignments/assets follow the rename
    expect(f.renameDiscussionType).toHaveBeenCalledWith('סוג A', 'ישיבת הנהלה');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ישיבת הנהלה' })).toBeInTheDocument());
    expect(screen.queryByLabelText('שם התבנית')).toBeNull();
  });

  it('blocks renaming onto an EXISTING type name — no API call, message shown, popup stays open', async () => {
    const f = setup();
    openEditorOnA();
    fireEvent.change(screen.getByLabelText('שם התבנית'), { target: { value: 'סוג B' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור שם' }));

    expect(await screen.findByText(/כבר קיים/)).toBeInTheDocument();
    expect(renameDropdownLabel).not.toHaveBeenCalled();
    expect(f.renameDiscussionType).not.toHaveBeenCalled();
    expect(screen.getByLabelText('שם התבנית')).toBeInTheDocument();
  });

  it('does not re-key anything when the monday rename FAILS (the label is the source of truth)', async () => {
    renameDropdownLabel.mockRejectedValue(new Error('אין הרשאה לעדכן את העמודה'));
    const f = setup();
    openEditorOnA();
    fireEvent.change(screen.getByLabelText('שם התבנית'), { target: { value: 'שם אחר' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור שם' }));

    await waitFor(() => expect(mockLoggerError).toHaveBeenCalled());
    expect(f.renameDiscussionType).not.toHaveBeenCalled();
    expect(await screen.findByText(/אין הרשאה/)).toBeInTheDocument();
    // still on the OLD name
    expect(screen.getByRole('heading', { name: 'סוג A' })).toBeInTheDocument();
  });

  it('an unchanged name just closes the popup without writing', async () => {
    const f = setup();
    openEditorOnA();
    fireEvent.click(screen.getByRole('button', { name: 'שמור שם' })); // pre-filled with the current name
    await waitFor(() => expect(screen.queryByLabelText('שם התבנית')).toBeNull());
    expect(renameDropdownLabel).not.toHaveBeenCalled();
    expect(f.renameDiscussionType).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round368 §1 (owner bug report) — external participants added in a TYPE
 * template's editor must reach STORAGE. The round367 wiring covered the editor
 * state, the save gate and the dirty snapshot, but the `upsertTypeTemplate`
 * payload itself omitted the field: the chips showed, שמור reported success, and
 * the names were dropped silently — so the create card had nothing to inject.
 * This test asserts the WRITE payload, which is the only place that proves it.
 */

const mockUseTemplates = vi.fn();
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => mockUseTemplates(),
}));

vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({ settings: {} }),
}));

const { typeOptions } = vi.hoisted(() => ({ typeOptions: { current: [{ id: 1, label: 'סוג A' }] } }));
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({
    options: typeOptions.current,
    labels: typeOptions.current.map((o) => o.label),
    loading: false,
  }),
  addDropdownLabel: vi.fn().mockResolvedValue({ id: 3, managedColumnId: null }),
  renameDropdownLabel: vi.fn().mockResolvedValue({ managedColumnId: null, unchanged: false }),
  renameDropdownLabelByText: vi.fn().mockResolvedValue({ missing: true }),
}));

// The external-participants column IS mapped, so the editor renders its field.
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({
    discussionLeadID: { id: 'lead' },
    externalParticipantsID: { id: 'long_text_ext' },
  }),
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
vi.mock('@generated/components/SettingsModal/ExportTemplateTab.jsx', () => ({
  default: () => <div data-testid="export-tab" />,
}));
vi.mock('@generated/components/SettingsModal/SettingsModal.jsx', () => ({
  seedExportTemplate: (t) => t || { headerMode: 'config', sections: [] },
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { TemplateManagerModal } from '../TemplateManagerModal';

function setup({ typeTemplates = [] } = {}) {
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
  };
  mockUseTemplates.mockReturnValue({
    templates: [], participantTemplates: [], typeTemplates, loading: false, ...f,
  });
  render(<TemplateManagerModal />);
  return f;
}

const openTypeEditor = () => fireEvent.click(screen.getByText('סוג A'));
const addExternal = (name) => {
  const input = screen.getByLabelText('הוספת משתתף חיצוני לתבנית');
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

beforeEach(() => {
  vi.clearAllMocks();
  typeOptions.current = [{ id: 1, label: 'סוג A' }];
});

describe('round368 — external participants reach the stored type template', () => {
  it('שמור writes the chips into the upsert payload', async () => {
    const f = setup({
      typeTemplates: [{
        id: 'TT1', discussionType: 'סוג A', topics: [{ name: 'נושא', points: [] }],
        lead: [], coordinator: [], participants: [], externalParticipants: [],
      }],
    });
    openTypeEditor();
    addExternal('רו"ח אבי שגב');
    expect(screen.getByText('רו"ח אבי שגב')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    await waitFor(() => expect(f.upsertTypeTemplate).toHaveBeenCalledTimes(1));
    expect(f.upsertTypeTemplate.mock.calls[0][0]).toMatchObject({
      discussionType: 'סוג A',
      externalParticipants: ['רו"ח אבי שגב'],
    });
  });

  it('an EXISTING stored external survives a save that did not touch it', async () => {
    const f = setup({
      typeTemplates: [{
        id: 'TT1', discussionType: 'סוג A', topics: [{ name: 'נושא', points: [] }],
        lead: [], coordinator: [], participants: [], externalParticipants: ['יועץ קיים'],
      }],
    });
    openTypeEditor();
    // seeded into the editor from storage
    expect(screen.getByText('יועץ קיים')).toBeInTheDocument();
    addExternal('נוסף');
    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    await waitFor(() => expect(f.upsertTypeTemplate).toHaveBeenCalledTimes(1));
    expect(f.upsertTypeTemplate.mock.calls[0][0].externalParticipants).toEqual(['יועץ קיים', 'נוסף']);
  });

  it('removing a chip removes it from the payload', async () => {
    const f = setup({
      typeTemplates: [{
        id: 'TT1', discussionType: 'סוג A', topics: [{ name: 'נושא', points: [] }],
        lead: [], coordinator: [], participants: [], externalParticipants: ['להסרה', 'להשארה'],
      }],
    });
    openTypeEditor();
    fireEvent.click(screen.getByRole('button', { name: 'הסרת להסרה' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    await waitFor(() => expect(f.upsertTypeTemplate).toHaveBeenCalledTimes(1));
    expect(f.upsertTypeTemplate.mock.calls[0][0].externalParticipants).toEqual(['להשארה']);
  });
});

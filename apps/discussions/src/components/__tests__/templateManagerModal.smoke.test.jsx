import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks for the panel's heavy / context dependencies ---
const mockUseTemplates = vi.fn();
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => mockUseTemplates(),
}));

// "סוג דיון" is a DROPDOWN column now — two options by TEXT.
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({
    options: [
      { id: 1, label: 'סוג A' },
      { id: 2, label: 'סוג B' },
    ],
    labels: ['סוג A', 'סוג B'],
    loading: false,
  }),
}));

// All three role columns mapped, so the people pickers render in the editors.
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({
    discussionLeadID: { id: 'lead' },
    discussionCoordinatorID: { id: 'coord' },
    participantsID: { id: 'parts' },
  }),
}));

// Live people-columns store — no-op in tests (labels fall back to schema titles).
vi.mock('@generated/utils/mondayApi/peopleColumns.js', () => ({
  ensurePeopleColumns: () => {},
  getColumnTitle: () => null,
  subscribe: () => () => {},
  getVersion: () => 0,
}));

vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: () => <div data-testid="person-picker" />,
}));

const mockLoggerError = vi.fn();
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: (...a) => mockLoggerError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { TemplateManagerModal } from '../TemplateManagerModal';

const fns = () => ({
  createTemplate: vi.fn().mockResolvedValue(true),
  updateTemplate: vi.fn().mockResolvedValue(true),
  deleteTemplate: vi.fn().mockResolvedValue(true),
  createParticipantTemplate: vi.fn().mockResolvedValue(true),
  updateParticipantTemplate: vi.fn().mockResolvedValue(true),
  deleteParticipantTemplate: vi.fn().mockResolvedValue(true),
  upsertTypeTemplate: vi.fn().mockResolvedValue(true),
  deleteTypeTemplate: vi.fn().mockResolvedValue(true),
  typeColor: () => 'var(--color-done-green)',
  typeColorName: () => 'done-green',
  setTypeColor: vi.fn().mockResolvedValue(true),
  assignRandomTypeColor: vi.fn().mockResolvedValue('done-green'),
  // round254 — per-type export template assets (config rides on the type template).
  loadTypeExportAssets: vi.fn().mockResolvedValue({ headerLogo: null, footerLogo: null, templateDocx: null }),
  saveTypeExportAssets: vi.fn().mockResolvedValue({ headerLogo: null, footerLogo: null, templateDocx: null }),
});

function setup({ templates = [], participantTemplates = [], typeTemplates = [], extra = {} } = {}) {
  const f = { ...fns(), ...extra };
  mockUseTemplates.mockReturnValue({
    templates,
    participantTemplates,
    typeTemplates,
    loading: false,
    ...f,
  });
  render(<TemplateManagerModal />);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateManagerModal', () => {
  it("new-template button reads 'תבנית חדשה' on both the נושאים and משתתפים tabs", () => {
    setup();
    // default tab is "לפי סוג דיון" (no add button) — switch to נושאים first.
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    expect(screen.getByRole('button', { name: 'תבנית חדשה' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'משתתפים' }));
    expect(screen.getByRole('button', { name: 'תבנית חדשה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'תבנית משתתפים חדשה' })).toBeNull();
  });

  it('back button renders icon-only with aria-label חזרה and no חזרה text in edit view', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    fireEvent.click(screen.getByRole('button', { name: 'תבנית חדשה' }));
    const back = screen.getByRole('button', { name: 'חזרה' });
    expect(back).toBeInTheDocument();
    expect(back.textContent).not.toMatch(/חזרה/);
  });

  it('TypeDropdown disables a type already taken by another template of the same kind', () => {
    setup({ templates: [{ id: 'T1', name: 'קיים', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }] }] });
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    fireEvent.click(screen.getByRole('button', { name: 'תבנית חדשה' }));
    fireEvent.click(screen.getByRole('button', { name: /ללא סוג|בחר/ }));
    const optA = screen.getByRole('option', { name: /סוג A/ });
    expect(optA).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(optA);
    expect(screen.queryByRole('button', { name: 'נקה סוג' })).toBeNull();
  });

  it('TypeDropdown does NOT disable the type currently assigned to the template being edited', () => {
    setup({ templates: [{ id: 'T1', name: 'קיים', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }] }] });
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    fireEvent.click(screen.getByRole('button', { name: /עריכה/ }));
    fireEvent.click(screen.getByRole('button', { name: /סוג A/ }));
    const optA = screen.getByRole('option', { name: /סוג A/ });
    expect(optA).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows an X clear control only when a value is set; clicking it resets to null without opening the menu', () => {
    setup({ templates: [{ id: 'T1', name: 'קיים', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }] }] });
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    fireEvent.click(screen.getByRole('button', { name: /עריכה/ }));
    const clear = screen.getByRole('button', { name: 'נקה סוג' });
    expect(clear).toBeInTheDocument();
    fireEvent.click(clear);
    expect(screen.getByText('ללא סוג')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'נקה סוג' })).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('handleSave guard: editing a template to a type owned by ANOTHER same-kind template blocks save + toasts', () => {
    const f = setup({
      templates: [
        { id: 'T1', name: 'ראשון', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }] },
        { id: 'T2', name: 'שני', discussionType: 'סוג A', topics: [{ name: 'מ', points: [] }] },
      ],
    });
    fireEvent.click(screen.getByRole('tab', { name: 'נושאים' }));
    const editButtons = screen.getAllByRole('button', { name: /עריכה/ });
    fireEvent.click(editButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0][0]).toBe('TemplateManagerModal');
    expect(mockLoggerError.mock.calls[0][1]).toMatch(/כבר קיימת תבנית מסוג זה/);
    expect(f.updateTemplate).not.toHaveBeenCalled();
  });

  it('"לפי סוג דיון" is the default tab, lists ALL types, and upserts the unified template on save', async () => {
    const f = setup({
      typeTemplates: [{ id: 'TT1', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }], lead: [], coordinator: [], participants: [{ id: 'u1', name: 'א' }] }],
    });
    // default tab — both types pre-listed (one with a template, one without).
    expect(screen.getByText('סוג A')).toBeInTheDocument();
    expect(screen.getByText('סוג B')).toBeInTheDocument();
    expect(screen.getByText(/1 נושאים · 1 משתתפים/)).toBeInTheDocument();
    expect(screen.getByText(/ללא תבנית/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('סוג A'));
    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    expect(f.upsertTypeTemplate).toHaveBeenCalledTimes(1);
    expect(f.upsertTypeTemplate.mock.calls[0][0].discussionType).toBe('סוג A');
    expect(f.upsertTypeTemplate.mock.calls[0][0].topics).toEqual([{ name: 'נ', points: [] }]);
    // the type's chosen color NAME is persisted too (after the upsert await resolves)
    await waitFor(() => expect(f.setTypeColor).toHaveBeenCalledWith('סוג A', 'done-green'));
  });

  it('"לפי סוג דיון" tab has no "תבנית חדשה" button (rows are the entry point)', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'תבנית חדשה' })).toBeNull();
  });

  it('allows the same discussionType across DIFFERENT kinds (topics + participants may share a type)', () => {
    const f = setup({
      templates: [{ id: 'T1', name: 'נושאים', discussionType: 'סוג A', topics: [{ name: 'נ', points: [] }] }],
      participantTemplates: [{ id: 'P1', name: 'אנשים', discussionType: 'סוג A', lead: [], coordinator: [], participants: [{ id: 'u1' }] }],
    });
    fireEvent.click(screen.getByRole('tab', { name: 'משתתפים' }));
    fireEvent.click(screen.getByRole('button', { name: /עריכה/ }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור תבנית' }));
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(f.updateParticipantTemplate).toHaveBeenCalledTimes(1);
  });
});

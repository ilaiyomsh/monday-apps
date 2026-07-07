import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { getMondayMock, type MondayMock } from '../../../test-utils/mondayMock';

vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));

import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import i18n from '../../../i18n';
import { SettingsDialog } from '../SettingsDialog';
import type { PlannerSettings } from '../../../types/settings.types';

/**
 * DAY-OFF-INTEGRATION W3.6 — the Availability tab is the manual mapping
 * surface (D9) for the Day-off vacations board (`Day-off/CONTRACT.md`).
 *
 * Locks the UI contract:
 * 1. The tab carries TWO sections — the Day-off mapping (primary) and the
 *    legacy single-date absence mapping (kept reachable during migration, D7).
 * 2. Column/label pickers appear only once a vacations board is mapped.
 * 3. The D2 approval toggle reveals (and hides) the approval column +
 *    approved-labels multi-select.
 * 4. Kind labels cross-filter — the same label ID cannot mean both kinds.
 * 5. Changing the board cascades a reset of every column/label mapping while
 *    the D2 policy toggle survives (policy, not board mapping).
 * 6. Every new i18n key resolves in BOTH bundles (he + en).
 */

const SETTINGS_KEY = 'planner_app_settings';

const BOARDS = [
  { id: 'alloc-board', name: 'Allocations board', type: 'board' },
  { id: 'vac-board', name: 'Vacations board', type: 'board' },
  { id: 'timelogs-board', name: 'Time logs board', type: 'board' },
];

// Status `settings` blobs in monday's object-map form: { labels: { <labelId>: <text> } }.
// extractStatusLabels reads these — label IDs are the option ids (never text).
const KIND_COLUMN_SETTINGS = JSON.stringify({ labels: { '0': 'Personal', '2': 'General' } });
const TYPE_COLUMN_SETTINGS = JSON.stringify({ labels: { '1': 'Vacation', '3': 'Sick' } });
const APPROVAL_COLUMN_SETTINGS = JSON.stringify({ labels: { '0': 'Pending', '1': 'Approved', '2': 'Rejected' } });

const VACATION_COLUMNS = [
  { id: 'person_col', title: 'Person', type: 'people', settings: '{}' },
  { id: 'start_col', title: 'Start date', type: 'date', settings: '{}' },
  { id: 'end_col', title: 'End date', type: 'date', settings: '{}' },
  { id: 'kind_col', title: 'Kind', type: 'status', settings: KIND_COLUMN_SETTINGS },
  { id: 'type_col', title: 'Absence type', type: 'status', settings: TYPE_COLUMN_SETTINGS },
  { id: 'approval_col', title: 'Approval', type: 'status', settings: APPROVAL_COLUMN_SETTINGS },
  { id: 'mandatory_col', title: 'Mandatory', type: 'checkbox', settings: '{}' },
];

const TIMELOGS_COLUMNS = [
  { id: 'l_person', title: 'Reporter', type: 'people', settings: '{}' },
  { id: 'l_date', title: 'Date', type: 'date', settings: '{}' },
  { id: 'l_type', title: 'Report type', type: 'status', settings: JSON.stringify({ labels: { '5': 'All day' } }) },
];

const FULL_DAYOFF_MAPPING: Partial<PlannerSettings> = {
  dayOffBoardId: 'vac-board',
  dayOffEmployeeColumnId: 'person_col',
  dayOffStartDateColumnId: 'start_col',
  dayOffEndDateColumnId: 'end_col',
  dayOffKindColumnId: 'kind_col',
  dayOffKindGeneralLabelId: '2',
  dayOffKindPersonalLabelId: '0',
  dayOffTypeColumnId: 'type_col',
  dayOffMandatoryColumnId: 'mandatory_col',
};

const tt = (key: string) => i18n.t(key);
const F = (field: string) => tt(`settings.availability.dayoff.fields.${field}`);

let monday: MondayMock;

// jsdom defaults hostname to 'localhost', which puts useMondaySettings in dev
// mode (saves stay in memory and never reach storage). Force a production-like
// hostname so the save round trip below exercises the real storage path —
// same pattern as useMondaySettings.dayoff.test.ts (W3.1).
const SILENT_RELOAD_FLAG = 'planner_silent_reload_done';
const originalLocation = window.location;

afterEach(() => {
  try { sessionStorage.removeItem(SILENT_RELOAD_FLAG); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

beforeEach(async () => {
  monday = getMondayMock();
  monday.__reset();
  try { sessionStorage.setItem(SILENT_RELOAD_FLAG, '1'); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, hostname: 'app.monday.com', reload: vi.fn() },
  });
  monday.mockApi('boards (limit', async () => ({ data: { boards: BOARDS } }));
  monday.mockApi('columns', async (_query, options) => {
    const ids = (options?.variables?.boardId as string[]) ?? [];
    const columns =
      ids[0] === 'vac-board' ? VACATION_COLUMNS : ids[0] === 'timelogs-board' ? TIMELOGS_COLUMNS : [];
    return { data: { boards: [{ columns }] } };
  });
  await i18n.changeLanguage('he');
});

const renderDialog = (initialSettings?: Partial<PlannerSettings>) =>
  renderWithProviders(<SettingsDialog isOpen={true} onClose={() => {}} boardId={123} />, {
    monday,
    initialSettings,
    withoutActiveProjects: true,
  });

const openAvailabilityTab = async () => {
  const tab = await screen.findByRole('button', { name: tt('settings.tabs.availability') });
  fireEvent.click(tab);
};

const openSection = (title: string) => {
  fireEvent.click(screen.getByText(title));
};

describe('SettingsDialog — Day-off availability tab (W3.6)', () => {
  it('shows the Day-off section; pickers hidden until a board is mapped', async () => {
    renderDialog();
    await openAvailabilityTab();

    expect(screen.getByText(tt('settings.availability.dayoff.title'))).toBeInTheDocument();

    openSection(tt('settings.availability.dayoff.title'));
    expect(await screen.findByText(F('board'))).toBeInTheDocument();
    // No board mapped ⇒ no column pickers, no D2 toggle.
    expect(screen.queryByText(F('employee'))).not.toBeInTheDocument();
    expect(screen.queryByText(F('approvalRequired'))).not.toBeInTheDocument();
  });

  it('renders every mapping picker for a mapped board; the approval COLUMN is offered even while the D2 toggle is OFF (DEV-2), approved/rejected labels need a column', async () => {
    renderDialog(FULL_DAYOFF_MAPPING);
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(F('employee'))).toBeInTheDocument();
    for (const field of ['startDate', 'endDate', 'kind', 'generalLabel', 'personalLabel', 'type', 'mandatory']) {
      expect(screen.getByText(F(field))).toBeInTheDocument();
    }

    const toggle = screen.getByLabelText(F('approvalRequired'));
    expect(toggle).not.toBeChecked();
    // DEV-2: the approval column picker is policy-independent — rejected
    // exclusion needs it even when the policy is OFF.
    expect(screen.getByText(F('approvalColumn'))).toBeInTheDocument();
    // No approval column mapped yet ⇒ neither label multi-select renders.
    expect(screen.queryByText(F('approvedValues'))).not.toBeInTheDocument();
    expect(screen.queryByText(F('rejectedValues'))).not.toBeInTheDocument();
  });

  it('D2 toggle controls ONLY the approved-labels multi-select; the approval column + rejected labels survive toggling (DEV-2)', async () => {
    renderDialog({
      ...FULL_DAYOFF_MAPPING,
      dayOffApprovalRequired: true,
      dayOffApprovalColumnId: 'approval_col',
      dayOffApprovedLabelIds: ['1'],
      dayOffRejectedLabelIds: ['2'],
    });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(F('approvalColumn'))).toBeInTheDocument();
    expect(screen.getByText(F('approvedValues'))).toBeInTheDocument();
    expect(screen.getByText(F('rejectedValues'))).toBeInTheDocument();
    expect(screen.getByLabelText(F('approvalRequired'))).toBeChecked();

    // OFF: approved-labels hide; the column + rejected mapping stay (rejected
    // exclusion is policy-independent per DEV-2).
    fireEvent.click(screen.getByLabelText(F('approvalRequired')));
    expect(screen.getByText(F('approvalColumn'))).toBeInTheDocument();
    expect(screen.queryByText(F('approvedValues'))).not.toBeInTheDocument();
    expect(screen.getByText(F('rejectedValues'))).toBeInTheDocument();

    // Back ON — the draft kept the values, so the approved field returns.
    fireEvent.click(screen.getByLabelText(F('approvalRequired')));
    expect(await screen.findByText(F('approvedValues'))).toBeInTheDocument();
    expect(screen.getByText(F('rejectedValues'))).toBeInTheDocument();
  });

  it('kind label pickers cross-filter — a label already meaning personal is not offered as general', async () => {
    renderDialog({
      dayOffBoardId: 'vac-board',
      dayOffKindColumnId: 'kind_col',
      dayOffKindPersonalLabelId: '0',
    });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));
    await screen.findByText(F('generalLabel'));

    // Both label pickers share the placeholder; DOM order is general → personal.
    const [generalInput] = screen.getAllByPlaceholderText(tt('settings.placeholder.label'));
    fireEvent.click(generalInput);

    expect(await screen.findByRole('button', { name: 'General' })).toBeInTheDocument();
    // 'Personal' (label id '0') is taken by the personal picker ⇒ filtered out.
    expect(screen.queryByRole('button', { name: 'Personal' })).not.toBeInTheDocument();
  });

  it('changing the vacations board resets every column/label mapping but keeps the D2 policy toggle', async () => {
    renderDialog({
      ...FULL_DAYOFF_MAPPING,
      dayOffApprovalRequired: true,
      dayOffApprovalColumnId: 'approval_col',
      dayOffApprovedLabelIds: ['1'],
    });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));
    await screen.findByText(F('employee'));

    // Open the board picker (clearing the search term shows all options) and
    // pick a different board.
    const boardInput = screen.getByPlaceholderText(tt('settings.placeholder.board'));
    fireEvent.click(boardInput);
    fireEvent.change(boardInput, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Allocations board' }));

    fireEvent.click(screen.getByRole('button', { name: tt('settings.dialog.saveButton') }));

    await waitFor(() => {
      const raw = monday.__getStorage(SETTINGS_KEY);
      expect(raw).toBeTruthy();
      const saved = JSON.parse(raw as string) as PlannerSettings;
      expect(saved.dayOffBoardId).toBe('alloc-board');
      expect(saved.dayOffEmployeeColumnId).toBe('');
      expect(saved.dayOffStartDateColumnId).toBe('');
      expect(saved.dayOffEndDateColumnId).toBe('');
      expect(saved.dayOffKindColumnId).toBe('');
      expect(saved.dayOffKindGeneralLabelId).toBe('');
      expect(saved.dayOffKindPersonalLabelId).toBe('');
      expect(saved.dayOffTypeColumnId).toBe('');
      expect(saved.dayOffMandatoryColumnId).toBe('');
      expect(saved.dayOffApprovalColumnId).toBe('');
      expect(saved.dayOffApprovedLabelIds).toEqual([]);
      // Policy survives a board remap (it is policy, not board mapping).
      expect(saved.dayOffApprovalRequired).toBe(true);
    });
  });

  it('every new availability i18n key resolves in BOTH bundles (he + en)', () => {
    const keys = [
      'settings.availability.dayoff.title',
      'settings.availability.dayoff.description',
      ...[
        'board', 'boardHelp', 'employee', 'employeeHelp', 'startDate', 'endDate',
        'kind', 'kindHelp', 'generalLabel', 'personalLabel', 'kindLabelsHelp',
        'type', 'typeHelp', 'mandatory', 'mandatoryHelp',
        'approvalRequired', 'approvalRequiredHelp', 'approvalColumn',
        'approvedValues', 'approvedValuesHelp',
      ].map((f) => `settings.availability.dayoff.fields.${f}`),
      'settings.placeholder.label',
      'settings.placeholder.checkboxColumn',
      'settings.placeholder.approvedStatuses',
    ];
    for (const lng of ['he', 'en'] as const) {
      for (const key of keys) {
        const value = i18n.t(key, { lng });
        expect(value, `${lng}:${key}`).toBeTruthy();
        expect(value, `${lng}:${key}`).not.toBe(key);
      }
    }
  });
});

describe('SettingsDialog — Day-off mapping validation surfaces in the dialog (W3.7)', () => {
  const V = (key: string) => tt(`settings.validation.dayoff.${key}`);

  it('a half-configured mapping renders required-field errors in the availability tab', async () => {
    renderDialog({ dayOffBoardId: 'vac-board' });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(V('employeeColumn'))).toBeInTheDocument();
    expect(screen.getByText(V('startDateColumn'))).toBeInTheDocument();
    expect(screen.getByText(V('endDateColumn'))).toBeInTheDocument();
    expect(screen.getByText(V('kindColumn'))).toBeInTheDocument();
  });

  it('a Day-off source without the Employees-board user column shows the identity-join error; without a source it does not', async () => {
    const { unmount } = renderDialog(FULL_DAYOFF_MAPPING);
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));
    // FULL_DAYOFF_MAPPING has no employeeUserIdColumnId ⇒ the identity join is broken.
    expect(await screen.findByText(V('identityJoin'))).toBeInTheDocument();
    unmount();

    renderDialog({});
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));
    await screen.findByText(F('board'));
    expect(screen.queryByText(V('identityJoin'))).not.toBeInTheDocument();
  });

  it('a configured column that no longer exists on the live board renders the deleted-column error', async () => {
    renderDialog({ ...FULL_DAYOFF_MAPPING, dayOffStartDateColumnId: 'deleted_col' });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(V('columnMissing'))).toBeInTheDocument();
  });

  it('a configured kind label ID missing from the live column settings renders the label error', async () => {
    renderDialog({ ...FULL_DAYOFF_MAPPING, dayOffKindGeneralLabelId: '99' });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(V('labelMissing'))).toBeInTheDocument();
  });

  it('turning the D2 toggle ON surfaces the approval-column requirement; OFF clears it', async () => {
    renderDialog(FULL_DAYOFF_MAPPING);
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));
    await screen.findByText(F('employee'));

    expect(screen.queryByText(V('approvalColumn'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(F('approvalRequired')));
    expect(await screen.findByText(V('approvalColumn'))).toBeInTheDocument();
    // The approved-labels slot is gated on the approval column being picked
    // (W3.6 structure) — its error becomes visible once the column is set
    // (covered by the next test); the tab red-dot fires either way.
    expect(screen.queryByText(V('approvedLabels'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(F('approvalRequired')));
    expect(screen.queryByText(V('approvalColumn'))).not.toBeInTheDocument();
  });

  it('D2 ON + approval column picked + empty approved set renders the approved-labels requirement', async () => {
    renderDialog({
      ...FULL_DAYOFF_MAPPING,
      dayOffApprovalRequired: true,
      dayOffApprovalColumnId: 'approval_col',
      dayOffApprovedLabelIds: [],
    });
    await openAvailabilityTab();
    openSection(tt('settings.availability.dayoff.title'));

    expect(await screen.findByText(V('approvedLabels'))).toBeInTheDocument();
    expect(screen.queryByText(V('approvalColumn'))).not.toBeInTheDocument();
  });

  it('every new validation i18n key resolves in BOTH bundles (he + en)', () => {
    const keys = [
      'identityJoin', 'employeeColumn', 'startDateColumn', 'endDateColumn',
      'kindColumn', 'generalLabel', 'personalLabel', 'approvalColumn',
      'approvedLabels', 'boardNotFound', 'columnMissing', 'labelMissing',
      'approvedLabelsMissing',
    ].map((k) => `settings.validation.dayoff.${k}`);
    for (const lng of ['he', 'en'] as const) {
      for (const key of keys) {
        const value = i18n.t(key, { lng });
        expect(value, `${lng}:${key}`).toBeTruthy();
        expect(value, `${lng}:${key}`).not.toBe(key);
      }
    }
  });
});

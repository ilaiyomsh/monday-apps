/**
 * W3.7 (DAY-OFF-INTEGRATION) — fail-loud settings validation for the dayOff*
 * vacations-board mapping (`Day-off/CONTRACT.md` §5.6):
 *
 * 1. Requiredness fires only when a Day-off source is configured
 *    (`dayOffBoardId` set) — unconfigured/legacy-only settings validate
 *    exactly as before.
 * 2. Approval mapping (column + approved label IDs) is required iff the D2
 *    policy toggle is ON — never while OFF.
 * 3. The Employees-board user column (the identity join) is required whenever
 *    a Day-off source is configured (`dayOffIdentityJoin`).
 * 4. Live checks (via `context.dayOffLive`): board existence, deleted-column
 *    refs (including OPTIONAL configured columns), label-ID resolvability
 *    against the live column `settings` labels.
 * 5. Live checks are skipped while live data is absent or belongs to another
 *    board (board-switch race / failed fetch) — no false errors.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook } from '@testing-library/react';

import i18n from '../../i18n';
import { useSettingsValidation, type DayOffLiveBoard } from '../useSettingsValidation';
import type { PlannerSettings } from '../../types/settings.types';

const KIND_PERSONAL = '0';
const KIND_GENERAL = '2';
const APPROVED = '1';

/** Fully valid base settings — the no-day-off baseline is green. */
const VALID_BASE: Partial<PlannerSettings> = {
  allocationsBoardId: 'alloc-board',
  startDateColumnId: 'start',
  endDateColumnId: 'end',
  hoursPerDayColumnId: 'hours',
  projectColumnId: 'project',
  employeeColumnId: 'employee',
  roleColumnId: 'role',
  employeesBoardId: 'emp-board',
  employeeNameColumnId: 'name',
  employeeRoleColumnId: 'erole',
  employeeAllocationPercentColumnId: 'fte',
  employeeUserIdColumnId: 'user',
  workDayStart: '09:00',
  workDayEnd: '17:00',
};

/** Complete Day-off mapping (D2 toggle OFF). */
const DAY_OFF_MAPPING: Partial<PlannerSettings> = {
  dayOffBoardId: 'vac-board',
  dayOffEmployeeColumnId: 'person_col',
  dayOffStartDateColumnId: 'start_col',
  dayOffEndDateColumnId: 'end_col',
  dayOffKindColumnId: 'kind_col',
  dayOffKindGeneralLabelId: KIND_GENERAL,
  dayOffKindPersonalLabelId: KIND_PERSONAL,
  dayOffTypeColumnId: 'type_col',
  dayOffMandatoryColumnId: 'mandatory_col',
};

const KIND_COLUMN_SETTINGS = JSON.stringify({
  labels: { [KIND_PERSONAL]: 'Personal', [KIND_GENERAL]: 'General' },
});
const APPROVAL_COLUMN_SETTINGS = JSON.stringify({
  labels: { '0': 'Pending', [APPROVED]: 'Approved', '2': 'Rejected' },
});

/** Live columns matching DAY_OFF_MAPPING exactly. */
const LIVE_COLUMNS: DayOffLiveBoard['columns'] = [
  { id: 'name', type: 'name', settings: '{}' },
  { id: 'person_col', type: 'people', settings: '{}' },
  { id: 'start_col', type: 'date', settings: '{}' },
  { id: 'end_col', type: 'date', settings: '{}' },
  { id: 'kind_col', type: 'status', settings: KIND_COLUMN_SETTINGS },
  { id: 'type_col', type: 'status', settings: JSON.stringify({ labels: { '1': 'Vacation' } }) },
  { id: 'approval_col', type: 'status', settings: APPROVAL_COLUMN_SETTINGS },
  { id: 'mandatory_col', type: 'checkbox', settings: '{}' },
];

const LIVE: DayOffLiveBoard = { boardId: 'vac-board', columns: LIVE_COLUMNS };

interface TestContext {
  boardId?: string;
  dayOffLive?: DayOffLiveBoard;
}

const validate = (settings: Partial<PlannerSettings>, context?: TestContext) => {
  const { result } = renderHook(() =>
    useSettingsValidation(settings as PlannerSettings, context)
  );
  return result.current;
};

const msg = (key: string) => i18n.t(`settings.validation.dayoff.${key}`);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('useSettingsValidation — Day-off mapping (W3.7)', () => {
  describe('unconfigured stays unchanged', () => {
    it('valid base settings with NO day-off source produce zero errors', () => {
      const { errors, isValid } = validate(VALID_BASE);
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });
  });

  describe('requiredness once a Day-off source is configured', () => {
    it('board mapped + nothing else ⇒ employee/start/end/kind column errors (labels gated on the kind column)', () => {
      const { errors, isValid } = validate({ ...VALID_BASE, dayOffBoardId: 'vac-board' });
      expect(errors.dayOffEmployeeColumnId).toBe(msg('employeeColumn'));
      expect(errors.dayOffStartDateColumnId).toBe(msg('startDateColumn'));
      expect(errors.dayOffEndDateColumnId).toBe(msg('endDateColumn'));
      expect(errors.dayOffKindColumnId).toBe(msg('kindColumn'));
      expect(errors.dayOffKindGeneralLabelId).toBeUndefined();
      expect(errors.dayOffKindPersonalLabelId).toBeUndefined();
      expect(isValid).toBe(false);
    });

    it('kind column chosen ⇒ both kind label IDs become required', () => {
      const { errors } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        dayOffKindGeneralLabelId: '',
        dayOffKindPersonalLabelId: '',
      });
      expect(errors.dayOffKindGeneralLabelId).toBe(msg('generalLabel'));
      expect(errors.dayOffKindPersonalLabelId).toBe(msg('personalLabel'));
    });

    it('a complete mapping (toggle OFF, no live data) is valid', () => {
      const { errors, isValid } = validate({ ...VALID_BASE, ...DAY_OFF_MAPPING });
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });

    it('optional type/mandatory columns are NOT required', () => {
      const { errors } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        dayOffTypeColumnId: '',
        dayOffMandatoryColumnId: '',
      });
      expect(errors).toEqual({});
    });
  });

  describe('identity join (Employees-board user column)', () => {
    it('day-off source configured + employeeUserIdColumnId unmapped ⇒ dayOffIdentityJoin error', () => {
      const { errors } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        employeeUserIdColumnId: '',
      });
      expect(errors.dayOffIdentityJoin).toBe(msg('identityJoin'));
      // The generic employees-tab requirement still fires too (pre-existing).
      expect(errors.employeeUserIdColumnId).toBeTruthy();
    });

    it('no day-off source ⇒ no dayOffIdentityJoin error (only the generic employees-tab one)', () => {
      const { errors } = validate({ ...VALID_BASE, employeeUserIdColumnId: '' });
      expect(errors.dayOffIdentityJoin).toBeUndefined();
      expect(errors.employeeUserIdColumnId).toBeTruthy();
    });
  });

  describe('approval mapping required iff the D2 toggle is ON', () => {
    it('toggle OFF ⇒ approval column/labels never required', () => {
      const { errors, isValid } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        dayOffApprovalRequired: false,
      });
      expect(errors.dayOffApprovalColumnId).toBeUndefined();
      expect(errors.dayOffApprovedLabelIds).toBeUndefined();
      expect(isValid).toBe(true);
    });

    it('toggle ON + nothing mapped ⇒ both approval errors', () => {
      const { errors } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        dayOffApprovalRequired: true,
      });
      expect(errors.dayOffApprovalColumnId).toBe(msg('approvalColumn'));
      expect(errors.dayOffApprovedLabelIds).toBe(msg('approvedLabels'));
    });

    it('toggle ON + column + non-empty approved set ⇒ valid', () => {
      const { errors, isValid } = validate({
        ...VALID_BASE,
        ...DAY_OFF_MAPPING,
        dayOffApprovalRequired: true,
        dayOffApprovalColumnId: 'approval_col',
        dayOffApprovedLabelIds: [APPROVED],
      });
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });
  });

  describe('live checks — board existence', () => {
    it('an empty live column list means the board is gone ⇒ dayOffBoardId error', () => {
      const { errors, isValid } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'vac-board', columns: [] } }
      );
      expect(errors.dayOffBoardId).toBe(msg('boardNotFound'));
      expect(isValid).toBe(false);
    });

    it('live data for ANOTHER board is ignored (board-switch race guard)', () => {
      const { errors, isValid } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'other-board', columns: [] } }
      );
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });

    it('no live data at all ⇒ only requiredness rules run', () => {
      const { errors, isValid } = validate({ ...VALID_BASE, ...DAY_OFF_MAPPING }, {});
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });
  });

  describe('live checks — deleted-column refs', () => {
    it('a configured REQUIRED column missing from the live board fails', () => {
      const { errors } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'vac-board', columns: LIVE_COLUMNS.filter((c) => c.id !== 'start_col') } }
      );
      expect(errors.dayOffStartDateColumnId).toBe(msg('columnMissing'));
      expect(errors.dayOffEndDateColumnId).toBeUndefined();
    });

    it('configured OPTIONAL columns (type/mandatory) are existence-checked too', () => {
      const { errors } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        {
          dayOffLive: {
            boardId: 'vac-board',
            columns: LIVE_COLUMNS.filter((c) => c.id !== 'type_col' && c.id !== 'mandatory_col'),
          },
        }
      );
      expect(errors.dayOffTypeColumnId).toBe(msg('columnMissing'));
      expect(errors.dayOffMandatoryColumnId).toBe(msg('columnMissing'));
    });

    it('a fully-matching live board produces zero errors', () => {
      const { errors, isValid } = validate(
        {
          ...VALID_BASE,
          ...DAY_OFF_MAPPING,
          dayOffApprovalRequired: true,
          dayOffApprovalColumnId: 'approval_col',
          dayOffApprovedLabelIds: [APPROVED],
        },
        { dayOffLive: LIVE }
      );
      expect(errors).toEqual({});
      expect(isValid).toBe(true);
    });
  });

  describe('live checks — label-ID resolvability', () => {
    it('a configured kind label ID missing from the live column settings fails', () => {
      const columns = LIVE_COLUMNS.map((c) =>
        c.id === 'kind_col'
          ? { ...c, settings: JSON.stringify({ labels: { [KIND_PERSONAL]: 'Personal' } }) }
          : c
      );
      const { errors } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'vac-board', columns } }
      );
      expect(errors.dayOffKindGeneralLabelId).toBe(msg('labelMissing'));
      expect(errors.dayOffKindPersonalLabelId).toBeUndefined();
    });

    it('kind column type drift (no longer a status column) makes its label IDs unresolvable', () => {
      const columns = LIVE_COLUMNS.map((c) =>
        c.id === 'kind_col' ? { ...c, type: 'text', settings: '{}' } : c
      );
      const { errors } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'vac-board', columns } }
      );
      expect(errors.dayOffKindGeneralLabelId).toBe(msg('labelMissing'));
      expect(errors.dayOffKindPersonalLabelId).toBe(msg('labelMissing'));
    });

    it('a stale approved label ID fails loudly even while the D2 toggle is OFF', () => {
      const { errors } = validate(
        {
          ...VALID_BASE,
          ...DAY_OFF_MAPPING,
          dayOffApprovalRequired: false,
          dayOffApprovalColumnId: 'approval_col',
          dayOffApprovedLabelIds: [APPROVED, '99'],
        },
        { dayOffLive: LIVE }
      );
      expect(errors.dayOffApprovedLabelIds).toBe(msg('approvedLabelsMissing'));
    });

    it('label checks are skipped when the column itself is missing (no double error)', () => {
      const { errors } = validate(
        { ...VALID_BASE, ...DAY_OFF_MAPPING },
        { dayOffLive: { boardId: 'vac-board', columns: LIVE_COLUMNS.filter((c) => c.id !== 'kind_col') } }
      );
      expect(errors.dayOffKindColumnId).toBe(msg('columnMissing'));
      expect(errors.dayOffKindGeneralLabelId).toBeUndefined();
      expect(errors.dayOffKindPersonalLabelId).toBeUndefined();
    });
  });
});

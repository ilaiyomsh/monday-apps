export type Language = 'he' | 'en';

/* Removed (2026-06-18) the local dead cluster MondayUser / MondaySdkContext /
   MondayContextValue / Dir: unused, it shadowed @axis/app-core's exported
   MondayContextValue and omitted the `mode`/isMobile signal. Mobile detection
   now lives in src/hooks/useIsMobile.ts; the real context type comes from
   @axis/app-core. */

import type { AbsenceType, RequestStatus } from '../domain/types';

/**
 * Column-id mapping for the single "vacations" board. Every day-off entry —
 * personal request OR general/company day — is one item on this board; the
 * `kindColumnId` status discriminates between them.
 */
export interface VacationColumnMap {
  /** Status column whose label separates general (company) from personal entries. */
  kindColumnId?: string;
  /** People column — the employee a personal entry belongs to. */
  personColumnId?: string;
  /** Date column — the entry's start day. */
  startDateColumnId?: string;
  /** Date column — the entry's end day. */
  endDateColumnId?: string;
  /** Numbers column the app fills with the computed number of workdays. */
  workdaysColumnId?: string;
  /** Status column classifying a PERSONAL entry (vacation / sick / reserves). */
  personalTypeColumnId?: string;
  /** Status column holding the approval state of a personal request. */
  approvalStatusColumnId?: string;
  empNoteColumnId?: string;
  mgrNoteColumnId?: string;
  decidedByColumnId?: string;
  decidedAtColumnId?: string;
  fileColumnId?: string;
  /** Checkbox column — a general/company day is mandatory (office closed). */
  mandatoryColumnId?: string;
}

/** Maps each absence type → the label text used by the personal-type status column. */
export type TypeValueMap = Record<AbsenceType, string>;
/**
 * Maps each request status → the approval-status column label.
 * Matching is by stable monday label ID first (`labelIds`, org standard); the
 * text fields remain as display + case-insensitive fallback for settings saved
 * before label IDs were stored (legacy blobs simply lack `labelIds`).
 */
export interface StatusValueMap {
  pending: string;
  approved: string;
  rejected: string;
  /** Stable monday label ids per status (stringified, as in `PersonalTypeOption.id`). */
  labelIds?: Partial<Record<RequestStatus, string | null>>;
}
/** The two labels of the kind/discriminator status column. */
export interface KindValueMap {
  /** Label that marks an item as a general / company-wide day. */
  general: string;
  /** Label that marks an item as a personal day-off request. */
  personal: string;
  /** Stable monday label id of the general label (ID-first matching; text is fallback). */
  generalLabelId?: string | null;
  /** Stable monday label id of the personal label (ID-first matching; text is fallback). */
  personalLabelId?: string | null;
}

/** Snapshot of personal absence type labels from the board status column. */
export interface PersonalTypeOption {
  /** Stable monday label id (source of truth for read/write). */
  id: string;
  /** Display label text from monday status settings. */
  title: string;
  /** Label color as provided by monday status settings. */
  color: string;
  /** Raw monday status color value (enum/id) for update mutations. */
  colorValue?: string | number;
  /** Label display position in the status column (0–39). Item writes use `id`, not this. */
  index: number;
  isDone?: boolean;
  isDeactivated?: boolean;
}

/**
 * A team — a named group with its own managers and employees (monday user ids).
 * A user may appear in several teams, and may be a manager in one while an
 * employee in another. `managers` may approve requests and see the manager tabs.
 */
export interface Team {
  id: string;
  name: string;
  /** Monday user ids that manage this team (approve + see manager tabs). */
  managers: string[];
  /** Monday user ids that belong to this team as regular members. */
  employees: string[];
}

/**
 * Day-off settings — custom object app (no reliable context.boardId, so the
 * board + column mappings + team/roles are configured here). All day-off data
 * lives on ONE board; the kind status column splits general vs personal.
 */
export interface DayOffSettings {
  /** The single board where every day-off entry (personal + general) lives. */
  vacationBoardId: string | null;
  columns: VacationColumnMap;
  /** Labels in the kind status column that mean general / personal. */
  kindValues: KindValueMap;
  /** @deprecated legacy mapping; kept for backward compatibility with old data. */
  typeValues: TypeValueMap;
  /** Personal-type labels cache (id/title/color/index), shared for all users. */
  personalTypes: PersonalTypeOption[];
  /** Approval status enum → board status label (pending/approved/rejected). */
  statusValues: StatusValueMap;
  /** Approval-status labels cache (id/title/color/index) for UI colors. */
  approvalStatusTypes: PersonalTypeOption[];
  /** Teams — each with its own managers + employees. Source of truth for roles. */
  teams: Team[];
  languageOverride?: Language | null;
  lastModifiedAt?: string | null;
}

export const DEFAULT_SETTINGS: DayOffSettings = {
  vacationBoardId: null,
  columns: {},
  kindValues: { general: '', personal: '' },
  typeValues: { vacation: '', sick: '', reserves: '' },
  personalTypes: [],
  statusValues: { pending: '', approved: '', rejected: '' },
  approvalStatusTypes: [],
  teams: [],
  languageOverride: null,
  lastModifiedAt: null,
};

export interface AppError {
  message: string;
  details?: unknown;
}

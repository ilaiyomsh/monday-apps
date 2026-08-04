// Shared admin-view types — v2 (dynamic buttons + email templates).
// targetIndex holds the status LABEL ID (settings.labels[].id — stable);
// labels[].index is display order only. Label id 0 is valid.

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonStyle {
  color: string; // #rrggbb
  icon: string; // emoji / short text, may be ''
  size: ButtonSize;
}

export interface ActionButton {
  id: string; // b_XXXXXXXX — client-generated on add, server validates
  name: string;
  statusColumnId: string;
  targetIndex: number; // label id
  targetLabel: string;
  style: ButtonStyle;
}

export type Direction = 'rtl' | 'ltr';
export type TextAlign = 'right' | 'center' | 'left';

export interface TextBlock {
  type: 'text';
  text: string;
  direction: Direction;
  font: string; // from EMAIL_FONTS
  fontSize: number; // 10..32
  align: TextAlign;
}

export interface ButtonsBlock {
  type: 'buttons';
  buttonIds: string[];
}

export type TemplateBlock = TextBlock | ButtonsBlock;

export interface EmailTemplate {
  id: string; // t_XXXXXXXX
  name: string;
  blocks: TemplateBlock[];
}

// v4 digest — a dedicated users board (people column ↔ email column) maps
// person ids to recipient addresses; each section pairs a date column on the
// TASKS board with one of the action buttons.
export interface DigestSectionConfig {
  id: string; // s_XXXXXXXX — client-generated on add, server validates
  title: string;
  dateColumnId: string;
  dateColumnTitle: string; // the board column's title, captured at save → email <th>
  /**
   * Text column on the TASKS board this cluster maps. When set, the email adds a
   * text field per row and a task cannot be marked without filling it; the value
   * is written to this column (overwriting it) alongside the status.
   * null/absent = no field, no requirement (every pre-0.12.0 config).
   */
  noteColumnId?: string | null;
  /** The board column's title, captured at save → the email column header. */
  noteColumnTitle?: string;
  /** Primary button — used for the status-column filter (includeStatusLabelIds). */
  buttonId: string;
  /**
   * Action buttons offered in this cluster's AMP label `<select>`.
   * First id is also the primary button (status-column filter).
   * Must include buttonId. Absent/legacy configs are read as [buttonId].
   */
  buttonIds?: string[];
  // A task enters the section only if its status (on the button's status
  // column) is one of these label ids. Empty = nothing matches. Label id 0
  // is valid — never truthy-check.
  includeStatusLabelIds: number[];
}

export interface DigestConfig {
  usersBoardId: string;
  usersPeopleColumnId: string;
  usersEmailColumnId: string;
  subject: string;
  /** Hour (0–23, Asia/Jerusalem) when the daily digest is scheduled. Default 8. */
  sendHour?: number;
  sections: DigestSectionConfig[];
}

export interface AppConfig {
  boardId: string;
  peopleColumnId: string | null;
  buttons: ActionButton[];
  templates: EmailTemplate[];
  digest?: DigestConfig | null;
}

export interface DigestRecipientSummary {
  email: string;
  name: string;
  taskCount: number;
}

export interface DigestSkippedUser {
  itemId: string;
  name: string;
  reason: 'no_email' | 'no_person' | 'multi_person';
}

export interface DigestPreviewResponse {
  recipients: DigestRecipientSummary[];
  skippedUsers: DigestSkippedUser[];
  truncated: boolean;
  /** V6: text/plain fallback part — no links, no credentials. */
  plain: string | null;
  /** V6: amp4email (Gmail dynamic email) part. */
  amp: string | null;
}

/** POST /api/digest/send-raw — the AMP debug lane (edited document, sent as typed). */
export interface DigestRawSendResponse {
  ok: boolean;
  /** Gmail message id, or null if the provider returned none. */
  id: string | null;
  to: string;
  subject: string;
  /** UTF-8 size of the amp part actually shipped. */
  ampBytes: number;
}

export interface DigestSendResult extends DigestRecipientSummary {
  ok: boolean;
  error?: string;
}

export interface DigestSendResponse {
  ok: boolean;
  results: DigestSendResult[];
  skippedUsers: DigestSkippedUser[];
  truncated: boolean;
}

export type OauthStatus = 'connected' | 'disconnected' | 'broken';

/** T9b Gmail sending identity, as reported by GET /api/state. */
export interface GoogleSenderState {
  /** Does the SERVER hold an OAuth client pair at all (platform env)? */
  configured: boolean;
  status: OauthStatus;
  /** The visible From address. Never a token. */
  senderAddress: string | null;
  /**
   * Why the sender is broken, when known (e.g. 'google_invalid_grant').
   * Also 'broken' without a lastError = the grant's scope predates the
   * 2026-08-04 change (findings §5) and needs re-consent.
   */
  lastError: string | null;
  /** null until connected. false = clicks in the sent mail will 403. */
  senderAllowedForAmp: boolean | null;
}

export interface AppState {
  config: AppConfig | null;
  secret: string | null; // masked: ****XXXX
  oauth: { status: OauthStatus; name?: string };
  google: GoogleSenderState;
  baseUrl: string;
}

export interface Board {
  id: string;
  name: string;
}

export interface StatusLabel {
  id: number;
  label: string;
  index: number; // display order
  isDeactivated: boolean;
}

export interface BoardColumn {
  id: string;
  title: string;
  type: 'status' | 'people' | 'date' | 'email' | 'text'; // email: users board · text: per-task note
  labels: StatusLabel[]; // parsed from settings.labels, status columns only
}

export const EMAIL_FONTS = [
  'Arial',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
] as const;

export const BUTTON_COLOR_PRESETS = [
  '#00854d', // ירוק monday
  '#0073ea', // כחול
  '#fdab3d', // כתום
  '#e2445c', // אדום
  '#a25ddc', // סגול
  '#323338', // כהה
] as const;

export const BUTTON_ICON_PRESETS = ['✓', '▶', '👍', '🚀', '⏰', ''] as const;

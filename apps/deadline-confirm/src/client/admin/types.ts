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
  buttonId: string;
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
  reason: 'no_email' | 'no_person' | 'duplicate_email' | 'multiple_persons';
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

export interface AppState {
  config: AppConfig | null;
  secret: string | null; // masked: ****XXXX
  oauth: { status: OauthStatus; name?: string };
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
  type: 'status' | 'people' | 'date' | 'email'; // email: v4 digest users board
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

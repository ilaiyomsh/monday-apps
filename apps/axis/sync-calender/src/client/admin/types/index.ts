export type SourceField =
  | 'eventName'
  | 'startDate'
  | 'endDate'
  | 'description'
  | 'duration'
  | 'eventLink';

export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'var'; value: SourceField };

export type ColumnMappingEntry =
  | { type: 'text' | 'long_text' | 'email_simple' | 'phone_simple'; tokens: TemplateToken[] }
  | { type: 'status'; value: { id: number } }
  | { type: 'dropdown'; value: { ids: number[] } }
  | { type: 'numbers'; kind: 'literal'; value: number | string }
  | { type: 'numbers'; kind: 'source'; source: SourceField }
  | { type: 'date'; source: 'startDate' | 'endDate' }
  | { type: 'checkbox'; value: boolean };

export type ColumnMapping = Record<string, ColumnMappingEntry>;

export interface Policy {
  objectId: string;
  accountId: string;
  ownerUserId: string;
  verifiedOwnerIds?: string[];
  workspaceId: string | null;
  boardId: string | null;
  linkColumnId: string | null;
  // Required Checkbox column. Newly-created items are auto-checked; if the
  // user unticks the box on the board, sync skips updates and deletes for
  // that row (Layer-2 invariant — see sync-engine.applyEvent).
  lockColumnId: string | null;
  peopleColumnId: string | null;
  itemNameSource: SourceField;
  columnMapping: ColumnMapping;
  conditionalEligibleColumns?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PolicyResponse {
  policy: Policy;
  isOwner: boolean;
  setupComplete: boolean;
  // Server-side feature flag — true when MICROSOFT_CLIENT_ID +
  // MICROSOFT_CLIENT_SECRET env vars are set. Frontend uses this to
  // conditionally render the Connect Outlook UI.
  microsoftEnabled: boolean;
}

export type BackfillStatus = 'running' | 'cancelling' | 'cancelled' | 'done' | 'error';

export interface BackfillState {
  status: BackfillStatus;
  total: number | null;
  processed: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  skipped_rule?: number;
  skipped_cross_day?: number;
  errors: number;
  cursor: string | null;
  timeMin: string;
  timeMax: string;
  windowMonths: number;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  lastError: string | null;
}

export type CalendarProvider = 'google' | 'microsoft';

export interface SyncConfig {
  configId: string;
  accountId: string;
  objectId: string;
  userId: string;
  workspaceId: string | null;
  // Active calendar provider for this row. null = not connected to any
  // calendar provider yet. XOR — a row is Google or Microsoft, never both.
  provider: CalendarProvider | null;
  googleUserEmail: string | null;
  microsoftUserEmail: string | null;
  hasGoogleConnection: boolean;
  hasMicrosoftConnection: boolean;
  hasMondayConnection: boolean;
  status: string;
  lastSyncAt: number | null;
  lastError: string | null;
  conditionals?: Conditional[];
  backfill?: BackfillState | null;
  createdAt: number;
  updatedAt: number;
}

export type AttendeeEmailOp = 'equals' | 'contains' | 'domain';
export type TextOp = 'equals' | 'contains' | 'regex';
export type ContainsOnlyOp = 'contains' | 'equals';

export type Predicate =
  | { field: 'attendee_email'; op: AttendeeEmailOp; value: string }
  | { field: 'event_title'; op: TextOp; value: string }
  | { field: 'description'; op: ContainsOnlyOp; value: string }
  | { field: 'location'; op: ContainsOnlyOp; value: string };

export type PredicateField = Predicate['field'];
export type PredicateOp = Predicate['op'];

export type ConditionalValue =
  | { type: 'status'; value: { id: number } }
  | { type: 'board_relation'; value: { itemId: number } };

export type ConditionalAction = 'override' | 'skip';

export interface Conditional {
  id: string;
  name: string;
  action?: ConditionalAction;
  operator: 'AND' | 'OR';
  predicates: Predicate[];
  values: Record<string, ConditionalValue>;
}

export interface Board {
  id: string;
  name: string;
  kind?: string;
  workspace_id?: string | null;
}

// monday's `Column.settings` is a JSON scalar (parsed object). Shape varies
// by column type; see lib/columnSettings.ts for the parsers we use for
// status / dropdown / board_relation.
export interface Column {
  id: string;
  title: string;
  type: string;
  settings?: unknown;
}

export interface MondayContext {
  user?: { id: string | number; name?: string; email?: string };
  account?: { id: string | number };
  theme?: string;
  instanceId?: string;
  appFeatureObjectId?: string;
  objectId?: string;
  appFeatureId?: string;
  boardId?: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  photo_thumb_small?: string | null;
  account?: { id: string; name?: string; slug?: string };
}

export interface MondayUser {
  id: string;
  name: string;
  email?: string;
  photo_thumb_small?: string | null;
}

export type OAuthProvider = 'google' | 'microsoft' | 'monday';

export interface OAuthStartResponse {
  authUrl: string;
  state: string;
}

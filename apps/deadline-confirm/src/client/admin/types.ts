// Shared admin-view types. Config mirrors the server's §4 schema exactly —
// fromIndex/toIndex hold status label IDs (settings.labels[].id — stable;
// labels[].index is display order only).

export interface AppConfig {
  boardId: string;
  statusColumnId: string;
  fromIndex: number;
  fromLabel: string;
  toIndex: number;
  toLabel: string;
  peopleColumnId: string | null;
  expiryDateColumnId: string | null;
  expiryGraceDays: number;
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
  type: 'status' | 'people' | 'date';
  labels: StatusLabel[]; // parsed from settings.labels, status columns only
}

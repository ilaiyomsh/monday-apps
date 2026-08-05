/** Shared types for @axis/app-core. */

export type Language = 'he' | 'en';
export type Dir = 'rtl' | 'ltr';

export interface MondaySdkUser {
  id?: string;
  name?: string;
  isAdmin?: boolean;
  isViewOnly?: boolean;
  isGuest?: boolean;
  currentLanguage?: string;
}

export interface MondaySdkContext {
  instanceId?: number;
  boardId?: number;
  /** Present on some surfaces; when absent, MondayProvider resolves it via a one-time
   *  `me { account { id } }` query so Axiom rows carry `acc`. */
  account?: { id?: number | string };
  accountId?: number | string;
  user?: MondaySdkUser;
  theme?: string;
  mode?: string;
}

export interface StorageResult {
  data?: { success?: boolean; value?: string | null; error?: string };
}

/** Minimal monday-sdk-js surface this package relies on. */
export interface MondaySdk {
  get(type: 'context'): Promise<{ data: MondaySdkContext }>;
  listen(type: 'context', cb: (res: { data: MondaySdkContext }) => void): (() => void) | void;
  api(query: string, options?: { variables?: Record<string, unknown> }): Promise<{ data?: unknown; errors?: unknown[] }>;
  storage: {
    getItem(key: string): Promise<StorageResult>;
    setItem(key: string, value: string): Promise<StorageResult>;
  };
}

export interface UserPermissions {
  canEditSettings: boolean;
  canViewData: boolean;
  isBoardOwner: boolean;
  isAdmin: boolean;
}

export interface AppError {
  message: string;
  details?: unknown;
}

export type SettingsErrorKind = 'network' | 'unknown';

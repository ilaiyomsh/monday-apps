// Settings API client — reads and provisions the lifecycle events board config
// through the authenticated /api/settings endpoints. Like lib/api.ts, every
// call carries the monday sessionToken; the server verifies it (and the
// optional account allowlist) before doing anything.

import { getSessionToken } from './monday';

export interface BoardConfig {
  boardId: string;
  groupId: string | null;
  columns: Record<string, string>;
}

export interface SettingsState {
  oauthConnected: boolean;
  board: BoardConfig | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return { Authorization: token };
}

/** GET current settings (OAuth status + board config). Throws on failure. */
export async function fetchSettings(): Promise<SettingsState> {
  const res = await fetch('/api/settings', { headers: await authHeaders() });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return (await res.json()) as SettingsState;
}

export type ProvisionResult =
  | { ok: true; board: BoardConfig }
  | { ok: false; error: 'not_authorized' | 'provision_failed' | string };

/**
 * POST to provision the board+columns+group. Returns a discriminated result
 * (never throws for the two expected server errors) so the UI can branch:
 * `not_authorized` → prompt the owner to authorize at /oauth/start.
 */
export async function provisionBoard(name?: string): Promise<ProvisionResult> {
  try {
    const res = await fetch('/api/settings/board', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { name } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { board?: BoardConfig; error?: string };
    if (res.ok && body.board) return { ok: true, board: body.board };
    return { ok: false, error: body.error ?? `http ${res.status}` };
  } catch (err) {
    return { ok: false, error: `network: ${String(err)}` };
  }
}

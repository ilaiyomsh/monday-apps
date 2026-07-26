// Fetches the authenticated telemetry endpoint. Every call carries the monday
// sessionToken in the Authorization header; the server verifies it before
// returning any data. A { seed:true } response (Axiom not configured) or any
// failure signals the caller to fall back to the bundled synthetic seed.

import { getSessionToken } from './monday';
import type { ErrorOccurrence, TelemetryPayload, TimeWindow } from './types';

export interface FetchResult {
  /** Present only when real data came back. */
  payload: TelemetryPayload | null;
  /** True when the server told us to use the seed (Axiom unconfigured). */
  seed: boolean;
  /** Populated when the fetch/auth failed — the client still shows the seed. */
  error: string | null;
}

export async function fetchTelemetry(window: TimeWindow): Promise<FetchResult> {
  let token: string;
  try {
    token = await getSessionToken();
  } catch (err) {
    return { payload: null, seed: false, error: `no-session: ${String(err)}` };
  }

  try {
    const res = await fetch(`/api/telemetry?window=${encodeURIComponent(window)}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      return { payload: null, seed: false, error: `http ${res.status}` };
    }
    const body = (await res.json()) as TelemetryPayload;
    if (body?.seed) {
      return { payload: null, seed: true, error: null };
    }
    return { payload: body, seed: false, error: null };
  } catch (err) {
    return { payload: null, seed: false, error: `network: ${String(err)}` };
  }
}

export interface ErrorDetailResult {
  rows: ErrorOccurrence[];
  /** True when the server is in seed mode (client should drill down locally). */
  seed: boolean;
  /** Populated when the fetch/auth failed. */
  error: string | null;
}

/**
 * Fetch the raw occurrences behind one Top-errors row. Same session gate as
 * fetchTelemetry. Used only in LIVE mode — in seed mode the client drills into
 * the bundled records directly (see aggregate.errorOccurrences).
 */
export async function fetchErrorDetail(window: TimeWindow, errName: string): Promise<ErrorDetailResult> {
  let token: string;
  try {
    token = await getSessionToken();
  } catch (err) {
    return { rows: [], seed: false, error: `no-session: ${String(err)}` };
  }

  try {
    const res = await fetch(
      `/api/telemetry/error-detail?window=${encodeURIComponent(window)}&err_name=${encodeURIComponent(errName)}`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) {
      return { rows: [], seed: false, error: `http ${res.status}` };
    }
    const body = (await res.json()) as { rows?: ErrorOccurrence[]; seed?: boolean };
    if (body?.seed) {
      return { rows: [], seed: true, error: null };
    }
    return { rows: Array.isArray(body?.rows) ? body.rows : [], seed: false, error: null };
  } catch (err) {
    return { rows: [], seed: false, error: `network: ${String(err)}` };
  }
}

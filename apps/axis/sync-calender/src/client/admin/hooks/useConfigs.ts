import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import type { Conditional, SyncConfig } from '../types';

// Rewrite legacy status overrides that stored the label id under `value.index`
// onto the current `value.id` shape. The numeric is the same — only the field
// name changed when we moved off settings_str — so this is a pure rename.
function normalizeConfigRow(row: SyncConfig): SyncConfig {
  if (!Array.isArray(row.conditionals) || row.conditionals.length === 0) return row;
  const conditionals = row.conditionals.map((c) => {
    const values = c.values || {};
    const out: Conditional['values'] = {};
    let touched = false;
    for (const [k, v] of Object.entries(values)) {
      if (v && v.type === 'status') {
        const legacy = (v.value as { index?: number; id?: number }) || {};
        if (legacy.id == null && Number.isInteger(legacy.index)) {
          out[k] = { type: 'status', value: { id: legacy.index as number } };
          touched = true;
          continue;
        }
      }
      out[k] = v;
    }
    return touched ? { ...c, values: out } : c;
  });
  return { ...row, conditionals };
}

export function useConfigs(objectId: string, tokenReady: boolean) {
  const [rows, setRows] = useState<SyncConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!objectId || !tokenReady) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ rows: SyncConfig[] }>(
        `/api/configs?objectId=${encodeURIComponent(objectId)}`
      );
      setRows((res.rows || []).map(normalizeConfigRow));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [objectId, tokenReady]);

  useEffect(() => { refetch(); }, [refetch]);

  const forceSync = useCallback(async (configId: string) => {
    return apiFetch<{ ok: boolean; result?: unknown }>(
      `/api/configs/${encodeURIComponent(configId)}/force-sync`,
      { method: 'POST' }
    );
  }, []);

  const remove = useCallback(async (configId: string) => {
    return apiFetch<{ ok: boolean }>(
      `/api/configs/${encodeURIComponent(configId)}`,
      { method: 'DELETE' }
    );
  }, []);

  // Disconnect the calendar provider but keep the config row, so the user
  // can reconnect with a different provider (or the same one).
  const disconnectConnection = useCallback(async (configId: string) => {
    const res = await apiFetch<{ row: SyncConfig }>(
      `/api/configs/${encodeURIComponent(configId)}/connection`,
      { method: 'DELETE' }
    );
    setRows((prev) => prev.map((r) => (r.configId === configId ? { ...r, ...res.row } : r)));
    return res.row;
  }, []);

  const patchConditionals = useCallback(async (configId: string, conditionals: Conditional[]) => {
    const res = await apiFetch<{ row: SyncConfig }>(
      `/api/configs/${encodeURIComponent(configId)}`,
      { method: 'PATCH', body: JSON.stringify({ conditionals }) }
    );
    setRows((prev) => prev.map((r) => (r.configId === configId ? { ...r, ...res.row } : r)));
    return res.row;
  }, []);

  const enable = useCallback(async (configId: string) => {
    const res = await apiFetch<{ row: SyncConfig }>(
      `/api/configs/${encodeURIComponent(configId)}/enable`,
      { method: 'POST' }
    );
    setRows((prev) => prev.map((r) => (r.configId === configId ? { ...r, ...res.row } : r)));
    return res.row;
  }, []);

  const pause = useCallback(async (configId: string) => {
    const res = await apiFetch<{ row: SyncConfig }>(
      `/api/configs/${encodeURIComponent(configId)}/pause`,
      { method: 'POST' }
    );
    setRows((prev) => prev.map((r) => (r.configId === configId ? { ...r, ...res.row } : r)));
    return res.row;
  }, []);

  const backfill = useCallback(async (configId: string) => {
    return apiFetch<{ ok: boolean }>(
      `/api/configs/${encodeURIComponent(configId)}/backfill`,
      { method: 'POST' }
    );
  }, []);

  const cancelBackfill = useCallback(async (configId: string) => {
    return apiFetch<{ ok: boolean }>(
      `/api/configs/${encodeURIComponent(configId)}/backfill/cancel`,
      { method: 'POST' }
    );
  }, []);

  // Auto-poll while any row has a running/cancelling backfill. 2s cadence is
  // enough for a human-legible progress bar without hammering the server.
  useEffect(() => {
    const anyRunning = rows.some(
      (r) => r.backfill?.status === 'running' || r.backfill?.status === 'cancelling'
    );
    if (!anyRunning) return;
    const t = window.setInterval(() => { refetch(); }, 2000);
    return () => window.clearInterval(t);
  }, [rows, refetch]);

  return { rows, loading, error, refetch, forceSync, remove, disconnectConnection, patchConditionals, enable, pause, backfill, cancelBackfill };
}

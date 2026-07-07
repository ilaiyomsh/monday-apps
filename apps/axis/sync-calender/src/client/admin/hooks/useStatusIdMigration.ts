import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/api';

export interface MigrationItem {
  kind: 'policy' | 'conditional';
  configId?: string;
  conditionalId?: string;
  columnId: string;
  currentId: number;
  newId: number;
  labelText: string;
}

export interface MigrationPlan {
  needed: boolean;
  items: MigrationItem[];
  unresolved: Array<{
    kind: 'policy' | 'conditional';
    configId?: string;
    conditionalId?: string;
    columnId: string;
    currentId: number | null;
  }>;
  reason?: string;
}

// Fetch the migration plan once on mount. Returns the plan + a runner. Owners
// see the prompt; non-owners just get `plan` for diagnostics. The hook does
// not auto-apply — the caller decides when to call `run`.
export function useStatusIdMigration(objectId: string, tokenReady: boolean) {
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!objectId || !tokenReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<MigrationPlan>(`/api/migration/status-ids?objectId=${encodeURIComponent(objectId)}`)
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [objectId, tokenReady]);

  const run = useCallback(async () => {
    if (!objectId) return { migrated: 0 };
    setRunning(true);
    try {
      const result = await apiFetch<{ migrated: number; plan: MigrationPlan }>(
        '/api/migration/status-ids',
        { method: 'POST', body: JSON.stringify({ objectId }) }
      );
      setPlan({ ...result.plan, needed: false });
      return result;
    } finally {
      setRunning(false);
    }
  }, [objectId]);

  return { plan, loading, running, error, run };
}

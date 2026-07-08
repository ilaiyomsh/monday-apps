import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../services/api';
import type { Policy, PolicyResponse } from '../types';
import { deriveSetupProgress } from '../lib/setupProgress';
import { normalizeColumnMapping } from '../lib/mappingEntry';

function normalizePolicy(p: Policy): Policy {
  return { ...p, columnMapping: normalizeColumnMapping(p.columnMapping) };
}

export function usePolicy(objectId: string, tokenReady: boolean) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [setupComplete, setSetupComplete] = useState<boolean>(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!objectId || !tokenReady) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PolicyResponse>(
        `/api/policy?objectId=${encodeURIComponent(objectId)}`
      );
      setPolicy(normalizePolicy(res.policy));
      setIsOwner(Boolean(res.isOwner));
      setSetupComplete(Boolean(res.setupComplete));
      setMicrosoftEnabled(Boolean(res.microsoftEnabled));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPolicy(null);
        setIsOwner(false);
        setSetupComplete(false);
        setMicrosoftEnabled(false);
      } else {
        setError((err as Error).message);
        setSetupComplete(false);
      }
    } finally {
      setLoading(false);
    }
  }, [objectId, tokenReady]);

  useEffect(() => { refetch(); }, [refetch]);

  const patch = useCallback(async (updates: Partial<Policy>) => {
    const res = await apiFetch<{ policy: Policy }>('/api/policy', {
      method: 'PATCH',
      body: JSON.stringify({ objectId, ...updates }),
    });
    const normalized = normalizePolicy(res.policy);
    setPolicy(normalized);
    setSetupComplete(deriveSetupProgress(normalized).complete);
    return normalized;
  }, [objectId]);

  return { policy, isOwner, setupComplete, microsoftEnabled, loading, error, refetch, patch };
}

import { useEffect, useState } from 'react';
import monday from '../services/monday';

interface OwnersResponse {
  data?: { boards?: Array<{ id: string; owners?: Array<{ id: string | number }> }> };
}

// Fetch the list of owner user IDs for the current Custom Object instance.
// Custom Objects are boards under the hood (BoardObjectType.custom_object), so
// the boards(ids:[...]) { owners { id } } query accepts the objectId directly
// — same pattern as tracker's useBoardOwner and Planner's getBoardOwners.
// Runs once on app load; no caching beyond the component's lifetime.
export function useObjectOwners(objectId: string, ready: boolean) {
  const [ownerIds, setOwnerIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !objectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = (await monday.api(
          'query ($ids: [ID!]) { boards(ids: $ids) { id owners { id } } }',
          { variables: { ids: [String(objectId)] } }
        )) as OwnersResponse;
        const board = res?.data?.boards?.[0];
        const ids = (board?.owners || []).map((o) => String(o.id));
        if (!cancelled) setOwnerIds(ids);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [objectId, ready]);

  return { ownerIds, loading, error };
}

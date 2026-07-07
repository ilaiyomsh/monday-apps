import { useEffect, useState } from 'react';
import monday from '../services/monday';
import type { MondayUser } from '../types';

interface UsersResponse {
  data?: { users?: MondayUser[] };
}

export function useUsersByIds(ids: string[], ready: boolean) {
  const [byId, setById] = useState<Record<string, MondayUser>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const key = ids.join(',');

  useEffect(() => {
    if (!ready) return;
    const unique = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!unique.length) { setById({}); return; }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = (await monday.api(
          'query ($ids: [ID!]) { users(ids: $ids) { id name email photo_thumb_small } }',
          { variables: { ids: unique } }
        )) as UsersResponse;
        const map: Record<string, MondayUser> = {};
        for (const u of res?.data?.users || []) map[String(u.id)] = u;
        if (!cancelled) setById(map);
      } catch {
        /* non-fatal — callers gracefully fall back to the raw id */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  return { byId, loading };
}

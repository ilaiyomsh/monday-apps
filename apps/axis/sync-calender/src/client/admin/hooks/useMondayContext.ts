import { useEffect, useState } from 'react';
import monday, { pickObjectId } from '../services/monday';
import type { MondayContext, Me } from '../types';

export interface MondayBoot {
  context: MondayContext | null;
  objectId: string;
  me: Me | null;
  error: string | null;
  loading: boolean;
}

export function useMondayContext(): MondayBoot {
  const [context, setContext] = useState<MondayContext | null>(null);
  const [objectId, setObjectId] = useState<string>('');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctxRes = await monday.get('context');
        const ctx = ((ctxRes as { data?: MondayContext })?.data || ctxRes) as MondayContext;
        if (cancelled) return;
        setContext(ctx);
        setObjectId(pickObjectId(ctx as unknown as Record<string, unknown>));

        try {
          const meRes = await monday.api(
            'query { me { id name email photo_thumb_small account { id name slug } } }'
          );
          const meData = (meRes as { data?: { me: Me } })?.data?.me;
          if (meData && !cancelled) setMe(meData);
        } catch {
          /* non-fatal */
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { context, objectId, me, error, loading };
}

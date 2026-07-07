import { useCallback, useEffect, useState } from 'react';
import monday from '../services/monday';
import type { Board } from '../types';

const PAGE_SIZE = 100;

interface BoardsQueryResponse {
  data?: { boards?: Board[] };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

// Fetch the user's boards via the monday-sdk-js iframe API. Returns
// `{ boards, loading, error, refetch }`. Surfacing `error` lets the picker
// distinguish "still loading" from "loaded with zero boards" from "request
// failed", so a silent SDK failure doesn't look like an empty result.
export function useBoards(ready: boolean) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Bump `tick` to force the effect below to re-run.
  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const collected: Board[] = [];
        let page = 1;
        while (true) {
          const res = (await monday.api(
            `query ($page: Int, $limit: Int) { boards(page: $page, limit: $limit, state: active) { id name } }`,
            { variables: { page, limit: PAGE_SIZE } }
          )) as BoardsQueryResponse;
          // Monday SDK exposes GraphQL errors on res.errors; some transport
          // failures arrive on res.error_message. Either case is a real
          // failure, not an empty list.
          if (res?.errors?.length) {
            throw new Error(res.errors.map((e) => e.message).join('; '));
          }
          if (res?.error_message) throw new Error(res.error_message);
          const batch = res?.data?.boards || [];
          collected.push(...batch);
          if (batch.length < PAGE_SIZE) break;
          page += 1;
          if (page > 20) break;
        }
        if (!cancelled) setBoards(collected);
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error('[useBoards] failed:', err);
          setError((err as Error).message || 'Unknown error loading boards');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, tick]);

  return { boards, loading, error, refetch };
}

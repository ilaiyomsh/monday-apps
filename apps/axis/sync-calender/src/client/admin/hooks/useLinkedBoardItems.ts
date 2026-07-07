import { useEffect, useState } from 'react';
import monday from '../services/monday';

export interface LinkedItem {
  id: string;
  name: string;
  boardId: string;
}

interface ItemsResponse {
  data?: { boards?: Array<{ id: string; items_page?: { items?: Array<{ id: string; name: string }> } }> };
}

// Fetches the first page of items for each linked board. For v1 we only read
// the first page (up to 100 items per board) — good enough for the picker.
// Follow-up if users hit the ceiling: add a cursor-based search input.
export function useLinkedBoardItems(boardIds: string[], enabled: boolean) {
  const [items, setItems] = useState<LinkedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const key = boardIds.slice().sort().join(',');

  useEffect(() => {
    if (!enabled || boardIds.length === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = (await monday.api(
          `query ($ids: [ID!]) {
             boards(ids: $ids) {
               id
               items_page(limit: 100) {
                 items { id name }
               }
             }
           }`,
          { variables: { ids: boardIds } }
        )) as ItemsResponse;

        const flat: LinkedItem[] = [];
        for (const b of res?.data?.boards || []) {
          for (const it of b.items_page?.items || []) {
            flat.push({ id: it.id, name: it.name, boardId: b.id });
          }
        }
        if (!cancelled) setItems(flat);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { items, loading, error };
}

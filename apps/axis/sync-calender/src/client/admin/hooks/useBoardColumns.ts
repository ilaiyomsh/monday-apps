import { useEffect, useState } from 'react';
import monday from '../services/monday';
import type { Column } from '../types';

interface ColumnsResponse {
  data?: { boards?: { columns: Column[] }[] };
}

export function useBoardColumns(boardId: string | null) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) {
      setColumns([]);
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
              columns {
                id
                title
                type
                settings
              }
            }
          }`,
          { variables: { ids: [boardId] } }
        )) as ColumnsResponse;
        const cols = res?.data?.boards?.[0]?.columns || [];
        if (!cancelled) setColumns(cols);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  return { columns, loading, error };
}

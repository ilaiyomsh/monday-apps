import { useEffect, useState } from 'react';
import monday from '../services/monday';
import { setSessionToken } from '../services/api';

export function useSessionToken() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await monday.get('sessionToken')) as unknown as { data?: unknown };
        const value = typeof res?.data === 'string'
          ? res.data
          : typeof res === 'string' ? res : null;
        if (cancelled) return;
        setSessionToken(value);
        setToken(value);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    const unsub = monday.listen('sessionToken', (res) => {
      const data = (res as unknown as { data?: unknown })?.data;
      const value = typeof data === 'string' ? data : null;
      setSessionToken(value);
      setToken(value);
    });

    return () => {
      cancelled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  return { token, error };
}

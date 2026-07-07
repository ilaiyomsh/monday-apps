/**
 * useDeepLinkItemId — reads the deep-link target item id once on mount.
 *
 * External sources link into the app with the monday object URL plus an
 * app-namespaced query param, e.g.
 *   https://<account>.monday.com/custom_objects/18417140187?app[itemId]=<id>
 * monday only exposes query params under the `app[...]` namespace to the
 * embedded iframe, and strips the namespace — so `app[itemId]=123` arrives as
 * `data.query.itemId === "123"` from `monday.get('location')`.
 *
 * Primary source: `monday.get('location')` (the embedded-in-monday path).
 * Fallback: `window.location.search` — for local dev (vite) where the app runs
 * standalone and isn't wrapped by monday; there we accept both `?itemId=` and
 * the raw `?app[itemId]=` form.
 */
import { useEffect, useState } from 'react';
import { monday, logger } from '../core';

/** The deep-link query param name (under monday's `app[...]` namespace). */
export const DEEP_LINK_PARAM = 'itemId';

/** Minimal shape of the `monday.get('location')` response — the shared
 *  @axis/app-core MondaySdk type only declares `get('context')`, so we narrow
 *  the location getter locally rather than widening the shared package. */
interface MondayLocationResult {
  data?: { href?: string; search?: string; query?: Record<string, unknown> };
}
type LocationGetter = { get(type: 'location'): Promise<MondayLocationResult> };

function fromSearchString(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const v = params.get(DEEP_LINK_PARAM) ?? params.get(`app[${DEEP_LINK_PARAM}]`);
    return v && v.trim() ? v : null;
  } catch (err) {
    logger.warn('useDeepLink', 'failed to parse search string', { search, err });
    return null;
  }
}

export function useDeepLinkItemId(): string | null {
  const [itemId, setItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Local-dev fallback (synchronous, cheap): the standalone vite URL.
    const local = fromSearchString(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (local) setItemId(local);

    // Primary: the monday-embedded location, which carries `app[...]` params.
    void (monday as unknown as LocationGetter)
      .get('location')
      .then((res) => {
        if (cancelled) return;
        const query = res?.data?.query;
        const v = query?.[DEEP_LINK_PARAM];
        if (typeof v === 'string' && v.trim()) {
          setItemId(v);
          return;
        }
        // Some hosts pass the raw search string but not a parsed query map.
        const fromSearch = res?.data?.search ? fromSearchString(res.data.search) : null;
        if (fromSearch) setItemId(fromSearch);
      })
      .catch((err) => {
        // Not fatal — running outside monday (local dev) just has no location.
        logger.warn('useDeepLink', "monday.get('location') failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return itemId;
}

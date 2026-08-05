/**
 * The target board's name + columns, for the settings panel.
 *
 * @module hooks/useBoardColumns
 *
 * Feeds two surfaces from one query: the five role dropdowns (which need the real
 * column list, with types) and the BoardPicker's validation (which needs the
 * FAILURE — the only honest way to check a board id is to fetch its meta, since
 * monday answers an unknown id with an empty list rather than an error).
 *
 * Three deliberate behaviours:
 *
 *  1. **A blank id never reaches the API.** A fresh instance has `boardId: ''`, and
 *     `fetchBoardMeta` refuses non-numeric ids by throwing — so gating here keeps
 *     the "not configured yet" state quiet instead of noisy.
 *  2. **A failure is WARN, not ERROR.** The owner types an id digit by digit, and
 *     `useUiErrorSink` turns every logged ERROR into a toast; error-level logging
 *     here would raise a toast per keystroke. The error is RETURNED instead, and
 *     the panel displays it in Hebrew next to the field — which is the
 *     error-guard "display" path.
 *  3. **Stale answers are dropped.** The owner fixes a digit; the abandoned id's
 *     response can land last and would otherwise overwrite the current board.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchBoardMeta } from '../services/boardMeta.js';
import logger from '../utils/logger.js';

const EMPTY = { name: '', columns: [], isLoading: false, error: null };

/**
 * @param {string|number} boardId - the TARGET board (settings.boardId or a draft)
 * @returns {{name: string, columns: Array<{id: string, title: string, type: string}>,
 *   isLoading: boolean, error: Error|null}}
 */
export function useBoardColumns(boardId) {
  const id = String(boardId ?? '').trim();
  const [state, setState] = useState(EMPTY);
  // The id whose response we are still willing to accept. A ref, not state: it
  // must be updated synchronously as the effect starts, before any await.
  const wantedRef = useRef('');

  useEffect(() => {
    wantedRef.current = id;

    if (!id) {
      setState(EMPTY);
      return undefined;
    }

    let cancelled = false;
    setState({ name: '', columns: [], isLoading: true, error: null });

    fetchBoardMeta(id)
      .then((meta) => {
        if (cancelled || wantedRef.current !== id) return;
        setState({
          name: meta?.name ?? '',
          columns: Array.isArray(meta?.columns) ? meta.columns : [],
          isLoading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled || wantedRef.current !== id) return;
        // WARN on purpose — see the module header. The error is handed to the
        // caller, which displays it (error-guard: recorded AND displayed).
        logger.warn('useBoardColumns', 'טעינת מטא-דאטה של הלוח נכשלה', err, { boardId: id });
        setState({ name: '', columns: [], isLoading: false, error: err });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

export default useBoardColumns;

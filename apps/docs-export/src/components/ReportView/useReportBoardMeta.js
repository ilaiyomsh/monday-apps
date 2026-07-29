/**
 * The target board's name + column types, for the report surface.
 *
 * @module components/ReportView/useReportBoardMeta
 *
 * ReportView needs board meta for three different reasons, and none of them is
 * optional: the column TYPES drive the GraphQL fragments of the range query
 * (`cvSelection` — a mirror read without its fragment renders as a silently empty
 * cell), the column TITLES are the table headers whenever the owner left an override
 * blank, and the board NAME is the downloaded file's name.
 *
 * It is a separate read from the range query on purpose: it is one cheap call per
 * board, it happens on boot rather than per range selection, and the "ONE query per
 * interaction" rule is about the ITEM read that scales with the reporter's rows.
 *
 * The same stale-response discipline as hooks/useRangeItems: the run bumps a sequence
 * at the start, and a response whose sequence is no longer current returns early.
 * (The settings panel has its own `useBoardColumns`; this one lives inside the
 * ReportView slice so the report surface stands on its own even when no settings
 * context is mounted above it — e.g. for a non-owner.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBoardMeta } from '../../services/boardMeta.js';
import logger from '../../utils/logger.js';

/** Stable empty list — a fresh `[]` per render would re-trigger every consumer memo. */
const NO_COLUMNS = [];

const IDLE = { name: '', columns: NO_COLUMNS, isLoading: false, error: null };

/**
 * @param {string|number} boardId `settings.boardId`; falsy (or '') means "do not ask".
 * @returns {{name: string, columns: Array<{id: string, title: string, type: string}>,
 *   isLoading: boolean, error: Error|null, reload: function(): void}}
 */
export function useReportBoardMeta(boardId) {
  const [state, setState] = useState(IDLE);
  const [reloadToken, setReloadToken] = useState(0);
  const seqRef = useRef(0);

  const id = boardId ? String(boardId) : '';

  useEffect(() => {
    if (!id) {
      setState(IDLE);
      return;
    }

    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setState({ ...IDLE, isLoading: true });

    fetchBoardMeta(id)
      .then((meta) => {
        if (seq !== seqRef.current) return; // superseded by a newer board id
        setState({
          name: meta?.name ?? '',
          columns: Array.isArray(meta?.columns) && meta.columns.length ? meta.columns : NO_COLUMNS,
          isLoading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (seq !== seqRef.current) return;
        logger.error('useReportBoardMeta', 'טעינת מבנה לוח היעד נכשלה', err, { boardId: id });
        setState({ ...IDLE, error: err });
      });
  }, [id, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return useMemo(() => ({ ...state, reload }), [state, reload]);
}

export default useReportBoardMeta;

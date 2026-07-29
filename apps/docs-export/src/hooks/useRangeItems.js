/**
 * useRangeItems — THE query of this app, and the only state that owns it.
 *
 * @module hooks/useRangeItems
 *
 * One range selection = ONE `items_page` call. Everything after it (the committee
 * list, the committee filter, the sorting/merging, the .docx) is client-side work
 * over these rows, so this hook is the single place where the app spends
 * complexity budget. Three things it therefore has to get right:
 *
 * 1. **It refuses to fire on an incomplete picture.** A missing role mapping, a
 *    board column list that has not loaded yet, or no user id → no call. A query
 *    built from a half-mapped blob does not error: monday answers zero rows, which
 *    is indistinguishable from "this reporter has nothing to report" (probe-verified
 *    2026-07-29). Silence beats a plausible-looking empty report.
 * 2. **A stale response can never overwrite a newer one.** Flipping יומי↔שבועי
 *    twice quickly leaves two calls in flight; if the older one resolves last, the
 *    user reads YESTERDAY's rows under this week's label. The monday SDK's
 *    `api()` takes no AbortSignal (there is nothing to abort), so the guard is a
 *    request-sequence ref: a settled response whose sequence is no longer the
 *    current one returns EARLY and writes nothing.
 * 3. **The column SELECTION carries the types.** `services/itemsQuery` derives the
 *    GraphQL fragments from the types passed here (`cvSelection`), and a mirror
 *    read without its fragment renders as a silently empty cell. So the selection
 *    is built by joining the five mapped role ids against the board's real column
 *    types, in role order — never guessed.
 *
 * The hook is intentionally prop-driven (settings / board columns / userId / kind)
 * rather than context-reading: the caller (ReportView) already holds all four, and
 * an explicit input is what makes the stale-response guard testable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportRange } from '../domain/dateRange.js';
import { committeesFromItems } from '../domain/committees.js';
import { COLUMN_ROLES } from '../domain/settingsSchema.js';
import { fetchRangeItems } from '../services/itemsQuery.js';
import logger from '../utils/logger.js';

/** Stable empty array — a fresh `[]` per render would thrash every consumer memo. */
const NO_ITEMS = [];

/**
 * The query plan, or `null` when the picture is still incomplete.
 *
 * @param {Object} settings normalized settings blob
 * @param {Array<{id: string, type: string}>} columns the TARGET board's columns
 * @returns {{plan: {columns: Array<{id: string, type: string}>, dateColumnId: string,
 *   personColumnId: string}|null, missing: string[]}}
 *   `missing` lists mapped ids that the board does not (or no longer) have — a
 *   deleted column, which is a real misconfiguration rather than a loading state.
 */
function buildPlan(settings, columns) {
  const list = Array.isArray(columns) ? columns : [];
  // An EMPTY list is the loading state, not a misconfiguration: `useReportBoardMeta`
  // holds `columns: []` until the board-meta read lands, so on every single boot every
  // mapped id would otherwise look "absent from the board" and warn about a board that
  // is perfectly configured. Only a LOADED list can prove an id is gone.
  if (!list.length) return { plan: null, missing: [] };
  const typeById = new Map(
    list.filter((column) => column && column.id != null).map((column) => [String(column.id), column.type])
  );

  const selection = [];
  const missing = [];
  for (const role of COLUMN_ROLES) {
    const id = settings?.columns?.[role];
    if (!id) return { plan: null, missing: [] }; // unmapped: the settings panel's problem
    if (!typeById.has(String(id))) {
      missing.push(String(id));
      continue;
    }
    selection.push({ id: String(id), type: typeById.get(String(id)) });
  }

  if (missing.length) return { plan: null, missing };

  return {
    plan: {
      columns: selection,
      dateColumnId: String(settings.columns.date),
      personColumnId: String(settings.columns.person),
    },
    missing: [],
  };
}

/**
 * Load the reporter's items for the current daily/weekly window.
 *
 * @param {Object} args
 * @param {Object} args.settings normalized settings blob (boardId, columns, weekStartsOn)
 * @param {Array<{id: string, title?: string, type: string}>} args.columns the target
 *   board's columns as `services/boardMeta` returns them; `[]` while they load
 * @param {string|number} args.userId the CURRENT monday user (`context.user.id`)
 * @param {'daily'|'weekly'} [args.kind='daily']
 * @returns {{items: Array<Object>, committees: string[], isLoading: boolean,
 *   error: Error|null, range: {kind: string, from: string, to: string, label: string},
 *   reload: function(): void}}
 */
export function useRangeItems({ settings, columns, userId, kind = 'daily' } = {}) {
  const [items, setItems] = useState(NO_ITEMS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Bumped by reload(): re-derives the window (so a session open across midnight
  // gets today's date) and re-runs the query.
  const [reloadToken, setReloadToken] = useState(0);
  // Sequence of the request whose answer is still wanted. Guards against a stale
  // in-flight response landing after a newer one.
  const seqRef = useRef(0);

  const boardId = settings?.boardId ? String(settings.boardId) : '';
  const weekStartsOn = settings?.weekStartsOn;
  const committeeColumnId = settings?.columns?.committee || '';

  // `new Date()` is read once per window change, not per render — an unstable range
  // object would re-trigger the effect on every render.
  const range = useMemo(
    () => reportRange(kind, new Date(), weekStartsOn),
    [kind, weekStartsOn, reloadToken]
  );

  const { plan, missing } = useMemo(() => buildPlan(settings, columns), [settings, columns]);
  // Effects key off SERIALIZED plans, not object identity: a context re-render hands
  // over an equal-but-new settings object several times a second, and identity deps
  // would turn each one into another billed query.
  const planKey = plan ? JSON.stringify(plan) : '';
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!planKey || !boardId || userId === undefined || userId === null || String(userId) === '') {
      if (missingKey && boardId) {
        // Mapped columns that the board does not have: the report can never be
        // built, and staying silent looks exactly like "no items today".
        logger.warn(
          'useRangeItems',
          'עמודות ממופות אינן קיימות בלוח היעד — יש לעדכן את ההגדרות',
          { boardId, missing: missingKey }
        );
      }
      setIsLoading(false);
      return undefined;
    }

    const request = JSON.parse(planKey);
    const seq = seqRef.current + 1;
    seqRef.current = seq;

    setIsLoading(true);
    setError(null);

    fetchRangeItems({
      boardId,
      dateColumnId: request.dateColumnId,
      personColumnId: request.personColumnId,
      userId,
      from: range.from,
      to: range.to,
      columns: request.columns,
    })
      .then((rows) => {
        // Superseded (or unmounted): a newer window already owns the state.
        if (seq !== seqRef.current) return;
        setItems(Array.isArray(rows) && rows.length ? rows : NO_ITEMS);
        setIsLoading(false);
      })
      .catch((err) => {
        if (seq !== seqRef.current) return;
        logger.error('useRangeItems', 'טעינת האייטמים לטווח הדוח נכשלה', err, {
          boardId,
          kind: range.kind,
          from: range.from,
          to: range.to,
        });
        setItems(NO_ITEMS);
        setError(err);
        setIsLoading(false);
      });

    // No cleanup flag on purpose. Bumping the sequence AT THE START of every run is
    // the whole mechanism: any earlier run's response now fails `seq !==
    // seqRef.current` and returns early. A second guard (a `cancelled` closure flag,
    // or a cleanup that bumps the sequence again) is not defence in depth here — it
    // is unobservable, and it hides a broken guard from the tests, because either
    // mechanism alone keeps them green (measured: the mutation that deleted the
    // sequence check SURVIVED while both existed). Post-unmount `setState` is a
    // silent no-op in React 18+, so there is nothing left for a cleanup to prevent.
    return undefined;
  }, [planKey, missingKey, boardId, userId, range, reloadToken]);

  const committees = useMemo(
    () => (committeeColumnId ? committeesFromItems(items, committeeColumnId) : NO_ITEMS),
    [items, committeeColumnId]
  );

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return useMemo(
    () => ({ items, committees, isLoading, error, range, reload }),
    [items, committees, isLoading, error, range, reload]
  );
}

export default useRangeItems;

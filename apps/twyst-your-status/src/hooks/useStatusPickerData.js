import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePeopleColumnAssignments } from '../domain/peopleColumnGate';
import { collectRequiredPeopleColumnIds } from '../domain/settingsSchema';
import { normalizeStatusLabels } from '../domain/statusPolicy';
import { GET_STATUS_COLUMN_CONTEXT } from '../services/graphqlQueries';
import mondayService from '../services/mondayService';
import { loadUserTeamIds } from '../services/teamsAccess';
import logger from '../utils/logger';

/**
 * The status picker's fetch state: the column's labels, the item's current value and
 * its people-column assignments, the acting user's identity, plus the load/supersede/
 * retry machinery around them.
 *
 * Called immediately after the settings hook and BEFORE the boot-overlay release, so
 * the fetch effect keeps registering ahead of the dismissal effect in the same commit
 * (see the note on `dataPending`).
 *
 * @returns {{ labels: object[], currentValue: object|null,
 *   peopleByColumnId: Record<string, object>, actor: object, error: string|null,
 *   setError: (message: string|null) => void, dataPending: boolean, retry: () => void }}
 */
export function useStatusPickerData({ boardId, columnId, itemId, user, effectiveSettings }) {
  const [labels, setLabels] = useState([]);
  const [currentValue, setCurrentValue] = useState(null);
  const [peopleByColumnId, setPeopleByColumnId] = useState({});
  const [actor, setActor] = useState({ userId: String(user?.id ?? ''), teamIds: [] });
  const [error, setError] = useState(null);
  // Which fetch inputs the state currently in hand was loaded for, and a counter
  // the retry bumps. `null` means nothing has landed yet. See dataPending below.
  const [loadedKey, setLoadedKey] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a superseded run — one started before the settings widened the
  // column set — landing last. See the comment where it is checked.
  const runIdRef = useRef(0);

  /*
   * The columns this open needs, collapsed into a stable string so a settings
   * object that churns its identity cannot re-trigger a fetch (the house idiom —
   * cf. filterKey in apps/discussions/src/hooks/useMyTasks.js).
   *
   * This is what lets the board request go out WITHOUT waiting for storage.
   * useColumnSettings seeds from swrCache synchronously during the first render,
   * so on a warm open the gate columns are already known here, before any await.
   * And settings can only ever WIDEN this set — they add people columns for
   * gates, never remove the status column — so the worst case is one extra
   * request on a cold open of a gated column, not a wrong request.
   */
  const columnIdsKey = useMemo(
    () => JSON.stringify(
      [...new Set([columnId, ...collectRequiredPeopleColumnIds(effectiveSettings)])].sort(),
    ),
    [columnId, effectiveSettings],
  );

  const fetchKey = `${reloadToken}|${columnIdsKey}`;

  /*
   * Both operands are RENDER values, which is the whole point. The old `loading`
   * boolean was set inside the async run, so on the commit where the fetch inputs
   * changed it still read false — and the overlay-dismissal effect runs after the
   * fetch effect in that same commit, off the render-time value. It would drop
   * monday's spinner for one frame, just before starting the refetch it was about
   * to start. Derived this way, "the inputs changed but nothing has loaded for
   * them yet" is not a state that can be misreported.
   */
  const dataPending = loadedKey !== fetchKey;

  const loadDialogData = useCallback(async () => {
    if (!boardId || !columnId || !itemId) return;
    const myRun = ++runIdRef.current;
    // Parsed back from the key so the request and the key can never disagree.
    const columnIds = JSON.parse(columnIdsKey);
    try {
      setError(null);
      const [data, teamsResult] = await Promise.all([
        mondayService.query(GET_STATUS_COLUMN_CONTEXT, {
          boardIds: [String(boardId)],
          itemIds: [String(itemId)],
          columnIds,
        }),
        loadUserTeamIds(user?.id),
      ]);

      /*
       * A run started before the settings widened the column set must write
       * NOTHING. Landing last, it would overwrite peopleByColumnId with a map
       * missing the gate column — and the gate fails closed, so the labels behind
       * it silently vanish — and it would pin loadedKey to its own stale key, with
       * no effect left to fire. That is a permanently blank dialog with the boot
       * overlay already down, not a slow one.
       */
      if (myRun !== runIdRef.current) return;

      const column = data?.boards?.[0]?.columns?.find((candidate) => candidate.id === columnId)
        ?? data?.boards?.[0]?.columns?.[0];
      if (!column || column.type !== 'status') {
        throw new Error('העמודה שנפתחה אינה עמודת Status פעילה');
      }

      const item = data?.items?.[0];
      const statusValue = item?.column_values?.find((value) => value.id === columnId) ?? null;
      const nextPeople = {};
      (item?.column_values ?? []).forEach((value) => {
        if (value?.type === 'people' || value?.column?.type === 'people') {
          nextPeople[value.id] = parsePeopleColumnAssignments(value);
        }
      });
      setLabels(normalizeStatusLabels(column.settings));
      setCurrentValue(statusValue);
      setPeopleByColumnId(nextPeople);
      setActor({
        userId: String(user?.id ?? ''),
        teamIds: teamsResult.teamIds,
      });
      setLoadedKey(fetchKey);
    } catch (err) {
      if (myRun !== runIdRef.current) {
        // Superseded: the live run owns the state, including the error state. Still
        // recorded — a failure that only ever happens on the run we discard is
        // exactly the kind of thing that is otherwise invisible.
        logger.warn('OnClickDialog', 'A superseded status-picker load failed', err);
        return;
      }
      logger.error('OnClickDialog', 'Failed to load status picker data', err);
      setError(err.message || 'לא הצלחנו לטעון את הסטטוסים');
      // An error ENDS the wait. Without this the guard below would hold `null`
      // forever with the overlay already released — a blank dialog, no error.
      setLoadedKey(fetchKey);
    }
  }, [boardId, columnId, itemId, user?.id, columnIdsKey, fetchKey]);

  useEffect(() => {
    loadDialogData();
  }, [loadDialogData]);

  // A retry re-enters through the key, not by calling the loader directly: bumping
  // the token makes dataPending true for the render that starts the retry, so the
  // stale `labels=[]` cannot paint "אין כרגע סטטוסים זמינים" underneath it.
  const retryDialogData = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    labels,
    currentValue,
    peopleByColumnId,
    actor,
    error,
    setError,
    dataPending,
    retry: retryDialogData,
  };
}

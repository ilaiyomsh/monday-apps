import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAvailableLabels } from '../../domain/buildAvailableLabels';
import { parsePeopleColumnAssignments } from '../../domain/peopleColumnGate';
import {
  collectRequiredPeopleColumnIds,
  getLabelRule,
} from '../../domain/settingsSchema';
import { normalizeStatusLabels, serializeStatusMutationValue } from '../../domain/statusPolicy';
import { assertStatusWritten } from '../../domain/statusWriteResult';
import {
  GET_STATUS_COLUMN_CONTEXT,
  GET_STATUS_COLUMN_SETTINGS,
  UPDATE_STATUS_COLUMN_VALUE,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import { loadUserTeamIds } from '../../services/teamsAccess';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { dismissBootLoader } from '../../utils/bootLoader';
import { requiredFormModalSize } from '../../utils/requiredFormModalSize';
import ErrorState from '../shared/ErrorState';
import './OnClickDialog.css';

/** Route of the fill form, opened as its own sized modal. See App.resolveAppRoute. */
const REQUIRED_FIELDS_PATH = '/required-fields';

function OnClickDialog({ context }) {
  const { boardId, columnId, itemId, user } = context || {};
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings(context);

  const [labels, setLabels] = useState([]);
  const [currentValue, setCurrentValue] = useState(null);
  const [peopleByColumnId, setPeopleByColumnId] = useState({});
  const [actor, setActor] = useState({ userId: String(user?.id ?? ''), teamIds: [] });
  const [columnsById, setColumnsById] = useState(new Map());
  const [error, setError] = useState(null);
  const [savingLabelId, setSavingLabelId] = useState(null);
  // Which fetch inputs the state currently in hand was loaded for, and a counter
  // the retry bumps. `null` means nothing has landed yet. See dataPending below.
  const [loadedKey, setLoadedKey] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a superseded run — one started before the settings widened the
  // column set — landing last. See the comment where it is checked.
  const runIdRef = useRef(0);

  // Null storage = no rules yet → everyone may pick every active label.
  const effectiveSettings = useMemo(
    () => settings ?? { version: 1, hiddenLabelIds: [], labels: {} },
    [settings],
  );

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
      setColumnsById(new Map(
        (item?.column_values ?? [])
          .filter((value) => value.column)
          .map((value) => [value.id, value.column]),
      ));
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

  const pickerModel = useMemo(
    () => buildAvailableLabels({
      labels,
      settings: effectiveSettings,
      actor,
      currentValue,
      peopleByColumnId,
    }),
    [actor, currentValue, labels, effectiveSettings, peopleByColumnId],
  );

  /**
   * Write the status, and do not return until the response says it took.
   *
   * The mutation echoes the column back and `assertStatusWritten` throws on an echo
   * that names a different label or on no item at all — both of which arrive inside
   * a 200 with no `errors`, where a bare await reads as success. This is what the
   * dialog's dismissal hangs off, so a write that silently did nothing keeps the
   * picker open with an error instead of closing on the old status.
   */
  const writeStatusOnly = async (labelId) => {
    const data = await mondayService.query(UPDATE_STATUS_COLUMN_VALUE, {
      boardId: String(boardId),
      itemId: String(itemId),
      columnId,
      value: serializeStatusMutationValue(labelId),
    });
    assertStatusWritten(data?.change_column_value, columnId, labelId);
  };

  /**
   * Hand the transition to the /required-fields modal.
   *
   * The fill form cannot live in THIS iframe: the Dialog Design size is fixed at
   * 200×250 in the Developer Center and the SDK has no runtime resize. So the
   * picker only measures the work — it reads the required columns' types to size
   * the modal — and `openAppFeatureModal` opens the form at that size, passing the
   * ids through `urlParams`.
   */
  const openRequiredFieldsModal = async (label, requiredColumnIds) => {
    try {
      setSavingLabelId(label.id);
      setError(null);
      // Types only; the modal loads the values itself.
      const data = await mondayService.query(GET_STATUS_COLUMN_SETTINGS, {
        boardIds: [String(boardId)],
        columnIds: requiredColumnIds,
      });
      const requiredColumns = data?.boards?.[0]?.columns ?? [];
      // NOT awaited: this promise resolves only when the modal CLOSES, so awaiting
      // it pinned the pill on "שומר…" for the whole time the form was open (that is
      // the stuck dialog behind the modal). Fire it, release the pill, and let the
      // modal own the rest — including closing this dialog once it has written.
      mondayService.openAppFeatureModal({
        urlPath: REQUIRED_FIELDS_PATH,
        urlParams: {
          boardId: String(boardId),
          columnId: String(columnId),
          itemId: String(itemId),
          labelId: String(label.id),
        },
        ...requiredFormModalSize(requiredColumns),
        returnToPreviousModal: true,
      }).catch((err) => {
        logger.error('OnClickDialog', 'The required-fields modal failed to open', err);
        setError('לא הצלחנו לפתוח את טופס שדות החובה');
      });
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to open the required-fields modal', err);
      setError(err.message || 'לא הצלחנו לפתוח את טופס שדות החובה');
    } finally {
      setSavingLabelId(null);
    }
  };

  const dismissPicker = async () => {
    try {
      await mondayService.closeDialog();
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to close status picker', err);
    }
  };

  const handleSelectLabel = async (labelId) => {
    const selectedLabel = pickerModel.options.find((label) => label.id === labelId);
    if (!selectedLabel || user?.isViewOnly) return;

    const rule = getLabelRule(effectiveSettings, labelId);
    if (rule.requiredColumnIds.length > 0) {
      await openRequiredFieldsModal(selectedLabel, rule.requiredColumnIds);
      return;
    }

    /*
     * No required fields: the pick IS the whole interaction, so the dialog closes the
     * moment the write lands, with NO success notice — the cell behind it already shows
     * the new status, and the dialog disappearing is the confirmation.
     *
     * The write is awaited rather than fired and forgotten, deliberately. `closeDialog`
     * tears the iframe down, and a request still in flight when that happens is
     * cancelled by the browser — the user would watch the dialog close on a status that
     * was never written, with nothing to tell them. One round-trip of latency is covered
     * by the spinner on the clicked pill; a silently dropped status change is not
     * recoverable.
     *
     * A failure keeps the dialog open and shows the error in it, which is why the
     * dismissal sits inside the try and not in a finally.
     */
    try {
      setSavingLabelId(labelId);
      setError(null);
      await writeStatusOnly(labelId);
      await dismissPicker();
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to update status value', err);
      setError(err.message || 'לא הצלחנו לעדכן את הסטטוס');
    } finally {
      setSavingLabelId(null);
    }
  };

  // Release monday's continued spinner (index.html) the moment this dialog has
  // something real to show — content, or an error the user must see. App holds it
  // through the context phase and hands it here; this is the last owner, so a
  // dismissal that never fires means a dialog stuck behind a spinner.
  const stillLoadingDialog = (settingsLoading || dataPending) && !settingsError;
  useEffect(() => {
    if (!stillLoadingDialog) dismissBootLoader();
  }, [stillLoadingDialog]);

  if (settingsError) {
    return <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />;
  }

  /*
   * The settings still gate the PAINT, even though they no longer gate the fetch.
   * buildAvailableLabels filters by hiddenLabelIds and the allowlists, and the
   * people gate fails closed, so painting before the settings are in would show
   * labels this user may not pick and then take them away.
   *
   * Pending is checked before `error` on purpose: a stale error must never paint
   * while its own replacement is already in flight.
   */
  if (settingsLoading || dataPending) {
    // The boot overlay from index.html is still covering the dialog — it has been
    // spinning since monday handed the iframe over, and releasing it here just to
    // draw our own loader is the jump we removed. Render nothing; the effect
    // above takes the overlay down the moment there is real content.
    return null;
  }

  if (error) {
    return <ErrorState message={error} onRetry={retryDialogData} />;
  }

  const NEUTRAL = 'hsl(0 0% 77%)';

  return (
    <main className="status-picker-dialog" aria-label="בחירת סטטוס" dir="rtl">
      {pickerModel.currentIsHidden && (
        <p className="status-picker-note">
          הסטטוס הנוכחי נקבע מחוץ לבורר (למשל אוטומציה) ואינו מוצג לבחירה.
        </p>
      )}

      {pickerModel.options.length > 0 ? (
        <div className="status-menu" role="listbox" aria-label="סטטוסים זמינים">
          {pickerModel.options.map((label) => {
            const isSaving = label.id === savingLabelId;
            return (
              <button
                key={label.id}
                className="status-option"
                type="button"
                role="option"
                aria-selected={false}
                aria-busy={isSaving}
                disabled={savingLabelId !== null || user?.isViewOnly}
                style={{ background: label.color || NEUTRAL }}
                onClick={() => handleSelectLabel(label.id)}
              >
                {/* The pill KEEPS its own text while the write is in flight. Swapping it
                    for "שומר…" hid which label was picked, and on the only pill that
                    can be busy that text carried no information the spinner does not.
                    The spinner is absolutely placed so the centred label never shifts. */}
                {isSaving && <span className="status-option-spinner" aria-hidden="true" />}
                {label.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="status-picker-empty">אין כרגע סטטוסים זמינים לבחירה.</p>
      )}

      {user?.isViewOnly && (
        <p className="status-picker-note">יש לך הרשאת צפייה בלבד ולכן לא ניתן לשנות את הסטטוס.</p>
      )}
    </main>
  );
}

export default OnClickDialog;

import { useMemo, useState } from 'react';
import { buildAvailableLabels } from '../../domain/buildAvailableLabels';
import { getLabelRule } from '../../domain/settingsSchema';
import { serializeStatusMutationValue } from '../../domain/statusPolicy';
import { assertStatusWritten } from '../../domain/statusWriteResult';
import {
  GET_STATUS_COLUMN_SETTINGS,
  UPDATE_STATUS_COLUMN_VALUE,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import { useBootLoaderRelease } from '../../hooks/useBootLoaderRelease';
import useColumnSettings from '../../hooks/useColumnSettings';
import { useStatusPickerData } from '../../hooks/useStatusPickerData';
import logger from '../../utils/logger';
import { requiredFormModalSize } from '../../utils/requiredFormModalSize';
import ErrorState, { SETTINGS_LOAD_ERROR_MESSAGE } from '../shared/ErrorState';
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

  // Null storage = no rules yet → everyone may pick every active label.
  const effectiveSettings = useMemo(
    () => settings ?? { version: 1, hiddenLabelIds: [], labels: {} },
    [settings],
  );

  const {
    labels,
    currentValue,
    peopleByColumnId,
    actor,
    error,
    setError,
    dataPending,
    retry: retryDialogData,
  } = useStatusPickerData({ boardId, columnId, itemId, user, effectiveSettings });

  const [savingLabelId, setSavingLabelId] = useState(null);

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
  useBootLoaderRelease(stillLoadingDialog);

  if (settingsError) {
    return <ErrorState message={SETTINGS_LOAD_ERROR_MESSAGE} onRetry={reloadSettings} />;
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
      {/*
        No note when the CURRENT status is one the admin hid (owner request, round314).
        The dialog's height is computed from the pills alone (`pickerDialogHeightPx`),
        so a paragraph above them took the last pill's space to explain a state the
        user cannot act on anyway. `buildAvailableLabels` still reports
        `currentIsHidden`; nothing renders from it.
      */}
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

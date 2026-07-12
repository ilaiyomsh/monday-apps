import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, AttentionBox } from '@vibe/core';

import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { UPDATE_COLUMN_VALUE } from '../../services/graphqlQueries';
import { formatCellValue } from '../../domain/cellValue';
import { policyFromSettings } from '../../domain/settingsSchema';
import useColumnSettings from '../../hooks/useColumnSettings';
import useAllowedUsers from '../../hooks/useAllowedUsers';
import PersonPicker from '../shared/PersonPicker';
import LoadingState from '../shared/LoadingState';
import ErrorState from '../shared/ErrorState';
import styles from './OnClickDialog.module.css';

const MODULE = 'OnClickDialog';

/**
 * OnClickDialog — the on-click people picker for the team-people column.
 *
 * Placement: columnPickers. Context: { boardId, itemId, columnId, selectedItemIds }.
 *
 * Flow: load persisted column settings (useColumnSettings) -> resolve the allowed
 * user set by walking the relation->linked-item->team chain (useAllowedUsers) ->
 * offer a picker restricted to EXACTLY that set. The write-back uses the native
 * people-column format so monday automations/notifications keep working.
 */

// Step-labeled Hebrew loading messages for the resolve chain.
const STEP_MESSAGES = {
  relation: 'טוען את הפריט המקושר...',
  linkedPeople: 'טוען את הצוות מהפריט המקושר...',
  teams: 'טוען את חברי הצוות...',
  ready: 'טוען...',
};

const UNCONFIGURED_TITLE = 'העמודה לא הוגדרה';
const UNCONFIGURED_TEXT =
  'העמודה עדיין לא הוגדרה. פתחו את תפריט העמודה, בחרו "הגדרות", וקבעו את עמודת חיבור הלוחות ואת עמודת האנשים.';

// Hebrew fallback for a generic (non-AppError) failure that carries no userMessage.
const GENERIC_ERROR_TEXT = 'אירעה שגיאה בטעינת הנתונים. נסו שוב.';

/**
 * The locked-empty-state message, chosen from the resolved result. Each of the
 * four broken-chain causes gets its own per-case Hebrew message:
 *   - resolved team, no members         -> empty team
 *   - referenced team could not resolve  -> missing/unavailable team
 *   - a linked item existed but no team  -> linked item without a team
 *   - no linked item at all              -> no linked item
 */
function emptyChainMessage(result) {
  if (result.teams && result.teams.length > 0) {
    return 'הצוות שהוגדר בפריט המקושר ריק — אין חברים לבחירה.';
  }
  if (result.missingTeamIds && result.missingTeamIds.length > 0) {
    return 'הצוות שהוגדר בפריט המקושר אינו זמין עוד.';
  }
  if (result.hadLinkedItems) {
    return 'לא הוגדר צוות בפריט המקושר. ודאו שהוקצה צוות בעמודת האנשים של הפריט המקושר.';
  }
  return 'לא נמצא צוות בפריט המקושר. ודאו שקיים פריט מקושר ושהוגדר בו צוות.';
}

function UnconfiguredState() {
  return (
    <div className={styles.dialog} dir="rtl">
      <AttentionBox type="primary" title={UNCONFIGURED_TITLE} text={UNCONFIGURED_TEXT} />
    </div>
  );
}

function OnClickDialog({ context }) {
  const { boardId, itemId, columnId, selectedItemIds } = context || {};

  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings(context);

  // Only run the resolve chain once settings are loaded AND present.
  const configured = !settingsLoading && settings != null;

  const {
    status,
    step,
    result,
    error: allowedError,
    retry,
  } = useAllowedUsers(context, settings, { enabled: configured });

  const policy = useMemo(() => policyFromSettings(settings), [settings]);
  const single = policy.selectionMode === 'single';

  const [selection, setSelection] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Seed the picker selection from the resolved chain whenever a fresh result
  // lands (names/photos resolved from the allowed set). The hook re-runs on
  // [itemId, columnId, settings], so a new result means a new open/context and
  // the selection resets accordingly — no cross-open caching.
  useEffect(() => {
    if (status !== 'ready' || !result) return;
    const byId = new Map((result.users || []).map((u) => [String(u.id), u]));
    setSelection(
      (result.selection || []).map((s) => {
        // Prefer the allowed-set entry; fall back to the details the service
        // resolved onto the (possibly stale) selection so a selection not in
        // the allowed list still renders a named chip with its photo.
        const u = byId.get(String(s.id));
        return {
          id: String(s.id),
          kind: s.kind || 'person',
          name: u?.name ?? s.name,
          photo_thumb: u?.photo_thumb ?? s.photo_thumb,
        };
      }),
    );
    setSaveError(null);
  }, [status, result]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await mondayService.query(UPDATE_COLUMN_VALUE, {
        boardId: String(boardId),
        itemId: String(itemId),
        columnId,
        value: JSON.stringify(formatCellValue(selection)),
      });
      mondayService.showNotice('הבחירה נשמרה', 'success');
      mondayService.closeDialog();
    } catch (err) {
      // error-guard: never swallow. Log, then keep the dialog OPEN with an inline
      // strip and the selection preserved so the user can retry. No toast on top —
      // the inline danger AttentionBox is the single, stronger display for this
      // failure (avoids the double-signal INLINE_ERROR_MODULES exists to prevent).
      logger.error(MODULE, 'Failed to save the people-column selection', err);
      setSaveError('שמירת הבחירה נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  }, [boardId, itemId, columnId, selection]);

  const handleCancel = useCallback(() => {
    mondayService.closeDialog();
  }, []);

  // --- render branches ----------------------------------------------------

  // Storage read failed (hook error) — surface + retry the storage read.
  if (settingsError) {
    return <ErrorState message={GENERIC_ERROR_TEXT} onRetry={reloadSettings} />;
  }

  // Settings still loading.
  if (settingsLoading) {
    return <LoadingState message="טוען הגדרות..." />;
  }

  // Unconfigured — instruct the user to open column settings.
  if (settings == null) {
    return <UnconfiguredState />;
  }

  // Resolve-chain error. NOT_CONFIGURED means the persisted settings are
  // incomplete — route it to the same instruction rather than a scary error.
  if (status === 'error') {
    if (allowedError?.code === 'NOT_CONFIGURED') {
      return <UnconfiguredState />;
    }
    // Drift codes carry a settings-pointing userMessage; PERMISSION_BLOCKED and
    // API_ERROR carry their own. Fall back to a generic Hebrew message otherwise.
    const message = allowedError?.userMessage || GENERIC_ERROR_TEXT;
    return <ErrorState message={message} onRetry={retry} />;
  }

  // Resolve chain still running — step-labeled Hebrew loading.
  if (status !== 'ready' || !result) {
    return <LoadingState message={STEP_MESSAGES[step] || STEP_MESSAGES.ready} />;
  }

  // Ready, but the chain resolved to an empty allowed set: LOCKED — no picking.
  if (result.emptyChain) {
    return (
      <div className={styles.dialog} dir="rtl">
        <AttentionBox type="warning" title="לא ניתן לבחור אנשים" text={emptyChainMessage(result)} />
      </div>
    );
  }

  // Ready with a non-empty allowed set — the restricted picker.
  const multiSelected = Array.isArray(selectedItemIds) && selectedItemIds.length > 1;

  return (
    <div className={styles.dialog} dir="rtl">
      {multiSelected && (
        <p className={styles.hint}>העריכה חלה על הפריט הנוכחי בלבד.</p>
      )}

      {result.partial && (
        <AttentionBox
          compact
          type="warning"
          text="חלק מהפריטים המקושרים אינם נגישים לכם, ולכן ייתכן שרשימת האנשים המורשים חלקית."
        />
      )}

      <div className={styles.pickerRow}>
        <span className={styles.pickerLabel}>אחראי מהצוות</span>
        <PersonPicker
          selected={selection}
          onChange={setSelection}
          users={result.users}
          single={single}
          bordered
        />
      </div>

      {saveError && <AttentionBox compact type="danger" text={saveError} />}

      <div className={styles.actions}>
        <Button onClick={handleSave} loading={saving}>
          שמירה
        </Button>
        <Button kind="secondary" onClick={handleCancel} disabled={saving}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

export default OnClickDialog;

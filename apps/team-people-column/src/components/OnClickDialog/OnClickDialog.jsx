import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AttentionBox } from '@vibe/core';

import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { UPDATE_COLUMN_VALUE } from '../../services/graphqlQueries';
import { formatCellValue } from '../../domain/cellValue';
import { policyFromSettings } from '../../domain/settingsSchema';
import useColumnSettings from '../../hooks/useColumnSettings';
import useAllowedUsers from '../../hooks/useAllowedUsers';
import PersonPicker from '../shared/PersonPicker';
import ErrorState from '../shared/ErrorState';
import styles from './OnClickDialog.module.css';

const MODULE = 'OnClickDialog';

/**
 * OnClickDialog — the on-click people picker for the team-people column.
 *
 * Placement: columnPickers. Context: { boardId, itemId, columnId, selectedItemIds }.
 *
 * Search-first UX: the dialog opens INSTANTLY as a clean box — team title +
 * search input only. The settings read (useColumnSettings) and the allowed-set
 * resolve chain (useAllowedUsers) run in the background while the user types;
 * the member list renders from the first typed letter. In single-assignee mode
 * a pick saves and closes the dialog; the write-back uses the native
 * people-column format so monday automations/notifications keep working.
 */

// Search-first: the placeholder IS the instruction the user sees on open.
const SEARCH_PLACEHOLDER = 'הקלד שם אחראי...';

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

/**
 * Dialog title carrying the team name(s), so the user always sees WHICH team
 * they are picking from. Falls back to a generic title while unresolved.
 */
function teamTitle(result) {
  const names = (result?.teams || []).map((t) => t.name).filter(Boolean);
  if (names.length === 0) return 'בחירת אנשי צוות';
  if (names.length === 1) return `צוות ${names[0]}`;
  return `צוותים: ${names.join(', ')}`;
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
    result,
    error: allowedError,
    retry,
  } = useAllowedUsers(context, settings, { enabled: configured });

  const policy = useMemo(() => policyFromSettings(settings), [settings]);
  const single = policy.selectionMode === 'single';

  const [selection, setSelection] = useState([]);
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

  // Native-picker behavior: every selection change saves immediately
  // (optimistic — the UI reflects the pick at once; a failed write reverts the
  // selection and shows an inline strip). Serialized via a ref so a fast
  // second click saves the LATEST selection after the in-flight write settles.
  // Single-assignee mode: a successful save also CLOSES the dialog (pick =
  // done); a failed save keeps it open so the user sees the error strip.
  const savingRef = useRef(Promise.resolve());
  const handleChange = useCallback((next) => {
    const prev = selection;
    setSelection(next);
    setSaveError(null);
    savingRef.current = savingRef.current.then(async () => {
      try {
        await mondayService.query(UPDATE_COLUMN_VALUE, {
          boardId: String(boardId),
          itemId: String(itemId),
          columnId,
          value: JSON.stringify(formatCellValue(next)),
        });
        if (single) mondayService.closeDialog();
      } catch (err) {
        // error-guard: never swallow. Log, revert the optimistic pick, and show
        // an inline strip. No toast on top — the inline danger AttentionBox is
        // the single, stronger display for this failure (avoids the
        // double-signal INLINE_ERROR_MODULES exists to prevent).
        logger.error(MODULE, 'Failed to save the people-column selection', err);
        setSelection(prev);
        setSaveError('שמירת הבחירה נכשלה. נסו שוב.');
      }
    });
  }, [boardId, itemId, columnId, selection, single]);

  // --- render branches ----------------------------------------------------

  // Storage read failed (hook error) — surface + retry the storage read.
  if (settingsError) {
    return <ErrorState message={GENERIC_ERROR_TEXT} onRetry={reloadSettings} />;
  }

  // Unconfigured — instruct the user to open column settings. Known only once
  // the storage read settled; until then the search-first shell shows below.
  if (!settingsLoading && settings == null) {
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

  const ready = status === 'ready' && result != null;

  // Ready, but the chain resolved to an empty allowed set: LOCKED — no picking.
  if (ready && result.emptyChain) {
    return (
      <div className={styles.dialog} dir="rtl">
        <AttentionBox type="warning" title="לא ניתן לבחור אנשים" text={emptyChainMessage(result)} />
      </div>
    );
  }

  // Search-first shell — rendered IMMEDIATELY, even while settings / the
  // resolve chain are still loading in the background: team title (generic
  // until resolved) + search input. The member list appears only once the
  // user types; typing time masks the background load.
  const multiSelected = Array.isArray(selectedItemIds) && selectedItemIds.length > 1;

  return (
    <div className={styles.dialog} dir="rtl">
      <h2 className={styles.title}>{teamTitle(result)}</h2>

      {multiSelected && (
        <p className={styles.hint}>העריכה חלה על הפריט הנוכחי בלבד.</p>
      )}

      {ready && result.partial && (
        <AttentionBox
          compact
          type="warning"
          text="חלק מהפריטים המקושרים אינם נגישים לכם, ולכן ייתכן שרשימת האנשים המורשים חלקית."
        />
      )}

      {saveError && <AttentionBox compact type="danger" text={saveError} />}

      <PersonPicker
        inline
        searchFirst
        hideChips
        placeholder={SEARCH_PLACEHOLDER}
        listHeading={null}
        selected={selection}
        onChange={handleChange}
        users={ready ? result.users : []}
        usersLoading={!ready}
        single={single}
      />
    </div>
  );
}

export default OnClickDialog;

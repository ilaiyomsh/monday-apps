import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AttentionBox, Avatar, Skeleton } from '@vibe/core';

import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { useViewTracking } from '../../utils/viewTracking';
import { UPDATE_COLUMN_VALUE } from '../../services/graphqlQueries';
import { formatCellValue } from '../../domain/cellValue';
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
 * Loading UX: the dialog opens as a SKELETON (title row + search-box shapes)
 * and holds it until the settings read (useColumnSettings) and the allowed-set
 * resolve chain (useAllowedUsers) are fully resolved — then the real title
 * (avatar + name) and the search input appear TOGETHER in a single reveal (user
 * feedback: a live search box next to missing team details reads as incomplete
 * UI). Once ready it is search-first: the member list renders from the first
 * typed letter. Single-assignee is the ONLY mode: one person, picking another
 * replaces them, and a pick saves and closes the dialog. The current assignee
 * shows as a removable chip at the top (and is dropped from the suggestions
 * list). The write-back uses the native people-column format so monday
 * automations/notifications keep working.
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

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

/**
 * Dialog title row: team avatar + bare team name (no "צוות" prefix), so the
 * user always sees WHICH team they are picking from. The row's height is
 * reserved from the very first paint and stays EMPTY while the chain resolves
 * — the avatar and the name then appear together at once, with no interim
 * placeholder text and no layout jump (user feedback: progressive title
 * reveal reads as jank).
 */
function TeamTitleRow({ result }) {
  const teams = (result?.teams || []).filter((t) => t.name);
  if (teams.length === 0) {
    return <div className={styles.titleRow} aria-hidden="true" />;
  }
  return (
    <div className={styles.titleRow}>
      {teams.map((t) => (
        <Avatar
          key={t.id}
          size="small"
          src={t.picture || undefined}
          text={initialsOf(t.name)}
          type={t.picture ? 'img' : 'text'}
          ariaLabel={t.name}
        />
      ))}
      <h2 className={styles.title}>{teams.map((t) => t.name).join(', ')}</h2>
    </div>
  );
}

function OnClickDialog({ context }) {
  // Usage telemetry (D3): one view_open per session for this view (inert until the sink is active).
  useViewTracking(logger, 'onclick_picker');
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

  // Single-assignee is the ONLY mode (owner decision 2026-07-14): one person at
  // a time, and picking another REPLACES the current one. The stored policy no
  // longer toggles this — the picker is always single.
  const single = true;

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

  // Loading — a SKELETON from the very first paint until the team details are
  // fully resolved (user feedback: a live search box next to missing team
  // details reads as incomplete UI). The real title (avatar + name) and the
  // search box then appear TOGETHER at once — a single reveal.
  if (!ready) {
    return (
      <div className={styles.dialog} dir="rtl" data-testid="dialog-skeleton">
        <div className={styles.titleRow}>
          <Skeleton type="circle" width={24} height={24} />
          <Skeleton type="rectangle" width={120} height={14} />
        </div>
        <Skeleton type="rectangle" fullWidth height={32} />
      </div>
    );
  }

  // Ready — the search-first shell: title + search input; the member list
  // appears only once the user types (from the first letter).
  const multiSelected = Array.isArray(selectedItemIds) && selectedItemIds.length > 1;

  return (
    <div className={styles.dialog} dir="rtl">
      <TeamTitleRow result={result} />

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

      {saveError && <AttentionBox compact type="danger" text={saveError} />}

      <PersonPicker
        inline
        searchFirst
        hideSelectedInList
        placeholder={SEARCH_PLACEHOLDER}
        listHeading={null}
        selected={selection}
        onChange={handleChange}
        users={result.users}
        single={single}
      />
    </div>
  );
}

export default OnClickDialog;

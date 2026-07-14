import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AttentionBox } from '@vibe/core';

import mondayService from '../../services/mondayService';
import { GET_BOARD_COLUMNS } from '../../services/graphqlQueries';
import { validateSettings } from '../../domain/settingsSchema';
import {
  isBoardRelationColumn,
  isPeopleColumn,
  getLinkedBoardIds,
} from '../../domain/columnClassifiers';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { getVersionLabel } from '../../utils/versionLabel.js';
import LoadingState from '../shared/LoadingState';
import ErrorState from '../shared/ErrorState';
import Popover from '../shared/Popover';
import styles from './ColumnSettings.module.css';

/**
 * ColumnSettings — the column's SETTINGS placement (no itemId).
 *
 * Flow: load persisted settings (global storage keyed by boardId+columnId, via
 * useColumnSettings — carries the false-empty retry) → fetch the source board's
 * columns → pick a board_relation column → resolve its linked board → fetch that
 * board's columns → pick a people column → validate → persist a v1 settings
 * object → notice + closeDialog.
 *
 * The dialog is intentionally MINIMAL (owner decision 2026-07-14): just the two
 * column mappings and Save — no sub-headings, explanations, or policy controls,
 * so it fits one small iframe with no scroll. The policy is fixed (FIXED_POLICY):
 * single-assignee, union of all referenced teams, and directly-listed people
 * always included.
 *
 * Reopening preselects the saved values and re-resolves the linked board live,
 * warning if the relation column now points at a different board than the one stored.
 *
 * The two selects use the shared body-portal Popover (not Vibe Dropdown) so their
 * option lists never clip inside the small settings iframe.
 */

// Fixed policy — the UI no longer exposes these choices (owner decision
// 2026-07-14). Always single-assignee; always the UNION of every referenced
// team plus any directly-listed people.
const FIXED_POLICY = { selectionMode: 'single', aggregation: 'union', includeListedPersons: true };

/** A single Popover-backed select. Trigger is a native <button> (real disabled). */
function SelectField({ label, ariaLabel, placeholder, options, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const selected = options.find((o) => o.id === value);

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <button
        type="button"
        ref={anchorRef}
        className={styles.select}
        aria-label={ariaLabel || label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? styles.selectValue : styles.selectPlaceholder}>
          {selected ? selected.title : placeholder}
        </span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        width={340}
        height={300}
      >
        <div className={styles.listbox} role="listbox" aria-label={ariaLabel || label}>
          {options.length === 0 ? (
            <div className={styles.emptyOption}>אין עמודות זמינות</div>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                className={`${styles.option} ${o.id === value ? styles.optionSelected : ''}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.title}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}

function ColumnSettings({ context }) {
  const boardId = context?.boardId;

  const {
    settings: loadedSettings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings(context);

  // Source board columns.
  const [sourceColumns, setSourceColumns] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState(null);

  // Linked (target) board columns.
  const [linkedColumns, setLinkedColumns] = useState([]);
  const [linkedLoading, setLinkedLoading] = useState(false);

  // Selections + policy.
  const [relationColumnId, setRelationColumnId] = useState(null);
  const [peopleColumnId, setPeopleColumnId] = useState(null);
  const [pendingPeopleColumnId, setPendingPeopleColumnId] = useState(null);
  const [storedLinkedBoardId, setStoredLinkedBoardId] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const initedRef = useRef(false);

  const fetchBoardColumns = useCallback(async (id) => {
    const data = await mondayService.query(GET_BOARD_COLUMNS, { boardIds: [String(id)] });
    const board = (data?.boards || []).find((b) => String(b.id) === String(id));
    return board?.columns || [];
  }, []);

  const loadSourceColumns = useCallback(async () => {
    setSourceLoading(true);
    setSourceError(null);
    try {
      const cols = await fetchBoardColumns(boardId);
      setSourceColumns(cols);
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to load source board columns', err);
      setSourceError(err);
    } finally {
      setSourceLoading(false);
    }
  }, [boardId, fetchBoardColumns]);

  useEffect(() => {
    loadSourceColumns();
  }, [loadSourceColumns]);

  // Initialize selections from persisted settings once both loads have settled.
  useEffect(() => {
    if (initedRef.current) return;
    if (settingsLoading || sourceLoading) return;
    initedRef.current = true;
    if (loadedSettings) {
      setRelationColumnId(loadedSettings.relationColumnId ?? null);
      setPendingPeopleColumnId(loadedSettings.peopleColumnId ?? null);
      setStoredLinkedBoardId(loadedSettings.linkedBoardId ?? null);
    }
  }, [settingsLoading, sourceLoading, loadedSettings]);

  const relationColumns = useMemo(
    () => sourceColumns.filter(isBoardRelationColumn),
    [sourceColumns]
  );
  const peopleColumns = useMemo(
    () => linkedColumns.filter(isPeopleColumn),
    [linkedColumns]
  );

  const selectedRelationCol = useMemo(
    () => sourceColumns.find((c) => c.id === relationColumnId) || null,
    [sourceColumns, relationColumnId]
  );
  const linkedBoardIds = useMemo(
    () => (selectedRelationCol ? getLinkedBoardIds(selectedRelationCol) : []),
    [selectedRelationCol]
  );
  const linkedBoardId = linkedBoardIds[0] ?? null;
  const multipleBoards = linkedBoardIds.length > 1;
  const drift =
    storedLinkedBoardId != null &&
    linkedBoardId != null &&
    String(storedLinkedBoardId) !== String(linkedBoardId);

  // Fetch the linked board's columns whenever the resolved linked board changes.
  useEffect(() => {
    if (!linkedBoardId) {
      setLinkedColumns([]);
      return undefined;
    }
    let alive = true;
    setLinkedLoading(true);
    // async IIFE with internal try/catch/finally: never rejects, so it needs no
    // outer catch, and it avoids a trailing .finally() after .catch() (which the
    // promise/catch-or-return rule reads as an unterminated chain).
    (async () => {
      try {
        const cols = await fetchBoardColumns(linkedBoardId);
        if (alive) setLinkedColumns(cols);
      } catch (err) {
        logger.error('ColumnSettings', 'Failed to load linked board columns', err);
        if (alive) {
          setLinkedColumns([]);
          setSaveError('טעינת עמודות הלוח המקושר נכשלה. נסו שוב.');
        }
      } finally {
        if (alive) setLinkedLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [linkedBoardId, fetchBoardColumns]);

  // Once the linked columns arrive, restore a saved people-column selection.
  useEffect(() => {
    if (pendingPeopleColumnId == null) return;
    if (linkedColumns.length === 0) return;
    const exists = linkedColumns.some(
      (c) => c.id === pendingPeopleColumnId && isPeopleColumn(c)
    );
    if (exists) setPeopleColumnId(pendingPeopleColumnId);
    setPendingPeopleColumnId(null);
  }, [linkedColumns, pendingPeopleColumnId]);

  const handleRelationChange = (id) => {
    setRelationColumnId(id);
    setPeopleColumnId(null);
    setPendingPeopleColumnId(null);
    setStoredLinkedBoardId(null); // manual change clears the drift baseline
    setSaveError(null);
  };

  const canSave =
    !saving &&
    relationColumns.length > 0 &&
    !!relationColumnId &&
    peopleColumns.length > 0 &&
    !!peopleColumnId;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const v1 = {
      version: 1,
      relationColumnId,
      linkedBoardId,
      peopleColumnId,
      policy: FIXED_POLICY,
    };
    try {
      const { ok, problems } = validateSettings(v1, [...sourceColumns, ...linkedColumns]);
      if (!ok) {
        logger.warn('ColumnSettings', 'Settings failed validation', { problems });
        setSaveError('לא ניתן לשמור — בדקו שהעמודות שנבחרו עדיין קיימות בלוח.');
        setSaving(false);
        return;
      }
      await mondayService.setColumnConfig(boardId, context?.columnId, v1);
      mondayService.showNotice('ההגדרות נשמרו');
      mondayService.closeDialog();
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to save column settings', err);
      setSaveError('שמירת ההגדרות נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    mondayService.closeDialog();
  };

  if (settingsLoading || sourceLoading) {
    return <LoadingState message="טוען הגדרות..." />;
  }
  if (settingsError) {
    return (
      <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />
    );
  }
  if (sourceError) {
    return (
      <ErrorState message="טעינת עמודות הלוח נכשלה. נסו שוב." onRetry={loadSourceColumns} />
    );
  }

  const relationOptions = relationColumns.map((c) => ({ id: c.id, title: c.title }));
  const peopleOptions = peopleColumns.map((c) => ({ id: c.id, title: c.title }));
  const noRelationColumns = relationColumns.length === 0;
  const noPeopleColumns =
    !!linkedBoardId && !linkedLoading && peopleColumns.length === 0;

  return (
    <div className={styles.root} dir="rtl">
      {/* No app-level title: monday already shows "<column> - … column settings"
          as the popover header, so a second heading only wastes vertical space
          and forced the pane to scroll. */}
      {noRelationColumns ? (
        <AttentionBox
          type="warning"
          title="נדרשת עמודת חיבור לוחות"
          text="כדי להשתמש ברכיב זה, הוסיפו ללוח עמודת 'חיבור לוחות' (Connect Boards) המקושרת ללוח שמחזיק את הצוותים, ואז חזרו להגדרות."
        />
      ) : (
        <>
          <SelectField
            label="עמודת חיבור לוחות"
            ariaLabel="עמודת חיבור לוחות"
            placeholder="בחרו עמודת חיבור לוחות"
            options={relationOptions}
            value={relationColumnId}
            onChange={handleRelationChange}
          />
          {multipleBoards && (
            <p className={styles.caption}>
              עמודת החיבור מקושרת ליותר מלוח אחד — נעשה שימוש בלוח הראשון.
            </p>
          )}
          {drift && (
            <p className={styles.driftCaption}>
              הלוח המקושר השתנה מאז השמירה האחרונה — ודאו שעמודת האנשים עדיין נכונה.
            </p>
          )}

          <SelectField
            label="עמודת אנשים בלוח המקושר"
            ariaLabel="עמודת אנשים בלוח המקושר"
            placeholder={linkedLoading ? 'טוען עמודות...' : 'בחרו עמודת אנשים'}
            options={peopleOptions}
            value={peopleColumnId}
            onChange={(id) => {
              setPeopleColumnId(id);
              setSaveError(null);
            }}
            disabled={!linkedBoardId || linkedLoading}
          />
          {noPeopleColumns && (
            <div className={styles.inlineWarn}>
              <AttentionBox
                type="warning"
                compact
                text="בלוח המקושר אין עמודת אנשים. בחרו עמודת חיבור אחרת או הוסיפו עמודת אנשים ללוח המקושר."
              />
            </div>
          )}
        </>
      )}

      {saveError && (
        <div className={styles.inlineWarn}>
          <AttentionBox type="danger" compact text={saveError} />
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleSave}
          disabled={!canSave}
        >
          שמירה
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={handleCancel}
          disabled={saving}
        >
          ביטול
        </button>
      </div>

      {/* Version caption — Latin build label, forced LTR inside the RTL pane. */}
      <div className={styles.versionCaption} dir="ltr">
        {getVersionLabel()}
      </div>
    </div>
  );
}

export default ColumnSettings;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AttentionBox, Button, Heading } from '@vibe/core';
import { validateSettings } from '../../domain/settingsSchema';
import { isSupportedFormColumnType } from '../../domain/columnFields';
import { pickColorForNewLabel, resolveStatusColorHex } from '../../domain/statusColors';
import {
  buildCreateLabelPayload,
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createLabelsDraft,
  ensureDefaultLabelRow,
  findCreatedLabel,
  hasPendingLabelEdits,
  insertLabelBeforeDefault,
  pruneSettingsForActiveLabels,
  renumberDraftIndexes,
  reorderLabelsDraft,
} from '../../domain/statusLabelDraft';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import {
  GET_BOARD_SETTINGS_METADATA,
  GET_STATUS_COLUMN_REVISION,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import { loadAccountTeams } from '../../services/teamsAccess';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { VERSION_LABEL } from '../../utils/versionLabel';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import { PersonPicker } from '../shared/PersonPicker';
import StatusColorPicker from './StatusColorPicker';
import './ColumnSettings.css';

const TEAMS_SCOPE_HINT =
  'חסר הסקופ teams:read — בחירת צוותים לא זמינה.';

function OptionChecklist({ options, values, disabled, onChange, emptyText }) {
  const selected = new Set((values ?? []).map(String));
  if (!options.length) {
    return <p className="twyst-field-empty">{emptyText}</p>;
  }
  return (
    <div className="twyst-check-list" role="group">
      {options.map((option) => {
        const id = String(option.id);
        return (
          <label key={id} className="twyst-check-row">
            <input
              type="checkbox"
              checked={selected.has(id)}
              disabled={disabled || option.disabled}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                onChange([...next]);
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Custom dropdown — matches settings field chrome (not native <select>). */
function SelectDropdown({
  id,
  value,
  options,
  disabled,
  onChange,
  placeholder = 'בחירה',
  emptyText = 'אין אפשרויות',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const label = selected?.label || placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    try {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 200);
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - width - 8),
      );
      setPos({ top: rect.bottom + 4, left, width });
      setOpen(true);
    } catch (err) {
      logger.error('SelectDropdown', 'Failed to open dropdown', err);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`twyst-select-trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className={`twyst-select-value${!selected ? ' is-placeholder' : ''}`}>{label}</span>
        <span className="twyst-select-chevron" aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="twyst-select-menu"
          role="listbox"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 10000,
          }}
        >
          {options.length === 0 ? (
            <div className="twyst-select-empty">{emptyText}</div>
          ) : (
            options.map((option) => {
              const isActive = String(option.value) === String(value);
              return (
                <button
                  key={String(option.value) || '__none__'}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`twyst-select-option${isActive ? ' is-active' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function LabelCard({
  label,
  hidden,
  rule,
  users,
  teams,
  teamsAvailable,
  columns,
  peopleColumns,
  usedColors,
  saving,
  isFirst,
  isLast,
  onRename,
  onRecolor,
  onRemove,
  onMove,
  onToggleHidden,
  onChangeRule,
}) {
  // Accordion closed by default for every label — never auto-open on config.
  const [open, setOpen] = useState(false);
  const [requiredOpen, setRequiredOpen] = useState(false);

  const selectedActors = useMemo(() => {
    const people = (rule.allowedUserIds ?? []).map((id) => {
      const match = users.find((user) => String(user.id) === String(id));
      return match
        ? { id: String(match.id), name: match.name, kind: 'person' }
        : { id: String(id), name: String(id), kind: 'person' };
    });
    const teamEntries = (rule.allowedTeamIds ?? []).map((id) => {
      const match = teams.find((team) => String(team.id) === String(id));
      return match
        ? { id: String(match.id), name: match.name, kind: 'team' }
        : { id: String(id), name: String(id), kind: 'team' };
    });
    return [...people, ...teamEntries];
  }, [rule.allowedUserIds, rule.allowedTeamIds, users, teams]);

  const gatePeopleColumnId = rule.requiredPeopleColumnIds?.[0] ?? '';
  const gatePeopleTitle = peopleColumns.find((column) => column.id === gatePeopleColumnId)?.title;
  const peopleGateOptions = useMemo(() => ([
    { value: '', label: 'ללא הגבלה' },
    ...peopleColumns.map((column) => ({ value: column.id, label: column.title })),
  ]), [peopleColumns]);

  const summaryBits = [];
  if (hidden) summaryBits.push('מוסתר');
  if (rule.allowedUserIds?.length || rule.allowedTeamIds?.length) {
    const n = (rule.allowedUserIds?.length ?? 0) + (rule.allowedTeamIds?.length ?? 0);
    summaryBits.push(`${n} מורשים`);
  }
  if (gatePeopleTitle) summaryBits.push(gatePeopleTitle);
  if (rule.requiredColumnIds?.length) summaryBits.push(`${rule.requiredColumnIds.length} שדות חובה`);

  const requiredCount = rule.requiredColumnIds?.length ?? 0;

  /*
   * The grey DEFAULT label — monday's empty status. Its card carries the one thing that
   * IS editable about it, the text, and nothing that is not: monday forces the colour to
   * grey and refuses to delete the label once it exists, so a colour picker and a remove
   * button here would be two controls that lie. Leaving the text empty is a valid state
   * (and the one a fresh column is in) — nothing is written until something is typed.
   */
  const isDefaultLabel = label.isDefaultEmpty === true;

  return (
    <article className={`twyst-label-card${open ? ' is-open' : ''}${isDefaultLabel ? ' is-default' : ''}`}>
      <div className="twyst-label-identity">
        {isDefaultLabel ? (
          <span
            className="twyst-color-circle is-static"
            style={{ background: label.color }}
            title="ברירת המחדל של monday — תמיד אפור"
            aria-hidden="true"
          />
        ) : (
          <StatusColorPicker
            colorValue={label.colorValue}
            hex={label.color}
            usedColorEnums={usedColors}
            disabled={saving}
            onChange={(next) => onRecolor(label.clientKey, next)}
          />
        )}
        <input
          className="twyst-label-name-input"
          type="text"
          value={label.label}
          aria-label={isDefaultLabel ? 'שם לייבל ברירת המחדל' : 'שם הלייבל'}
          placeholder={isDefaultLabel ? 'ללא טקסט' : undefined}
          disabled={saving}
          onChange={(event) => onRename(label.clientKey, event.target.value)}
        />
        <div className="twyst-label-actions">
          {isDefaultLabel ? (
            <span className="twyst-label-default-tag">ברירת מחדל</span>
          ) : (
            <>
              <div className="twyst-label-order" role="group" aria-label="סדר הלייבל">
                <button
                  type="button"
                  className="twyst-icon-btn"
                  disabled={saving || isFirst}
                  aria-label="הזז למעלה"
                  onClick={() => onMove(label.clientKey, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="twyst-icon-btn"
                  disabled={saving || isLast}
                  aria-label="הזז למטה"
                  onClick={() => onMove(label.clientKey, 1)}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                className="twyst-text-btn is-danger"
                disabled={saving}
                onClick={() => onRemove(label.clientKey)}
              >
                הסרה
              </button>
            </>
          )}
        </div>
      </div>

      {/*
        Rendered for a NEW label too, which is the point of 3.9.0. Its rules are held
        under the draft's client key ("new:1") and moved onto the id monday assigns in
        the same save — see handleSave. This section used to be hidden until the label
        existed, so creating one and restricting it took two visits with nothing on the
        card to say why the accordion was missing.
      */}
      <div className="twyst-label-access">
        <div className="twyst-label-access-bar">
          <label className="twyst-check">
            <input
              type="checkbox"
              checked={hidden}
              disabled={saving}
              onChange={() => onToggleHidden(label.id)}
            />
            <span>מוסתר בבורר</span>
          </label>
          <button
            type="button"
            className="twyst-text-btn twyst-accordion-toggle"
            aria-expanded={open}
            disabled={saving}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={`twyst-accordion-chevron${open ? ' is-open' : ''}`} aria-hidden="true">▾</span>
            {open ? 'הסתר הרשאות' : 'הרשאות'}
            {!open && summaryBits.length > 0 ? ` · ${summaryBits.join(' · ')}` : ''}
          </button>
        </div>

        {open && (
          <div className="twyst-permissions">
            <div className="twyst-field twyst-field-actors">
              <span className="twyst-field-label">אנשים וצוותים מורשים</span>
              <PersonPicker
                selected={selectedActors}
                users={users}
                teams={teamsAvailable ? teams : []}
                bordered
                onChange={(actors) => {
                  const nextActors = actors || [];
                  onChangeRule(label.id, {
                    allowedUserIds: nextActors
                      .filter((actor) => actor.kind !== 'team')
                      .map((actor) => String(actor.id)),
                    allowedTeamIds: nextActors
                      .filter((actor) => actor.kind === 'team')
                      .map((actor) => String(actor.id)),
                  });
                }}
              />
            </div>

            <div className="twyst-field twyst-field-people-gate">
              <label className="twyst-field-label" htmlFor={`people-gate-${label.clientKey}`}>
                חייב להופיע בעמודת אנשים
              </label>
              <SelectDropdown
                id={`people-gate-${label.clientKey}`}
                value={gatePeopleColumnId}
                options={peopleGateOptions}
                disabled={saving || peopleColumns.length === 0}
                placeholder="ללא הגבלה"
                emptyText="אין עמודות אנשים בלוח"
                onChange={(nextValue) => onChangeRule(label.id, {
                  requiredPeopleColumnIds: nextValue ? [nextValue] : [],
                })}
              />
            </div>

            <div className="twyst-field twyst-field-required">
              <button
                type="button"
                className="twyst-collapse-toggle"
                aria-expanded={requiredOpen}
                disabled={saving}
                onClick={() => setRequiredOpen((current) => !current)}
              >
                <span className={`twyst-accordion-chevron${requiredOpen ? ' is-open' : ''}`} aria-hidden="true">▾</span>
                <span className="twyst-field-label">שדות חובה במעבר</span>
                {requiredCount > 0 && (
                  <span className="twyst-collapse-count">{requiredCount}</span>
                )}
              </button>
              {requiredOpen && (
                <OptionChecklist
                  options={columns.map((column) => ({
                    id: column.id,
                    label: column.title,
                    disabled: !isSupportedFormColumnType(column.type),
                  }))}
                  values={rule.requiredColumnIds}
                  disabled={saving}
                  emptyText="אין עמודות זמינות"
                  onChange={(next) => onChangeRule(label.id, { requiredColumnIds: next })}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function ColumnSettings({ context, variant = 'overlay' }) {
  const isOverlay = variant === 'overlay';
  const boardId = context?.boardId;
  const columnId = context?.columnId;
  const {
    settings: loadedSettings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings(context);

  const [metadata, setMetadata] = useState(null);
  const [draft, setDraft] = useState(null);
  const [labelsDraft, setLabelsDraft] = useState(null);
  const [labelsBaseline, setLabelsBaseline] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addingLabel, setAddingLabel] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadMetadata = useCallback(async () => {
    try {
      setMetaLoading(true);
      setMetaError(null);
      const [data, teamsResult] = await Promise.all([
        mondayService.query(GET_BOARD_SETTINGS_METADATA, {
          boardIds: [String(boardId)],
        }),
        loadAccountTeams(),
      ]);
      const board = data?.boards?.[0];
      if (!board) throw new Error('הלוח לא נמצא');
      setMetadata({
        columns: board.columns ?? [],
        users: data.users ?? [],
        teams: teamsResult.teams,
        teamsAvailable: teamsResult.teamsAvailable,
      });
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to load board metadata', err);
      setMetaError(err);
    } finally {
      setMetaLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    if (settingsLoading || metaLoading) return;
    if (draft) return;
    setDraft(loadedSettings ?? {
      version: 1,
      hiddenLabelIds: [],
      labels: {},
    });
  }, [settingsLoading, metaLoading, loadedSettings, draft]);

  const statusColumn = useMemo(
    () => metadata?.columns.find((column) => column.id === columnId) ?? null,
    [metadata, columnId],
  );

  useEffect(() => {
    if (!statusColumn) return;
    const all = normalizeStatusLabels(statusColumn.settings);
    // The grey default card is always on screen, whether or not the column has that
    // label yet — monday shows it too, and it is the only place its text can be set.
    const draftLabels = ensureDefaultLabelRow(createLabelsDraft(all));
    setLabelsDraft(draftLabels);
    setLabelsBaseline(draftLabels);
  }, [statusColumn]);

  // The single upstream source for the required-fields checklist AND peopleColumns, so
  // one predicate here removes a column from both.
  //
  // `name` is monday's item-title column. The board query returns it like any other, so
  // it used to sit in the checklist greyed out (no FIELD_SPECS entry ⇒ unsupported) —
  // an unselectable row offering to make the item's own name a required field. It is not
  // a governable field, so it is not listed at all.
  const formColumns = useMemo(
    () => (metadata?.columns ?? []).filter(
      (column) => column.id !== columnId && column.type !== 'name',
    ),
    [metadata, columnId],
  );

  const peopleColumns = useMemo(
    () => formColumns.filter((column) => column.type === 'people'),
    [formColumns],
  );

  const getRule = (labelId) => draft?.labels?.[labelId] ?? {
    allowedUserIds: [],
    allowedTeamIds: [],
    requiredColumnIds: [],
    requiredPeopleColumnIds: [],
  };

  const toggleHidden = (labelId) => {
    setDraft((current) => {
      const hidden = new Set(current.hiddenLabelIds);
      if (hidden.has(labelId)) hidden.delete(labelId);
      else hidden.add(labelId);
      return { ...current, hiddenLabelIds: [...hidden] };
    });
  };

  const changeRule = (labelId, patch) => {
    setDraft((current) => {
      const existing = current.labels?.[labelId] ?? {
        allowedUserIds: [],
        allowedTeamIds: [],
        requiredColumnIds: [],
        requiredPeopleColumnIds: [],
      };
      return {
        ...current,
        labels: {
          ...current.labels,
          [labelId]: { ...existing, ...patch },
        },
      };
    });
  };

  const renameLabel = (clientKey, nextName) => {
    setLabelsDraft((current) => current.map((label) => (
      label.clientKey === clientKey ? { ...label, label: nextName } : label
    )));
  };

  const recolorLabel = (clientKey, colorEnum) => {
    setLabelsDraft((current) => current.map((label) => (
      label.clientKey === clientKey
        ? {
          ...label,
          colorValue: colorEnum,
          color: resolveStatusColorHex(colorEnum) || label.color,
        }
        : label
    )));
  };

  const removeLabel = (clientKey) => {
    setLabelsDraft((current) => current.filter((label) => label.clientKey !== clientKey));
  };

  const moveLabel = (clientKey, delta) => {
    setLabelsDraft((current) => reorderLabelsDraft(current, clientKey, delta));
  };

  /**
   * Create the label NOW, not on save.
   *
   * monday derives a new label's id from its colour and may override the colour
   * server-side, so an optimistically rendered row showed a colour the board did not
   * agree with — purple here, grey on the board, orange on the next visit. The only
   * colour worth showing is the one that came back, so the round trip happens on the
   * click, behind a busy button, and the card is rendered from the response.
   *
   * A consequence worth knowing: the label exists on the column from this point, so
   * Cancel no longer un-creates it (removing it is a separate edit, saved as usual).
   */
  const addLabel = async () => {
    try {
      setAddingLabel(true);
      setSaveError(null);

      const revisionData = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
        boardIds: [String(boardId)],
        columnIds: [columnId],
      });
      const liveColumn = revisionData?.boards?.[0]?.columns?.[0];
      const revision = liveColumn?.revision;
      if (!revision) {
        throw new Error('חסר revision לעמודת הסטטוס — לא ניתן להוסיף לייבל');
      }
      const liveAll = normalizeStatusLabels(liveColumn.settings);

      /*
       * The colour is an identity decision, not decoration: its numeric id becomes the
       * label's id, and a colour whose id is already taken — by an active label, by an
       * invisible deactivated one, or by the reserved empty-label slot — rejects the
       * whole mutation. pickColorForNewLabel answers both questions at once.
       */
      const colorValue = pickColorForNewLabel(liveAll);
      const payload = buildCreateLabelPayload(liveAll, { colorValue });
      await mondayService.query(buildUpdateStatusColumnMutation(payload), {
        boardId: String(boardId),
        columnId,
        revision: String(revision),
      });

      const refreshed = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
        boardIds: [String(boardId)],
        columnIds: [columnId],
      });
      const refreshedLabels = normalizeStatusLabels(refreshed?.boards?.[0]?.columns?.[0]?.settings);
      const created = findCreatedLabel(liveAll, refreshedLabels);
      if (!created) {
        throw new Error('הלייבל נוצר אך לא נמצא בקריאה החוזרת');
      }

      /*
       * Appended to the draft rather than re-seeding it from the refresh: re-seeding
       * would discard whatever the admin has already typed into the other cards. The
       * baseline gets the same row, so the creation does not read as a pending edit and
       * the next save does not resend it.
       */
      const [createdRow] = createLabelsDraft([created]);
      setLabelsDraft((current) => insertLabelBeforeDefault(current, createdRow));
      setLabelsBaseline((current) => insertLabelBeforeDefault(current, createdRow));
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to create a status label', err);
      const message = err?.message || '';
      if (/default status label color|Colors should be unique/i.test(message)) {
        setSaveError('לא נותר צבע פנוי שניתן להקצות לו לייבל חדש בעמודה הזו.');
      } else {
        setSaveError('הוספת הלייבל נכשלה. נסו שוב.');
      }
    } finally {
      setAddingLabel(false);
    }
  };

  const dismiss = async ({ saved = false } = {}) => {
    try {
      if (isOverlay) {
        await mondayService.closeAppFeatureModal();
      }
      if (saved || !isOverlay) {
        await mondayService.closeDialog();
      }
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to close settings surface', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      /*
       * The default (grey) label is exempt from both rules below. It is allowed to be
       * nameless — that IS its normal state, and an empty one is simply never written —
       * so it can neither stand in for the one label a column must have nor block a save
       * for having no name. A coloured label still must have one.
       */
      const coloredDraft = (labelsDraft ?? []).filter((label) => !label.isDefaultEmpty);
      if (coloredDraft.length === 0) {
        setSaveError('חייבים להשאיר לפחות לייבל פעיל אחד.');
        return;
      }
      if (coloredDraft.some((label) => !String(label.label || '').trim())) {
        setSaveError('לכל לייבל חייב להיות שם.');
        return;
      }

      // Every card on screen already carries a real monday id — labels are created on
      // the "add label" click, not here — so the rules in `draft` are keyed correctly
      // from the start and nothing needs remapping after the mutation.
      let activeLabelIds = labelsDraft.map((label) => String(label.id));

      if (hasPendingLabelEdits(labelsDraft, labelsBaseline)) {
        const revisionData = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
          boardIds: [String(boardId)],
          columnIds: [columnId],
        });
        const liveColumn = revisionData?.boards?.[0]?.columns?.[0];
        const revision = liveColumn?.revision;
        if (!revision) {
          throw new Error('חסר revision לעמודת הסטטוס — לא ניתן לעדכן לייבלים');
        }
        const liveFresh = normalizeStatusLabels(liveColumn.settings);
        /*
         * Renumber to 0..n-1 HERE, after the pending-edits check and before the payload:
         * the payload sends positions, with deactivated rows packed above the actives so
         * no two indexes collide. Doing it BEFORE `hasPendingLabelEdits` would read as an
         * edit on any column with a removed label and fire this mutation on every save.
         */
        const orderedDraft = renumberDraftIndexes(labelsDraft);
        const payload = buildStatusLabelsUpdatePayload(orderedDraft, liveFresh);
        const mutation = buildUpdateStatusColumnMutation(payload);
        await mondayService.query(mutation, {
          boardId: String(boardId),
          columnId,
          revision: String(revision),
        });

        const refreshed = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
          boardIds: [String(boardId)],
          columnIds: [columnId],
        });
        const refreshedColumn = refreshed?.boards?.[0]?.columns?.[0];
        const refreshedLabels = normalizeStatusLabels(refreshedColumn?.settings);
        activeLabelIds = refreshedLabels
          .filter((label) => !label.isDeactivated)
          .map((label) => String(label.id));

        /*
         * Re-seed the label draft from what monday now HAS, so a second save attempt —
         * after a storage failure, or the validation error below — starts from the
         * persisted state rather than replaying edits that already landed.
         */
        const reseeded = ensureDefaultLabelRow(createLabelsDraft(refreshedLabels));
        setLabelsDraft(reseeded);
        setLabelsBaseline(reseeded);
      }

      const next = pruneSettingsForActiveLabels(draft, activeLabelIds);
      const { ok, problems } = validateSettings(next, metadata.columns);
      if (!ok) {
        logger.warn('ColumnSettings', 'Settings failed validation', { problems });
        setSaveError('לא ניתן לשמור — בדקו שעמודות החובה עדיין קיימות בלוח.');
        return;
      }
      const unsupported = Object.values(next.labels).flatMap((rule) => rule.requiredColumnIds)
        .filter((id) => {
          const column = metadata.columns.find((candidate) => candidate.id === id);
          return column && !isSupportedFormColumnType(column.type);
        });
      if (unsupported.length > 0) {
        setSaveError('חלק משדות החובה אינם נתמכים בטופס המעבר.');
        return;
      }
      await mondayService.setColumnConfig(boardId, columnId, next);

      mondayService.showNotice('ההגדרות נשמרו');
      await dismiss({ saved: true });
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to save column settings', err);
      const message = err?.message || '';
      if (/Colors should be unique|colors should be unique/i.test(message)) {
        setSaveError('לכל לייבל חייב להיות צבע ייחודי.');
      } else if (/in use|can't delete|cannot delete|default/i.test(message)) {
        setSaveError('לא ניתן להסיר לייבל שנמצא בשימוש או שהוא ברירת המחדל.');
      } else {
        setSaveError('שמירת ההגדרות נכשלה. נסו שוב.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (settingsLoading || metaLoading || !draft || !labelsDraft) {
    return <LoadingState message="טוען הגדרות…" />;
  }
  if (settingsError) {
    return <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />;
  }
  if (metaError) {
    return <ErrorState message="טעינת נתוני הלוח נכשלה. נסו שוב." onRetry={loadMetadata} />;
  }
  if (!statusColumn || statusColumn.type !== 'status') {
    return <ErrorState message="העמודה שנפתחה אינה עמודת Status פעילה." />;
  }

  const hiddenSet = new Set(draft.hiddenLabelIds);
  const lastColoredIndex = labelsDraft.reduce(
    (last, label, index) => (label.isDefaultEmpty ? last : index),
    -1,
  );

  return (
    <main className={`twyst-settings${isOverlay ? ' is-overlay' : ''}`} dir="rtl">
      <header className="twyst-settings-header">
        <button
          type="button"
          className="twyst-settings-close"
          onClick={() => dismiss()}
          aria-label="סגירה"
          disabled={saving}
        >
          ×
        </button>
        <Heading type="h4">הגדרות</Heading>
      </header>

      <div className="twyst-settings-body">
        {!metadata.teamsAvailable && (
          <AttentionBox type="warning" text={TEAMS_SCOPE_HINT} />
        )}

        <div className="twyst-settings-toolbar">
          {/* `loading` is the spinner ON the button: creating a label is a round trip
              now, and the wait has to be visible where the click happened. */}
          <Button
            kind="secondary"
            size="small"
            loading={addingLabel}
            disabled={saving || addingLabel}
            onClick={addLabel}
          >
            הוספת לייבל
          </Button>
        </div>

        {/* The grey card is pinned to the bottom, so "last" for the arrows means the
            last COLOURED label — otherwise the one above it could never move down. */}
        {labelsDraft.map((label, labelIndex) => {
          const usedColors = labelsDraft
            .filter((other) => other.clientKey !== label.clientKey)
            .map((other) => other.colorValue);
          return (
            <LabelCard
              key={label.clientKey}
              label={label}
              hidden={hiddenSet.has(label.id)}
              rule={getRule(label.id)}
              users={metadata.users}
              teams={metadata.teams}
              teamsAvailable={metadata.teamsAvailable}
              columns={formColumns}
              peopleColumns={peopleColumns}
              usedColors={usedColors}
              saving={saving || addingLabel}
              isFirst={labelIndex === 0}
              isLast={labelIndex === lastColoredIndex}
              onRename={renameLabel}
              onRecolor={recolorLabel}
              onRemove={removeLabel}
              onMove={moveLabel}
              onToggleHidden={toggleHidden}
              onChangeRule={changeRule}
            />
          );
        })}

        {saveError && <AttentionBox type="danger" text={saveError} />}
      </div>

      <footer className="twyst-settings-footer">
        <Button kind="primary" size="small" disabled={saving} onClick={handleSave}>
          {saving ? 'שומר…' : 'שמור'}
        </Button>
        <Button kind="tertiary" size="small" disabled={saving} onClick={() => dismiss()}>
          ביטול
        </Button>
        <span className="twyst-version" dir="ltr">{VERSION_LABEL}</span>
      </footer>
    </main>
  );
}

export default ColumnSettings;

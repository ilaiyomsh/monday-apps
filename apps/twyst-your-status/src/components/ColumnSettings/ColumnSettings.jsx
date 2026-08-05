import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AttentionBox, Button, Heading } from '@vibe/core';
import { emptyLabelRule, validateSettings } from '../../domain/settingsSchema';
import { isSupportedFormColumnType } from '../../domain/columnFields';
import { RESERVED_EMPTY_LABEL_ID, pickColorForNewLabel, resolveStatusColorHex } from '../../domain/statusColors';
import {
  addOwner,
  bootstrapOwners,
  normalizeOwners,
  removeOwner,
  setPrimaryOwner,
} from '../../domain/columnOwners';
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
import { enrollColumnGuard } from '../../services/guardEnroll';
import { startGuardAuthorization } from '../../services/guardAuthorize';
import { getGuardStatus } from '../../services/guardStatus';
import mondayService from '../../services/mondayService';
import BypassMonitor from './BypassMonitor';
import { loadAccountTeams } from '../../services/teamsAccess';
import useColumnSettings from '../../hooks/useColumnSettings';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import logger from '../../utils/logger';
import { clampOverlayLeft } from '../../utils/overlayPlacement';
import { VERSION_LABEL } from '../../utils/versionLabel';
import ErrorState, { SETTINGS_LOAD_ERROR_MESSAGE } from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import { PersonPicker } from '../shared/PersonPicker';
import StatusColorPicker from './StatusColorPicker';
import './ColumnSettings.css';

const TEAMS_SCOPE_HINT =
  'חסר הסקופ teams:read — בחירת צוותים לא זמינה.';

const byIdMap = (list, valueOf) => Object.fromEntries((list ?? []).map((x) => [String(x.id), valueOf(x)]));

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

  useDismissOnOutside(open, [menuRef, triggerRef], () => setOpen(false));

  const openMenu = () => {
    if (disabled) return;
    try {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 200);
      const left = clampOverlayLeft(rect.left, width, window.innerWidth);
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

/** Small inline SVG icons — the text glyphs (↑ ↓ הסרה) read as an afterthought. */
function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 10 8 5.5 12.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 6 8 10.5 12.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V4m2.7 0-.5 9.2a1 1 0 0 1-1 .95H5.3a1 1 0 0 1-1-.95L3.8 4M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  transitionTargets,
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
  const [transitionsOpen, setTransitionsOpen] = useState(false);

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

  /*
   * round321 — transitions. The rule field is an ARRAY only while restricted
   * (see settingsSchema); no array = every target allowed, which is what the
   * all-checked checklist stores back as `null` so old blobs stay byte-identical.
   */
  const restricted = Array.isArray(rule.nextLabelIds);
  const allowedNext = restricted ? new Set(rule.nextLabelIds.map(String)) : null;
  const isTargetChecked = (id) => (allowedNext === null ? true : allowedNext.has(String(id)));
  const toggleTarget = (id) => {
    const next = transitionTargets
      .filter((target) => (String(target.id) === String(id)
        ? !isTargetChecked(target.id)
        : isTargetChecked(target.id)))
      .map((target) => String(target.id));
    onChangeRule(label.id, {
      nextLabelIds: next.length === transitionTargets.length ? null : next,
    });
  };

  const summaryBits = [];
  if (hidden) summaryBits.push('מוסתר');
  if (rule.allowedUserIds?.length || rule.allowedTeamIds?.length) {
    const n = (rule.allowedUserIds?.length ?? 0) + (rule.allowedTeamIds?.length ?? 0);
    summaryBits.push(`${n} מורשים`);
  }
  if (gatePeopleTitle) summaryBits.push(gatePeopleTitle);
  if (rule.requiredColumnIds?.length) summaryBits.push(`${rule.requiredColumnIds.length} שדות חובה`);
  if (restricted) summaryBits.push(rule.nextLabelIds.length > 0 ? `מעברים: ${rule.nextLabelIds.length}` : 'ללא מעברים');

  const requiredCount = rule.requiredColumnIds?.length ?? 0;
  const cardName = label.isDefaultEmpty === true && !label.label.trim() ? 'ברירת המחדל' : label.label;

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
                  title="הזז למעלה"
                  onClick={() => onMove(label.clientKey, -1)}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="twyst-icon-btn"
                  disabled={saving || isLast}
                  aria-label="הזז למטה"
                  title="הזז למטה"
                  onClick={() => onMove(label.clientKey, 1)}
                >
                  <ChevronDownIcon />
                </button>
              </div>
              <button
                type="button"
                className="twyst-icon-btn is-danger"
                disabled={saving}
                aria-label="הסרה"
                title="הסרה"
                onClick={() => onRemove(label.clientKey)}
              >
                <TrashIcon />
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
          {/* The configuration at a glance, without opening anything: one quiet chip
              per active restriction. Rendered beside the toggle (not inside it) so a
              chip's text never leaks into the button's accessible name. */}
          {!open && summaryBits.length > 0 && (
            <span className="twyst-summary-chips" aria-hidden="false">
              {summaryBits.map((bit, chipIndex) => (
                // Index-qualified key: one bit is an admin-chosen people-column
                // TITLE, which may equal another bit's literal text (review P3).
                <span key={`${chipIndex}-${bit}`} className="twyst-summary-chip">{bit}</span>
              ))}
            </span>
          )}
          <button
            type="button"
            className="twyst-text-btn twyst-accordion-toggle"
            aria-expanded={open}
            disabled={saving}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={`twyst-accordion-chevron${open ? ' is-open' : ''}`} aria-hidden="true">▾</span>
            {open ? 'הסתר הרשאות' : 'הרשאות'}
          </button>
        </div>

        {open && (
          <div className="twyst-permissions">
            <div className="twyst-section-title">מי רשאי לבחור את הלייבל</div>
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

            {/*
              round321 — transitions FROM this label: which labels the picker offers
              once this one is the current status. All checked = unrestricted (stored
              as no rule at all); a subset = only those; none = a terminal status.
              The default (grey) card is the EMPTY state's source — its rule, keyed
              by the reserved id 5, governs what may be picked first.
            */}
            <div className="twyst-field twyst-field-transitions">
              <button
                type="button"
                className="twyst-collapse-toggle"
                aria-expanded={transitionsOpen}
                disabled={saving}
                onClick={() => setTransitionsOpen((current) => !current)}
              >
                <span className={`twyst-accordion-chevron${transitionsOpen ? ' is-open' : ''}`} aria-hidden="true">▾</span>
                <span className="twyst-field-label">מעברים מותרים</span>
                {restricted && (
                  <span className="twyst-collapse-count">{rule.nextLabelIds.length}</span>
                )}
              </button>
              {transitionsOpen && (
                transitionTargets.length === 0 ? (
                  <div className="twyst-transition-list">
                    <p className="twyst-field-empty">אין לייבלים נוספים בעמודה.</p>
                    {/* A stored restriction with zero visible targets would otherwise
                        be UNCLEARABLE — the checkboxes are the only other writer. */}
                    {restricted && (
                      <button
                        type="button"
                        className="twyst-text-btn"
                        disabled={saving}
                        onClick={() => onChangeRule(label.id, { nextLabelIds: null })}
                      >
                        ביטול ההגבלה
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className="twyst-transition-list"
                    role="group"
                    aria-label={`מעברים מותרים מ${cardName}`}
                  >
                    <p className="twyst-field-hint">
                      אחרי הלייבל הזה יוצעו בבורר רק הלייבלים המסומנים. השארת כולם
                      מסומנים = ללא הגבלה.
                    </p>
                    {transitionTargets.map((target) => (
                      <label key={target.id} className="twyst-transition-chip">
                        <input
                          type="checkbox"
                          aria-label={target.label}
                          checked={isTargetChecked(target.id)}
                          disabled={saving}
                          onChange={() => toggleTarget(target.id)}
                        />
                        <span className="twyst-transition-dot" style={{ background: target.color }} aria-hidden="true" />
                        <span className="twyst-transition-name">{target.label}</span>
                      </label>
                    ))}
                  </div>
                )
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
  const currentUserId = context?.user?.id;
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
    const base = loadedSettings ?? { version: 1, hiddenLabelIds: [], labels: {} };
    // round322: the person configuring an UNADOPTED column becomes its first owner
    // AND primary (the revert identity) the moment the screen opens — so the owners
    // editor never renders empty, and a save always persists a non-empty owner list.
    // An already-adopted column keeps its stored owners untouched.
    const owners = normalizeOwners(base.owners)
      ?? (currentUserId != null ? bootstrapOwners(currentUserId) : null);
    setDraft(owners ? { ...base, owners } : base);
  }, [settingsLoading, metaLoading, loadedSettings, draft, currentUserId]);

  const statusColumn = useMemo(
    () => metadata?.columns.find((column) => column.id === columnId) ?? null,
    [metadata, columnId],
  );

  /*
   * round321 — the labels a transition may point AT: every row except the source
   * itself, and except a default row that neither exists on the LIVE column nor is
   * being named in this visit. Existence comes from the live ids, not the draft
   * name (review-confirmed): an id-5 label whose text was cleared (round313) is
   * still a real label the picker offers, so it must stay targetable — keying off
   * the name alone made it silently drop out of every restriction it appeared in.
   */
  const liveHasDefaultLabel = useMemo(
    () => normalizeStatusLabels(statusColumn?.settings)
      .some((live) => !live.isDeactivated && String(live.id) === String(RESERVED_EMPTY_LABEL_ID)),
    [statusColumn],
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

  const getRule = (labelId) => draft?.labels?.[labelId] ?? emptyLabelRule();

  const toggleHidden = (labelId) => {
    setDraft((current) => {
      const hidden = new Set(current.hiddenLabelIds);
      if (hidden.has(labelId)) hidden.delete(labelId);
      else hidden.add(labelId);
      return { ...current, hiddenLabelIds: [...hidden] };
    });
  };

  // round322 — owner-list edits go through the pure domain mutations, which hold
  // the invariants (always one primary, never owner-less, crown moves only here).
  const draftOwners = normalizeOwners(draft?.owners);

  // round323 — id→name maps the bypass monitor resolves its records against.
  const labelsById = useMemo(() => byIdMap(labelsDraft, (label) => label.label), [labelsDraft]);
  const columnsById = useMemo(() => byIdMap(metadata?.columns, (column) => column.title), [metadata]);
  const usersById = useMemo(() => byIdMap(metadata?.users, (user) => user.name), [metadata]);
  const addOwnerId = (userId) => setDraft((current) => ({ ...current, owners: addOwner(current.owners, userId) }));
  const removeOwnerId = (userId) => setDraft((current) => ({ ...current, owners: removeOwner(current.owners, userId) }));
  const makePrimaryOwner = (userId) => setDraft((current) => ({ ...current, owners: setPrimaryOwner(current.owners, userId) }));

  const changeRule = (labelId, patch) => {
    setDraft((current) => {
      const existing = current.labels?.[labelId] ?? emptyLabelRule();
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
      //
      // round321 — the synthesized default row counts as ACTIVE only when the id-5
      // label exists (or is being named right now): prune trims transition targets
      // to this list, and a '5' that will not exist after the save must not survive
      // as a target nothing can ever reach (the rule KEY '5' is kept by prune
      // itself, unconditionally).
      let activeLabelIds = labelsDraft
        .filter((label) => !label.isDefaultEmpty || label.label.trim() !== '' || liveHasDefaultLabel)
        .map((label) => String(label.id));

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

      // prune rebuilds the labels/hidden shape; re-attach the owner list (round322)
      // so the stored blob keeps who may configure and who reverts are written as.
      const pruned = pruneSettingsForActiveLabels(draft, activeLabelIds);
      const savedOwners = normalizeOwners(draft.owners);
      const next = {
        ...pruned,
        ...(savedOwners ? { owners: savedOwners } : {}),
        // round323 — auto-revert is a per-column setting the guard reads; carry
        // it only when true so a monitoring-only column keeps its lean blob.
        ...(draft.autoRevert === true ? { autoRevert: true } : {}),
      };
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

      /*
       * round322: guard enrollment — registers the server watchdog's webhook on
       * this column. round329: AWAITED, and its outcome is reported.
       *
       * It was fire-and-forget, which never worked in production: the call must
       * first ask monday for a sessionToken (a postMessage round trip), and
       * dismiss() below closes this surface — destroying the iframe, and with it
       * a request that had not been sent yet. No column was ever enrolled, and
       * the save still said "נשמרו". enrollColumnGuard is total (a status for
       * every outcome, never a throw) and bounded, so awaiting it can neither
       * fail the save nor hang the screen.
       */
      const enrollment = await enrollColumnGuard({ boardId, columnId });

      // The settings ARE saved — that stays true whatever the guard answered.
      mondayService.showNotice('ההגדרות נשמרו');
      // But a column the guard does not watch is not protected, and this screen's
      // switch says it is. Say so rather than let the owner assume.
      const enrollmentIssue = enrollmentProblem(enrollment);
      if (enrollmentIssue) {
        mondayService.showNotice(`ההגדרות נשמרו, אך ${enrollmentIssue}`, 'error');
      }
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

  // round326 — the guard's connection state, so the one switch can show
  // "מחובר ✓" vs "דרוש אישור". round327 (+Codex P2): the line renders only when
  // the DRAFT primary owner is the CURRENT USER, so the exact question it asks
  // is "am I authorized" (meAuthorized) — the stored-primary signal
  // (primaryAuthorized) goes stale the moment the user crowns themselves in the
  // draft, and account-level `activated` can be true thanks to a DIFFERENT
  // owner while this column's reverts are all skipped. Those two are fallbacks,
  // in that order, only when the server cannot answer. null = unknown/loading.
  // round330 — `enrolled` rides the same probe and used to be dropped on the
  // floor: it is the only on-screen answer to "does this column actually carry
  // its webhook", which is what decides whether ANY of this works (no webhook →
  // no revert AND no bypass ever recorded). tri-state, and the third state is
  // load-bearing: null means the guard did not answer, which must not be shown
  // as "not registered".
  const [guardConn, setGuardConn] = useState({
    activated: null, primaryAuthorized: null, meAuthorized: null, enrolled: null,
  });
  const guardConnected = guardConn.meAuthorized ?? guardConn.primaryAuthorized ?? guardConn.activated;
  const [enrolling, setEnrolling] = useState(false);

  const refreshGuardStatus = useCallback(async () => {
    if (!boardId || !columnId) return;
    const {
      activated, primaryAuthorized, meAuthorized, enrolled,
    } = await getGuardStatus({ boardId, columnId });
    setGuardConn({
      activated, primaryAuthorized, meAuthorized, enrolled,
    });
  }, [boardId, columnId]);

  // Read on open, and again when the tab regains focus — that is when the owner
  // returns from the OAuth consent tab, so "מחובר ✓" appears without a reload.
  useEffect(() => {
    void refreshGuardStatus();
    const onFocus = () => { void refreshGuardStatus(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshGuardStatus]);

  // round325 — one-time guard authorization (OAuth) for the signed-in owner.
  // Opens the guard's /oauth/start in a new tab; that page reports its own
  // success, so we only surface the pop-up-blocked case here. Never throws.
  const handleAuthorizeGuard = async () => {
    const status = await startGuardAuthorization();
    if (status === 'blocked') {
      mondayService.showNotice('הדפדפן חסם את חלון החיבור — אשרו חלונות קופצים ונסו שוב.', 'error');
    } else if (status === 'failed') {
      mondayService.showNotice('לא ניתן היה לפתוח את החיבור. נסו שוב.', 'error');
    }
  };

  /*
   * round330 — one reading of an enrollment outcome, shared by the save path and
   * the manual register button. null = nothing to report; every other status is a
   * DIFFERENT instruction (authorize / ask a board owner / retry), which is why
   * they are separate statuses at all.
   */
  const enrollmentProblem = (status) => {
    if (status === 'not_activated') return 'השומר אינו מחובר לחשבון — נדרש אישור חד-פעמי של הבעלים.';
    if (status === 'not_board_owner') return 'רק בעלי הלוח יכולים לרשום את השומר על הלוח.';
    if (status === 'failed') return 'רישום השומר על העמודה נכשל — נסו שוב.';
    return null; // 'enrolled' | 'disabled' (dev harness)
  };

  /*
   * round330 — register the webhook without re-saving the form. Two reasons this
   * button exists: a column saved before the enrollment bug was fixed carries no
   * webhook and nothing but a save would have registered it, and an owner who
   * sees "אינה רשומה" needs a way to act on it from where they read it.
   * The server endpoint is idempotent, and the button is hidden once the column
   * IS registered, so it cannot stack a second webhook on the same column.
   */
  const handleEnrollNow = async () => {
    setEnrolling(true);
    try {
      // Total by contract (a status for every outcome, never a throw) — see guardEnroll.
      const problem = enrollmentProblem(await enrollColumnGuard({ boardId, columnId }));
      if (problem) mondayService.showNotice(problem, 'error');
      else mondayService.showNotice('העמודה נרשמה אצל השומר.');
      await refreshGuardStatus();
    } finally {
      setEnrolling(false);
    }
  };

  // round327 — reverts are written AS the primary owner, so the consent flow is
  // THEIRS alone: only the primary owner sees the connection line, and only their
  // switch-flip auto-opens the OAuth tab (another owner authorizing would not
  // enable this column's reverts — it would only mislead).
  const isPrimaryOwner = draftOwners?.primaryOwnerId != null
    && currentUserId != null
    && String(draftOwners.primaryOwnerId) === String(currentUserId);

  // round326 — one switch protects the column: it flips autoRevert (persisted on
  // Save, which also enrolls the webhook) AND, when the PRIMARY owner turns it on
  // with no authorization yet, opens the one-time owner consent immediately.
  // Turning OFF only stops reverts; it does not revoke the authorization.
  const handleGuardToggle = (event) => {
    const on = event.target.checked;
    setDraft((current) => ({ ...current, autoRevert: on }));
    if (on && isPrimaryOwner && guardConnected !== true) {
      void handleAuthorizeGuard();
    }
  };

  if (settingsLoading || metaLoading || !draft || !labelsDraft) {
    return <LoadingState message="טוען הגדרות…" />;
  }
  if (settingsError) {
    return <ErrorState message={SETTINGS_LOAD_ERROR_MESSAGE} onRetry={reloadSettings} />;
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

  const transitionTargetsFor = (source) => labelsDraft
    .filter((other) => other.clientKey !== source.clientKey)
    .filter((other) => !other.isDefaultEmpty || other.label.trim() !== '' || liveHasDefaultLabel)
    .map((other) => ({
      id: String(other.id),
      label: other.label.trim() || 'ברירת מחדל',
      color: other.color,
    }));

  const coloredCount = labelsDraft.filter((label) => !label.isDefaultEmpty).length;

  // round330 — three states, not two: 'unknown' is what the guard not answering
  // looks like, and it is not the same news as "not registered".
  const enrolledState = guardConn.enrolled === true
    ? 'ok'
    : (guardConn.enrolled === false ? 'need' : 'unknown');

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
        <div className="twyst-settings-heading">
          <Heading type="h4">הגדרות</Heading>
          <span className="twyst-settings-subtitle">
            לייבלים, הרשאות ומעברים של עמודת הסטטוס
          </span>
        </div>
        {/* A second Save, pinned to the top — the settings screen is long, and the
            footer Save scrolls out of reach. Same handler and saving state as the
            footer button, so the two are interchangeable. */}
        <div className="twyst-settings-header-actions">
          {/* Distinct accessible name (still contains the visible "שמור" — WCAG 2.5.3)
              so it is unambiguous alongside the footer Save for AT and tests alike. */}
          <Button
            kind="primary"
            size="small"
            ariaLabel="שמור בראש הטופס"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'שומר…' : 'שמור'}
          </Button>
        </div>
      </header>

      <div className="twyst-settings-body">
        {!metadata.teamsAvailable && (
          <AttentionBox type="warning" text={TEAMS_SCOPE_HINT} />
        )}

        <section className="twyst-owners" aria-label="בעלי העמודה">
          <div className="twyst-settings-toolbar-title">
            <span className="twyst-settings-section-title">בעלי העמודה</span>
            <span className="twyst-settings-count">{draftOwners?.ownerIds.length ?? 0}</span>
          </div>
          <p className="twyst-owners-note">
            רק בעלי העמודה רואים ומנהלים את ההגדרות. הבעל הראשי הוא מי שעל שמו יירשם
            ביטול אוטומטי של שינוי שאינו עומד בהגדרות.
          </p>
          <div className="twyst-field twyst-field-actors">
            <span className="twyst-field-label">הוספת בעלים</span>
            <PersonPicker
              selected={(draftOwners?.ownerIds ?? []).map((id) => ({ kind: 'person', id }))}
              users={metadata.users}
              teams={[]}
              bordered
              onChange={(actors) => {
                const nextIds = new Set(
                  (actors || []).filter((actor) => actor.kind !== 'team').map((actor) => String(actor.id)),
                );
                const currentIds = draftOwners?.ownerIds ?? [];
                nextIds.forEach((id) => { if (!currentIds.includes(id)) addOwnerId(id); });
                currentIds.forEach((id) => { if (!nextIds.has(id)) removeOwnerId(id); });
              }}
            />
          </div>
          <ul className="twyst-owners-list" aria-label="רשימת בעלי העמודה">
            {(draftOwners?.ownerIds ?? []).map((ownerId) => {
              const owner = metadata.users.find((user) => String(user.id) === ownerId);
              const isPrimary = draftOwners?.primaryOwnerId === ownerId;
              const isLast = (draftOwners?.ownerIds.length ?? 0) <= 1;
              return (
                <li key={ownerId} className="twyst-owner-row">
                  <span className="twyst-owner-name">{owner?.name ?? `משתמש ${ownerId}`}</span>
                  <label className="twyst-owner-primary">
                    <input
                      type="radio"
                      name="twyst-primary-owner"
                      checked={isPrimary}
                      disabled={saving}
                      onChange={() => makePrimaryOwner(ownerId)}
                      aria-label={`הגדר כבעלים ראשי: ${owner?.name ?? ownerId}`}
                    />
                    בעלים ראשי
                  </label>
                  <button
                    type="button"
                    className="twyst-owner-remove"
                    disabled={saving || isLast}
                    onClick={() => removeOwnerId(ownerId)}
                    aria-label={`הסרת בעלים: ${owner?.name ?? ownerId}`}
                    title={isLast ? 'חייב להישאר לפחות בעלים אחד' : 'הסרת בעלים'}
                  >
                    הסרה
                  </button>
                </li>
              );
            })}
          </ul>

          <label className="twyst-autorevert">
            <input
              type="checkbox"
              checked={draft?.autoRevert === true}
              disabled={saving}
              onChange={handleGuardToggle}
            />
            <span className="twyst-autorevert-text">
              <b>שמירה אוטומטית על העמודה</b>
              <span>כשדלוק, שינוי שעוקף את ההגדרות (מהנייד או בטעינת הלוח) יוחזר תוך שניות על שם הבעלים הראשי, והמשתמש יקבל הודעה. כשכבוי — העקיפות רק נספרות בניטור שלמטה.</span>
            </span>
          </label>

          {draft?.autoRevert === true && isPrimaryOwner && (
            <div className={`twyst-guard-conn twyst-guard-conn--${guardConnected === true ? 'ok' : 'need'}`}>
              {guardConnected === true ? (
                <span>
                  ✓ הגרד מחובר — ההחזרות ייכתבו על שמך.{' '}
                  <button type="button" className="twyst-linkish" disabled={saving} onClick={handleAuthorizeGuard}>
                    חיבור מחדש
                  </button>
                </span>
              ) : (
                <span>
                  דרוש אישור חד-פעמי כדי שההחזרות ייכתבו על שמך.{' '}
                  <button type="button" className="twyst-linkish" disabled={saving} onClick={handleAuthorizeGuard}>
                    {guardConnected === false ? 'אישור עכשיו' : 'חיבור'}
                  </button>
                </span>
              )}
            </div>
          )}

          {/* round330 — does this column actually carry its webhook? Shown to every
              owner who opens the settings, and NOT gated on the auto-revert switch:
              without the webhook the guard hears nothing at all, so a bypass is not
              even counted in the monitor below. The register button is the repair —
              hidden once registered, so it cannot add a second webhook. */}
          <div className={`twyst-guard-hook twyst-guard-hook--${enrolledState}`}>
            {enrolledState === 'ok' && (
              <span>✓ העמודה רשומה אצל השומר — שינויי סטטוס מדווחים אליו בזמן אמת.</span>
            )}
            {enrolledState !== 'ok' && (
              <span>
                {enrolledState === 'need'
                  ? 'העמודה אינה רשומה אצל השומר — עקיפות לא יזוהו ולא יירשמו. '
                  : 'מצב הרישום אצל השומר לא ידוע — השומר לא ענה. '}
                <button
                  type="button"
                  className="twyst-linkish"
                  disabled={saving || enrolling}
                  aria-busy={enrolling}
                  onClick={handleEnrollNow}
                >
                  רישום השומר על העמודה
                </button>
              </span>
            )}
          </div>
        </section>

        <BypassMonitor
          boardId={boardId}
          columnId={columnId}
          labelsById={labelsById}
          columnsById={columnsById}
          usersById={usersById}
        />

        <div className="twyst-settings-toolbar">
          <div className="twyst-settings-toolbar-title">
            <span className="twyst-settings-section-title">לייבלים</span>
            <span className="twyst-settings-count">{coloredCount}</span>
          </div>
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
              transitionTargets={transitionTargetsFor(label)}
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionBox, Button, Heading } from '@vibe/core';
import { validateSettings } from '../../domain/settingsSchema';
import { isSupportedFormColumnType } from '../../domain/columnValueFormats';
import { resolveStatusColorHex } from '../../domain/statusColors';
import {
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createBlankLabelDraft,
  createLabelsDraft,
  hasPendingLabelEdits,
  pruneSettingsForActiveLabels,
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

function ruleHasConfig(rule, hidden) {
  return Boolean(
    hidden
    || (rule.allowedUserIds?.length ?? 0)
    || (rule.allowedTeamIds?.length ?? 0)
    || (rule.requiredColumnIds?.length ?? 0)
    || (rule.requiredPeopleColumnIds?.length ?? 0),
  );
}

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
  showPermissions,
  isFirst,
  isLast,
  onRename,
  onRecolor,
  onRemove,
  onMove,
  onToggleHidden,
  onChangeRule,
}) {
  const [open, setOpen] = useState(() => ruleHasConfig(rule, hidden));
  const selectedPeople = (rule.allowedUserIds ?? []).map((id) => {
    const match = users.find((user) => String(user.id) === String(id));
    return match
      ? { id: String(match.id), name: match.name }
      : { id: String(id), name: String(id) };
  });
  const gatePeopleColumnId = rule.requiredPeopleColumnIds?.[0] ?? '';
  const gatePeopleTitle = peopleColumns.find((column) => column.id === gatePeopleColumnId)?.title;
  const summaryBits = [];
  if (hidden) summaryBits.push('מוסתר');
  if (rule.allowedUserIds?.length) summaryBits.push(`${rule.allowedUserIds.length} משתמשים`);
  if (rule.allowedTeamIds?.length) summaryBits.push(`${rule.allowedTeamIds.length} צוותים`);
  if (gatePeopleTitle) summaryBits.push(gatePeopleTitle);
  if (rule.requiredColumnIds?.length) summaryBits.push(`${rule.requiredColumnIds.length} שדות חובה`);

  return (
    <article className={`twyst-label-card${open ? ' is-open' : ''}`}>
      <div className="twyst-label-identity">
        <StatusColorPicker
          colorValue={label.colorValue}
          usedColorEnums={usedColors}
          disabled={saving}
          onChange={(next) => onRecolor(label.clientKey, next)}
        />
        <input
          className="twyst-label-name-input"
          type="text"
          value={label.label}
          aria-label="שם הלייבל"
          disabled={saving}
          onChange={(event) => onRename(label.clientKey, event.target.value)}
        />
        <div className="twyst-label-actions">
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
        </div>
      </div>

      {showPermissions && (
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
              className="twyst-text-btn"
              aria-expanded={open}
              disabled={saving}
              onClick={() => setOpen((current) => !current)}
            >
              {open ? 'הסתר הרשאות' : 'הרשאות'}
              {!open && summaryBits.length > 0 ? ` · ${summaryBits.join(' · ')}` : ''}
            </button>
          </div>

          {open && (
            <div className="twyst-permissions">
              <div className="twyst-field twyst-field-users">
                <span className="twyst-field-label">משתמשים מורשים</span>
                <PersonPicker
                  selected={selectedPeople}
                  users={users}
                  bordered
                  onChange={(people) => onChangeRule(label.id, {
                    allowedUserIds: (people || []).map((person) => String(person.id)),
                  })}
                />
              </div>

              <div className="twyst-field twyst-field-teams">
                <span className="twyst-field-label">צוותים מורשים</span>
                <OptionChecklist
                  options={teams.map((team) => ({ id: team.id, label: team.name }))}
                  values={rule.allowedTeamIds}
                  disabled={!teamsAvailable || saving}
                  emptyText={teamsAvailable ? 'אין צוותים בחשבון' : 'חסר סקופ teams:read'}
                  onChange={(next) => onChangeRule(label.id, { allowedTeamIds: next })}
                />
              </div>

              <div className="twyst-field twyst-field-people-gate">
                <label className="twyst-field-label" htmlFor={`people-gate-${label.clientKey}`}>
                  חייב להופיע בעמודת אנשים
                </label>
                <select
                  id={`people-gate-${label.clientKey}`}
                  className="twyst-select"
                  value={gatePeopleColumnId}
                  disabled={saving || peopleColumns.length === 0}
                  onChange={(event) => onChangeRule(label.id, {
                    requiredPeopleColumnIds: event.target.value ? [event.target.value] : [],
                  })}
                >
                  <option value="">ללא הגבלה</option>
                  {peopleColumns.map((column) => (
                    <option key={column.id} value={column.id}>{column.title}</option>
                  ))}
                </select>
              </div>

              <div className="twyst-field twyst-field-required">
                <span className="twyst-field-label">שדות חובה במעבר</span>
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
              </div>
            </div>
          )}
        </div>
      )}
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
    const draftLabels = createLabelsDraft(all);
    setLabelsDraft(draftLabels);
    setLabelsBaseline(draftLabels);
  }, [statusColumn]);

  const formColumns = useMemo(
    () => (metadata?.columns ?? []).filter((column) => column.id !== columnId),
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

  const addLabel = () => {
    setLabelsDraft((current) => [...current, createBlankLabelDraft(current)]);
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

      if (!labelsDraft || labelsDraft.length === 0) {
        setSaveError('חייבים להשאיר לפחות לייבל פעיל אחד.');
        return;
      }
      if (labelsDraft.some((label) => !String(label.label || '').trim())) {
        setSaveError('לכל לייבל חייב להיות שם.');
        return;
      }

      let activeLabelIds = labelsDraft
        .filter((label) => !label.isNew)
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
        const payload = buildStatusLabelsUpdatePayload(labelsDraft, liveFresh);
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
          <Button kind="secondary" size="small" disabled={saving} onClick={addLabel}>
            הוספת לייבל
          </Button>
        </div>

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
              saving={saving}
              showPermissions={!label.isNew}
              isFirst={labelIndex === 0}
              isLast={labelIndex === labelsDraft.length - 1}
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

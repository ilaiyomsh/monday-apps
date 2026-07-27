import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionBox, Button, Heading, Text } from '@vibe/core';
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

function multiValues(event) {
  return [...event.target.selectedOptions].map((option) => option.value);
}

function LabelCard({
  label,
  hidden,
  rule,
  users,
  teams,
  teamsAvailable,
  columns,
  usedColors,
  saving,
  showPermissions,
  onRename,
  onRecolor,
  onRemove,
  onToggleHidden,
  onChangeRule,
}) {
  const selectedPeople = (rule.allowedUserIds ?? []).map((id) => {
    const match = users.find((user) => String(user.id) === String(id));
    return match
      ? { id: String(match.id), name: match.name }
      : { id: String(id), name: String(id) };
  });

  return (
    <article className="twyst-label-card">
      <div className="twyst-label-row">
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
        <Button
          kind="tertiary"
          size="small"
          disabled={saving}
          onClick={() => onRemove(label.clientKey)}
        >
          הסרה
        </Button>
      </div>

      {showPermissions && (
        <>
          <label className="twyst-check">
            <input
              type="checkbox"
              checked={hidden}
              disabled={saving}
              onChange={() => onToggleHidden(label.id)}
            />
            <Text type="text2">מוסתר בבורר</Text>
          </label>

          <div className="twyst-field">
            <Text type="text2">משתמשים</Text>
            <PersonPicker
              selected={selectedPeople}
              users={users}
              bordered
              onChange={(people) => onChangeRule(label.id, {
                allowedUserIds: (people || []).map((person) => String(person.id)),
              })}
            />
          </div>

          <div className="twyst-field">
            <Text type="text2">צוותים</Text>
            <select
              className="twyst-multi"
              multiple
              value={rule.allowedTeamIds}
              disabled={!teamsAvailable || saving}
              onChange={(event) => onChangeRule(label.id, { allowedTeamIds: multiValues(event) })}
            >
              {teams.map((team) => (
                <option key={team.id} value={String(team.id)}>{team.name}</option>
              ))}
            </select>
          </div>

          <div className="twyst-field">
            <Text type="text2">שדות חובה</Text>
            <select
              className="twyst-multi"
              multiple
              value={rule.requiredColumnIds}
              disabled={saving}
              onChange={(event) => onChangeRule(label.id, { requiredColumnIds: multiValues(event) })}
            >
              {columns.map((column) => (
                <option
                  key={column.id}
                  value={column.id}
                  disabled={!isSupportedFormColumnType(column.type)}
                >
                  {column.title}
                </option>
              ))}
            </select>
          </div>
        </>
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

  const getRule = (labelId) => draft?.labels?.[labelId] ?? {
    allowedUserIds: [],
    allowedTeamIds: [],
    requiredColumnIds: [],
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

        {labelsDraft.map((label) => {
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
              usedColors={usedColors}
              saving={saving}
              showPermissions={!label.isNew}
              onRename={renameLabel}
              onRecolor={recolorLabel}
              onRemove={removeLabel}
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

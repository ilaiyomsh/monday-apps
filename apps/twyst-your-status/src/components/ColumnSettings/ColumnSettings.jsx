import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionBox } from '@vibe/core';
import { migrateSettings, validateSettings } from '../../domain/settingsSchema';
import { isSupportedFormColumnType } from '../../domain/columnValueFormats';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import { GET_BOARD_SETTINGS_METADATA } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import { loadAccountTeams } from '../../services/teamsAccess';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { VERSION_LABEL } from '../../utils/versionLabel';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import './ColumnSettings.css';

const TEAMS_SCOPE_HINT =
  'חסר הסקופ teams:read בגרסת האפליקציה — בחירת צוותים לא זמינה. הוסיפו teams:read בהרשאות הגרסה והתקינו מחדש / אשרו הרשאות.';

function multiValues(event) {
  return [...event.target.selectedOptions].map((option) => option.value);
}

function LabelRuleCard({
  label,
  hidden,
  rule,
  users,
  teams,
  teamsAvailable,
  columns,
  onToggleHidden,
  onChangeRule,
}) {
  return (
    <article className="twyst-label-card">
      <header className="twyst-label-card-header">
        <span className="twyst-label-dot" style={{ '--status-color': label.color }} />
        <h3>{label.label || 'ללא שם'}</h3>
      </header>

      <label className="twyst-check">
        <input type="checkbox" checked={hidden} onChange={() => onToggleHidden(label.id)} />
        מוסתר בבורר (אוטומציה עדיין יכולה לקבוע)
      </label>

      <div className="twyst-grid two">
        <label>
          משתמשים מורשים
          <select
            multiple
            value={rule.allowedUserIds}
            onChange={(event) => onChangeRule(label.id, { allowedUserIds: multiValues(event) })}
          >
            {users.map((user) => (
              <option key={user.id} value={String(user.id)}>{user.name}</option>
            ))}
          </select>
        </label>
        <label>
          צוותים מורשים
          <select
            multiple
            value={rule.allowedTeamIds}
            disabled={!teamsAvailable}
            onChange={(event) => onChangeRule(label.id, { allowedTeamIds: multiValues(event) })}
          >
            {teams.map((team) => (
              <option key={team.id} value={String(team.id)}>{team.name}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="twyst-hint">ריק = כולם מורשים. משתמש מורשה אם הוא ברשימה או חבר בצוות מורשה.</p>

      <label>
        שדות חובה לפני מעבר ללייבל
        <select
          multiple
          value={rule.requiredColumnIds}
          onChange={(event) => onChangeRule(label.id, { requiredColumnIds: multiValues(event) })}
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.title}
              {!isSupportedFormColumnType(column.type) ? ' (לא נתמך בטופס)' : ''}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

function ColumnSettings({ context }) {
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
  const labels = useMemo(
    () => normalizeStatusLabels(statusColumn?.settings).filter((label) => !label.isDeactivated),
    [statusColumn],
  );
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

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      const next = migrateSettings(draft);
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
        setSaveError('חלק משדות החובה אינם נתמכים בטופס המעבר. בחרו עמודות טקסט/מספר/תאריך/אימייל/טלפון/קישור/דרופדאון.');
        return;
      }
      await mondayService.setColumnConfig(boardId, columnId, next);
      mondayService.showNotice('ההגדרות נשמרו');
      mondayService.closeDialog();
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to save column settings', err);
      setSaveError('שמירת ההגדרות נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  if (settingsLoading || metaLoading || !draft) {
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
    <main className="twyst-settings" dir="rtl">
      <header>
        <p className="twyst-eyebrow">Twyst Your Status</p>
        <h1>הגדרות לייבלים</h1>
        <p>לכל לייבל יעד: מי מורשה לבחור אותו, ואילו שדות חובה למלא לפני המעבר.</p>
      </header>

      {!metadata.teamsAvailable && (
        <AttentionBox type="warning" text={TEAMS_SCOPE_HINT} />
      )}

      {labels.map((label) => (
        <LabelRuleCard
          key={label.id}
          label={label}
          hidden={hiddenSet.has(label.id)}
          rule={getRule(label.id)}
          users={metadata.users}
          teams={metadata.teams}
          teamsAvailable={metadata.teamsAvailable}
          columns={formColumns}
          onToggleHidden={toggleHidden}
          onChangeRule={changeRule}
        />
      ))}

      {saveError && (
        <AttentionBox type="danger" text={saveError} />
      )}

      <div className="twyst-actions">
        <button type="button" className="primary-action" disabled={saving} onClick={handleSave}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
        <button type="button" disabled={saving} onClick={() => mondayService.closeDialog()}>
          ביטול
        </button>
      </div>
      <div className="twyst-version" dir="ltr">{VERSION_LABEL}</div>
    </main>
  );
}

export default ColumnSettings;

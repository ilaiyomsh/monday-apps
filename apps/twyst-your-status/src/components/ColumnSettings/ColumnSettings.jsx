import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionBox } from '@vibe/core';
import { migrateSettings, validateSettings } from '../../domain/settingsSchema';
import { isSupportedFormColumnType } from '../../domain/columnValueFormats';
import { MONDAY_STATUS_COLORS, resolveStatusColorHex } from '../../domain/statusColors';
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
import './ColumnSettings.css';

const TEAMS_SCOPE_HINT =
  'חסר הסקופ teams:read בגרסת האפליקציה — בחירת צוותים לא זמינה. הוסיפו teams:read בהרשאות הגרסה והתקינו מחדש / אשרו הרשאות.';

function multiValues(event) {
  return [...event.target.selectedOptions].map((option) => option.value);
}

function LabelEditorRow({
  label,
  onRename,
  onRecolor,
  onRemove,
}) {
  return (
    <div className="twyst-label-editor-row">
      <span className="twyst-label-dot" style={{ '--status-color': label.color }} />
      <input
        className="twyst-label-name-input"
        type="text"
        value={label.label}
        aria-label="שם הלייבל"
        onChange={(event) => onRename(label.clientKey, event.target.value)}
      />
      <select
        className="twyst-label-color-select"
        value={String(label.colorValue)}
        aria-label="צבע הלייבל"
        onChange={(event) => onRecolor(label.clientKey, event.target.value)}
      >
        {MONDAY_STATUS_COLORS.map((choice) => (
          <option key={choice.enum} value={choice.enum}>
            {choice.enum}
          </option>
        ))}
      </select>
      <span
        className="twyst-label-color-preview"
        style={{ background: resolveStatusColorHex(label.colorValue) || label.color }}
        aria-hidden="true"
      />
      <button type="button" className="twyst-label-remove" onClick={() => onRemove(label.clientKey)}>
        הסרה
      </button>
    </div>
  );
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

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      if (!labelsDraft || labelsDraft.length === 0) {
        setSaveError('חייבים להשאיר לפחות לייבל פעיל אחד בעמודת הסטטוס.');
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
        setSaveError('חלק משדות החובה אינם נתמכים בטופס המעבר. בחרו עמודות טקסט/מספר/תאריך/אימייל/טלפון/קישור/דרופדאון.');
        return;
      }
      await mondayService.setColumnConfig(boardId, columnId, next);
      mondayService.showNotice('ההגדרות נשמרו');
      mondayService.closeDialog();
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to save column settings', err);
      const message = err?.message || '';
      if (/in use|can't delete|cannot delete|default/i.test(message)) {
        setSaveError('לא ניתן להסיר לייבל שנמצא בשימוש בפריטים או שהוא ברירת המחדל של העמודה.');
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
  // Permission cards only for existing (non-new) labels that still have stable ids.
  const ruleLabels = labelsDraft.filter((label) => !label.isNew);

  return (
    <main className="twyst-settings" dir="rtl">
      <header>
        <p className="twyst-eyebrow">Twyst Your Status</p>
        <h1>הגדרות לייבלים</h1>
        <p>
          ערכו את לייבלי הסטטוס בלוח (שם, צבע, הוספה והסרה), ולכל לייבל יעד הגדירו מי מורשה
          לבחור אותו ואילו שדות חובה למלא לפני המעבר. בלי הגדרות שמורות — כל הסטטוסים מותרים.
        </p>
      </header>

      {!metadata.teamsAvailable && (
        <AttentionBox type="warning" text={TEAMS_SCOPE_HINT} />
      )}

      <section className="twyst-label-editor" aria-labelledby="label-editor-title">
        <div className="twyst-label-editor-header">
          <h2 id="label-editor-title">לייבלים בעמודה</h2>
          <button type="button" onClick={addLabel} disabled={saving}>הוספת לייבל</button>
        </div>
        <p className="twyst-hint">
          הסרה מבטלת את הלייבל בעמודת הסטטוס (לא ניתן להסיר לייבל שבשימוש בפריטים).
          הרשאות ללייבל חדש יופיעו אחרי שמירה.
        </p>
        {labelsDraft.map((label) => (
          <LabelEditorRow
            key={label.clientKey}
            label={label}
            onRename={renameLabel}
            onRecolor={recolorLabel}
            onRemove={removeLabel}
          />
        ))}
      </section>

      {ruleLabels.map((label) => (
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

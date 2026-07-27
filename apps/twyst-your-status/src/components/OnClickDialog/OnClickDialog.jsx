import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  STATUS_GUARD_CONFIG_VERSION,
  buildStatusPickerModel,
  normalizeStatusGuardConfig,
  normalizeStatusLabels,
  serializeStatusMutationValue,
} from '../../domain/statusPolicy';
import {
  GET_STATUS_COLUMN_CONTEXT,
  UPDATE_STATUS_COLUMN_VALUE,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import workflowClient from '../../services/workflowClient';
import logger from '../../utils/logger';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import GuardSettingsPanel from '../GuardSettingsPanel/GuardSettingsPanel';
import './OnClickDialog.css';

const EMPTY_CONFIG = normalizeStatusGuardConfig(null);

function OnClickDialog({ context }) {
  const { boardId, columnId, itemId, user } = context;
  const [labels, setLabels] = useState([]);
  const [currentValue, setCurrentValue] = useState(null);
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [draftRestrictedIds, setDraftRestrictedIds] = useState([]);
  const [screen, setScreen] = useState('picker');
  const [loading, setLoading] = useState(true);
  const [savingLabelId, setSavingLabelId] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState(null);
  const [workflowConfig, setWorkflowConfig] = useState(null);
  const [connected, setConnected] = useState(false);

  const loadDialogData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [data, workflow] = await Promise.all([
        mondayService.query(GET_STATUS_COLUMN_CONTEXT, {
          boardIds: [boardId],
          itemIds: [itemId],
          columnIds: [columnId],
        }),
        workflowClient.getItemWorkflow(boardId, itemId),
      ]);

      const column = data?.boards?.[0]?.columns?.[0];
      if (!column || column.type !== 'status') {
        throw new Error('העמודה שנפתחה אינה עמודת Status פעילה');
      }

      const item = data?.items?.[0];
      const statusValue = item?.column_values?.find((value) => value.id === columnId) ?? null;
      const nextLabels = normalizeStatusLabels(column.settings);
      const nextConfig = normalizeStatusGuardConfig({
        version: STATUS_GUARD_CONFIG_VERSION,
        restrictedLabelIds: workflow.config?.targetColumnId === String(columnId)
          ? workflow.config.hiddenManualLabelIds
          : [],
      });

      setLabels(nextLabels);
      setCurrentValue(statusValue);
      setConfig(nextConfig);
      setDraftRestrictedIds(nextConfig.restrictedLabelIds);
      setWorkflowConfig(workflow.config);
      setConnected(workflow.connected);
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to load status picker data', err);
      setError(err.message || 'לא הצלחנו לטעון את הסטטוסים');
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId, itemId]);

  useEffect(() => {
    loadDialogData();
  }, [loadDialogData]);

  const pickerModel = useMemo(
    () => buildStatusPickerModel({ labels, currentValue, config }),
    [config, currentValue, labels],
  );

  const handleSelectLabel = async (labelId) => {
    const selectedLabel = pickerModel.options.find((label) => label.id === labelId);
    if (!selectedLabel || user?.isViewOnly) return;

    try {
      setSavingLabelId(labelId);
      setError(null);
      await mondayService.query(UPDATE_STATUS_COLUMN_VALUE, {
        boardId,
        itemId,
        columnId,
        value: serializeStatusMutationValue(labelId),
      });
      await mondayService.showNotice(`הסטטוס עודכן ל״${selectedLabel.label}״`);
      await mondayService.closeDialog();
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to update status value', err);
      setError(err.message || 'לא הצלחנו לעדכן את הסטטוס');
    } finally {
      setSavingLabelId(null);
    }
  };

  const handleOpenSettings = () => {
    setDraftRestrictedIds(config.restrictedLabelIds);
    setScreen('settings');
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      setError(null);
      const nextConfig = normalizeStatusGuardConfig({
        version: STATUS_GUARD_CONFIG_VERSION,
        restrictedLabelIds: draftRestrictedIds,
      });
      if (!connected) throw new Error('יש לחבר תחילה את החשבון דרך ה־Board View של האפליקציה.');
      await workflowClient.saveBoardConfig(boardId, {
        ...(workflowConfig ?? {
          schemaVersion: 1,
          targetColumnId: String(columnId),
          transitions: [],
          enforcement: { enabled: false },
        }),
        targetColumnId: String(columnId),
        hiddenManualLabelIds: nextConfig.restrictedLabelIds,
      });
      setWorkflowConfig((current) => ({
        ...(current ?? { schemaVersion: 1, transitions: [], enforcement: { enabled: false } }),
        targetColumnId: String(columnId),
        hiddenManualLabelIds: nextConfig.restrictedLabelIds,
      }));
      setConfig(nextConfig);
      setScreen('picker');
      await mondayService.showNotice('הגדרת הלייבלים המוגנים נשמרה');
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to save status guard settings', err);
      setError(err.message || 'לא הצלחנו לשמור את ההגדרה');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) return <LoadingState message="טוען את הסטטוסים…" />;
  if (error) return <ErrorState message={error} onRetry={loadDialogData} />;

  if (screen === 'settings') {
    return (
      <GuardSettingsPanel
        labels={labels}
        restrictedLabelIds={draftRestrictedIds}
        onRestrictedLabelIdsChange={setDraftRestrictedIds}
        onSave={handleSaveSettings}
        onCancel={() => setScreen('picker')}
        saving={savingSettings}
      />
    );
  }

  return (
    <main className="status-guard-dialog" aria-labelledby="status-picker-title">
      <header className="status-guard-header">
        <div>
          <p className="status-guard-eyebrow">Twyst Your Status</p>
          <h1 id="status-picker-title">בחירת סטטוס</h1>
        </div>
        {user?.isAdmin && (
          <button className="settings-button" type="button" onClick={handleOpenSettings}>
            הגדרות
          </button>
        )}
      </header>

      <section className="current-status" aria-label="הסטטוס הנוכחי">
        <span className="section-label">הסטטוס הנוכחי</span>
        {pickerModel.currentLabel ? (
          <div className="current-status-row">
            <span
              className="status-chip"
              style={{ '--status-color': pickerModel.currentLabel.color }}
            >
              {pickerModel.currentLabel.label}
            </span>
            {pickerModel.currentIsRestricted && (
              <span className="automation-only-badge">לצפייה בלבד</span>
            )}
          </div>
        ) : (
          <span className="empty-current-status">לא נבחר סטטוס</span>
        )}
        {pickerModel.currentIsRestricted && (
          <p className="restricted-explanation">
            הסטטוס הזה נקבע מחוץ לבורר — למשל על ידי אוטומציה — ולכן הוא מוצג אך אינו זמין לבחירה ידנית.
          </p>
        )}
      </section>

      <section aria-labelledby="available-statuses-title">
        <h2 id="available-statuses-title">אפשרויות זמינות</h2>
        {pickerModel.options.length > 0 ? (
          <div className="status-options" role="listbox" aria-label="סטטוסים זמינים">
            {pickerModel.options.map((label) => {
              const isSelected = label.id === pickerModel.currentLabelId;
              const isSaving = label.id === savingLabelId;
              return (
                <button
                  key={label.id}
                  className={`status-option${isSelected ? ' is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={savingLabelId !== null || user?.isViewOnly}
                  onClick={() => handleSelectLabel(label.id)}
                >
                  <span className="status-option-name">
                    <span className="status-dot" style={{ '--status-color': label.color }} />
                    {label.label || 'ללא שם'}
                  </span>
                  <span className="status-option-state">
                    {isSaving ? 'שומר…' : isSelected ? 'נבחר' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-options">אין כרגע סטטוסים זמינים לבחירה ידנית.</p>
        )}
      </section>

      {user?.isViewOnly && (
        <p className="view-only-note">יש לך הרשאת צפייה בלבד ולכן לא ניתן לשנות את הסטטוס.</p>
      )}
    </main>
  );
}

export default OnClickDialog;

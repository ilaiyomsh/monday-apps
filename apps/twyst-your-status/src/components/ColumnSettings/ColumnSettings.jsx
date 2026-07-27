import React, { useCallback, useEffect, useState } from 'react';
import {
  normalizeStatusGuardConfig,
  normalizeStatusLabels,
} from '../../domain/statusPolicy';
import { GET_STATUS_COLUMN_SETTINGS } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import workflowClient from '../../services/workflowClient';
import logger from '../../utils/logger';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import GuardSettingsPanel from '../GuardSettingsPanel/GuardSettingsPanel';

function ColumnSettings({ context }) {
  const { boardId, columnId, user } = context;
  const [labels, setLabels] = useState([]);
  const [restrictedLabelIds, setRestrictedLabelIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [workflowConfig, setWorkflowConfig] = useState(null);
  const [connected, setConnected] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, stored] = await Promise.all([
        mondayService.query(GET_STATUS_COLUMN_SETTINGS, {
          boardIds: [boardId],
          columnIds: [columnId],
        }),
        workflowClient.getBoardConfig(boardId),
      ]);
      const column = data?.boards?.[0]?.columns?.[0];
      if (!column || column.type !== 'status') {
        throw new Error('העמודה שנפתחה אינה עמודת Status פעילה');
      }
      setLabels(normalizeStatusLabels(column.settings));
      setConnected(stored.connected);
      setWorkflowConfig(stored.config);
      setRestrictedLabelIds(
        stored.config?.targetColumnId === String(columnId)
          ? stored.config.hiddenManualLabelIds
          : [],
      );
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to load status guard settings', err);
      setError(err.message || 'לא הצלחנו לטעון את ההגדרה');
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      if (!connected) throw new Error('יש לחבר תחילה את החשבון דרך ה־Board View של האפליקציה.');
      const hidden = normalizeStatusGuardConfig({ version: 1, restrictedLabelIds });
      await workflowClient.saveBoardConfig(boardId, {
        ...(workflowConfig ?? {
          schemaVersion: 1,
          targetColumnId: String(columnId),
          transitions: [],
          enforcement: { enabled: false },
        }),
        targetColumnId: String(columnId),
        hiddenManualLabelIds: hidden.restrictedLabelIds,
      });
      await mondayService.showNotice('הגדרת הלייבלים המוגנים נשמרה');
      await mondayService.closeDialog();
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to save status guard settings', err);
      setError(err.message || 'לא הצלחנו לשמור את ההגדרה');
    } finally {
      setSaving(false);
    }
  };

  if (!user?.isAdmin) {
    return <ErrorState message="רק מנהלי החשבון יכולים להגדיר לייבלים מוגנים." />;
  }
  if (loading) return <LoadingState message="טוען את ההגדרה…" />;
  if (error) return <ErrorState message={error} onRetry={loadSettings} />;

  return (
    <GuardSettingsPanel
      labels={labels}
      restrictedLabelIds={restrictedLabelIds}
      onRestrictedLabelIdsChange={setRestrictedLabelIds}
      onSave={handleSave}
      onCancel={() => mondayService.closeDialog()}
      saving={saving}
    />
  );
}

export default ColumnSettings;

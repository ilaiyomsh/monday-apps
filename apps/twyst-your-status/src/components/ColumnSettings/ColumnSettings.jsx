import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  STATUS_GUARD_CONFIG_VERSION,
  makeStatusGuardStorageKey,
  normalizeStatusGuardConfig,
  normalizeStatusLabels,
} from '../../domain/statusPolicy';
import { GET_STATUS_COLUMN_SETTINGS } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
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
  const storageKey = useMemo(
    () => makeStatusGuardStorageKey(boardId, columnId),
    [boardId, columnId],
  );

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, storedConfig] = await Promise.all([
        mondayService.query(GET_STATUS_COLUMN_SETTINGS, {
          boardIds: [boardId],
          columnIds: [columnId],
        }),
        mondayService.getAppStorage(storageKey),
      ]);
      const column = data?.boards?.[0]?.columns?.[0];
      if (!column || column.type !== 'status') {
        throw new Error('העמודה שנפתחה אינה עמודת Status פעילה');
      }
      setLabels(normalizeStatusLabels(column.settings));
      setRestrictedLabelIds(normalizeStatusGuardConfig(storedConfig).restrictedLabelIds);
    } catch (err) {
      logger.error('ColumnSettings', 'Failed to load status guard settings', err);
      setError(err.message || 'לא הצלחנו לטעון את ההגדרה');
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId, storageKey]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const config = normalizeStatusGuardConfig({
        version: STATUS_GUARD_CONFIG_VERSION,
        restrictedLabelIds,
      });
      await mondayService.setAppStorage(storageKey, config);
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

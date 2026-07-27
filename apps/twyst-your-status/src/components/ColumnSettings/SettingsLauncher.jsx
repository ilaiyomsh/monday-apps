import React, { useState } from 'react';
import { AttentionBox } from '@vibe/core';
import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { VERSION_LABEL } from '../../utils/versionLabel';
import './SettingsLauncher.css';

const FULL_SETTINGS_PATH = '/settings-full';

/**
 * Tiny Column Settings Dialog shell — monday's native settings iframe is too
 * small for the full label editor. One button opens a nested full-size modal.
 */
function SettingsLauncher() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);

  const openFullSettings = async () => {
    try {
      setOpening(true);
      setError(null);
      await mondayService.openAppFeatureModal({
        urlPath: FULL_SETTINGS_PATH,
        width: '1100px',
        height: '820px',
        returnToPreviousModal: true,
      });
    } catch (err) {
      logger.error('SettingsLauncher', 'Failed to open full settings modal', err);
      setError('לא הצלחנו לפתוח את חלון ההגדרות המלא. נסו שוב.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="twyst-settings-launcher" dir="rtl">
      <header>
        <p className="twyst-eyebrow">Twyst Your Status</p>
        <h1>הגדרות העמודה</h1>
        <p>ניהול לייבלים, הרשאות ושדות חובה נפתח בחלון מלא לנוחות.</p>
      </header>

      {error && <AttentionBox type="danger" text={error} />}

      <button
        type="button"
        className="primary-action twyst-settings-launcher-cta"
        disabled={opening}
        onClick={openFullSettings}
      >
        {opening ? 'פותח…' : 'פתח הגדרות מלאות'}
      </button>

      <button
        type="button"
        className="twyst-settings-launcher-dismiss"
        disabled={opening}
        onClick={() => mondayService.closeDialog()}
      >
        סגור
      </button>

      <div className="twyst-version" dir="ltr">{VERSION_LABEL}</div>
    </main>
  );
}

export default SettingsLauncher;

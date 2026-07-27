import React, { useState } from 'react';
import { AttentionBox, Button } from '@vibe/core';
import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { settingsModalSize } from '../../utils/settingsModalSize';
import { VERSION_LABEL } from '../../utils/versionLabel';
import './SettingsLauncher.css';

const FULL_SETTINGS_PATH = '/settings-full';

/**
 * Slim Column Settings shell — opens a nested overlay sized to the viewport
 * (monday openAppFeatureModal only accepts px strings).
 */
function SettingsLauncher() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);

  const openFullSettings = async () => {
    try {
      setOpening(true);
      setError(null);
      const size = settingsModalSize(window);
      await mondayService.openAppFeatureModal({
        urlPath: FULL_SETTINGS_PATH,
        ...size,
        returnToPreviousModal: true,
      });
    } catch (err) {
      logger.error('SettingsLauncher', 'Failed to open full settings modal', err);
      setError('לא הצלחנו לפתוח את ההגדרות. נסו שוב.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="twyst-settings-launcher" dir="rtl">
      {error && <AttentionBox type="danger" text={error} />}

      <Button
        kind="primary"
        size="medium"
        disabled={opening}
        onClick={openFullSettings}
        className="twyst-settings-launcher-cta"
      >
        {opening ? 'פותח…' : 'הגדרות'}
      </Button>

      <div className="twyst-version" dir="ltr">{VERSION_LABEL}</div>
    </main>
  );
}

export default SettingsLauncher;

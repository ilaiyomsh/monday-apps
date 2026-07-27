import React, { useEffect, useState } from 'react';
import { AttentionBox } from '@vibe/core';
import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import { pickerModalSize } from '../../utils/settingsModalSize';
import LoadingState from '../shared/LoadingState';
import OnClickDialog from './OnClickDialog';
import './PickerLauncher.css';

const FULL_PICKER_PATH = '/picker-full';

/**
 * Column on-click / on-hover Dialog Design closes when the pointer leaves the
 * cell. Immediately hand off to a stable openAppFeatureModal so the status
 * list stays open while the user moves the mouse.
 */
function PickerLauncher({ context }) {
  const [error, setError] = useState(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let alive = true;

    const openStablePicker = async () => {
      try {
        setError(null);
        const size = pickerModalSize(window);
        // Resolves only after the modal is closed by the user / after save.
        await mondayService.openAppFeatureModal({
          urlPath: FULL_PICKER_PATH,
          ...size,
        });
        if (!alive) return;
        try {
          await mondayService.closeDialog();
        } catch (closeErr) {
          // Hover shells may already be gone; ignore close races.
          logger.warn('PickerLauncher', 'closeDialog after picker modal failed', closeErr);
        }
      } catch (err) {
        logger.error('PickerLauncher', 'Failed to open stable picker modal', err);
        if (!alive) return;
        setError('לא הצלחנו לפתוח את בוחר הסטטוסים. מציגים את הבורר כאן.');
        setFallback(true);
      }
    };

    openStablePicker();
    return () => {
      alive = false;
    };
  }, []);

  if (fallback) {
    return (
      <div className="twyst-picker-launcher-fallback">
        {error && <AttentionBox type="warning" text={error} />}
        <OnClickDialog context={context} variant="dialog" />
      </div>
    );
  }

  return (
    <main className="twyst-picker-launcher" dir="rtl" aria-busy="true">
      {error && <AttentionBox type="danger" text={error} />}
      <LoadingState message="פותח בוחר סטטוסים…" />
    </main>
  );
}

export default PickerLauncher;

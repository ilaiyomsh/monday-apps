import { useEffect, useState } from 'react';
import { AttentionBox, Button } from '@vibe/core';
import { loadIsBoardOwner } from '../../services/boardOwnerGate';
import mondayService from '../../services/mondayService';
import { loadSettingsAccess } from '../../services/settingsAccess';
import logger from '../../utils/logger';
import { settingsModalSize } from '../../utils/settingsModalSize';
import { VERSION_LABEL } from '../../utils/versionLabel';
import LoadingState from '../shared/LoadingState';
import './SettingsLauncher.css';

const FULL_SETTINGS_PATH = '/settings-full';

/**
 * What a non-owner sees instead of the button. Hebrew, RTL — an end user reads it,
 * and it names who CAN configure (the column's owners), not just that this actor
 * cannot. Owner decision (round322): everyone outside the owner list is not exposed
 * to the settings at all.
 */
export const NON_OWNER_MESSAGE = 'רק בעלי העמודה יכולים לנהל את ההגדרות';

/**
 * A gate that could not run is NOT a denial. It says so in the user's language and
 * still withholds the button: the check failing is not evidence of ownership either.
 */
export const GATE_ERROR_MESSAGE = 'לא הצלחנו לאמת את ההרשאות שלכם ללוח. נסו שוב.';

/**
 * Slim Column Settings shell — opens a nested overlay sized from the physical
 * screen (never this iframe's tiny window). monday only accepts px strings.
 *
 * The button is for the column's OWNERS (round322). An adopted column admits only
 * its listed owners; an unadopted one falls back to the board-owner gate so the
 * board's owners can perform (and, by saving, claim) the first setup — see
 * services/settingsAccess. While the check is in flight the shell keeps the SAME
 * loading state the Suspense fallback is already showing, so the two are one
 * continuous wait rather than a spinner replaced by another spinner.
 */
function SettingsLauncher({ context }) {
  const boardId = context?.boardId;
  const columnId = context?.columnId;
  const userId = context?.user?.id;

  // null while the ownership check is in flight — not "false until proven".
  const [isOwner, setIsOwner] = useState(null);
  const [gateError, setGateError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIsOwner(null);
    setGateError(null);

    loadSettingsAccess(
      { boardId, columnId, userId },
      { getColumnConfig: mondayService.getColumnConfig, loadIsBoardOwner },
    )
      .then((access) => {
        if (!cancelled) setIsOwner(access.canConfigure);
      })
      .catch((err) => {
        logger.error('SettingsLauncher', 'Failed to resolve settings access', err);
        if (cancelled) return;
        // Fails closed, and says why rather than posing as a permission denial.
        setIsOwner(false);
        setGateError(GATE_ERROR_MESSAGE);
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, columnId, userId]);

  const openFullSettings = async () => {
    try {
      setOpening(true);
      setError(null);
      // Do NOT pass `window` — this shell's iframe is ~400px wide.
      const size = settingsModalSize();
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

  const checking = isOwner === null && gateError === null;

  return (
    <main className="twyst-settings-launcher" dir="rtl">
      {gateError && <AttentionBox type="danger" text={gateError} />}
      {error && <AttentionBox type="danger" text={error} />}

      {checking && <LoadingState message="טוען…" />}

      {isOwner === true && (
        <Button
          kind="primary"
          size="medium"
          disabled={opening}
          onClick={openFullSettings}
          className="twyst-settings-launcher-cta"
        >
          {opening ? 'פותח…' : 'הגדרות'}
        </Button>
      )}

      {isOwner === false && !gateError && (
        <p className="twyst-settings-launcher-denied" dir="ltr">{NON_OWNER_MESSAGE}</p>
      )}

      <div className="twyst-version" dir="ltr">{VERSION_LABEL}</div>
    </main>
  );
}

export default SettingsLauncher;

// Settings view — owner-facing configuration of the lifecycle events board.
// Shows the OAuth connection status and, once provisioned, the board id +
// single group + column mapping (read-only). Provisioning the board creates it
// (+ 9 columns + one group) in the owner's monday account via the server, which
// uses the owner's OAuth token. If the owner has not authorized yet, the server
// returns not_authorized and this view links them to /oauth/start.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings, provisionBoard, type SettingsState } from '../lib/settings-api';
import logger from '../utils/logger';

const COLUMN_LABELS: Record<string, string> = {
  event_time: 'Event Time',
  category: 'Category',
  event_type: 'Event Type',
  app: 'App',
  feature: 'Feature',
  account_id: 'Account ID',
  user_id: 'User ID',
  details: 'Details',
  event_id: 'Event ID',
};

export function SettingsView() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setState(await fetchSettings());
    } catch (err) {
      setLoadError(
        'Could not load settings (open this from inside monday, signed in as an allowed account).'
      );
      // Surface the cause for debugging without breaking the UI (ships to Axiom via the sink).
      logger.warn('SettingsView', 'settings load failed', err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onProvision = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const res = await provisionBoard();
    if (res.ok) {
      setNotice('Board created ✓');
      await load();
    } else if (res.error === 'not_authorized') {
      setNotice('Authorize the app first, then create the board.');
    } else {
      setNotice('Board creation failed — check the server logs and try again.');
    }
    setBusy(false);
  }, [load]);

  if (loadError) {
    return (
      <div className="settings">
        <div className="notice">{loadError}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="settings">
        <p className="page__sub">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="settings">
      <section className="settings__block">
        <h2>App authorization</h2>
        <p className="page__sub">
          Board writes use the app's own monday identity, authorized once by the owner.
        </p>
        {state.oauthConnected ? (
          <p className="settings__status settings__status--ok">Authorized ✓</p>
        ) : (
          <p className="settings__status settings__status--warn">
            Not authorized —{' '}
            <a href="/oauth/start" target="_blank" rel="noreferrer">
              authorize the app
            </a>
            , then reload.
          </p>
        )}
      </section>

      <section className="settings__block">
        <h2>Events board</h2>
        <p className="page__sub">
          One private board, one group; the <code>App</code> column distinguishes apps. Install,
          subscription and feature-lifecycle webhooks are recorded here as items.
        </p>

        {state.board ? (
          <div className="settings__config">
            <dl>
              <dt>Board id</dt>
              <dd>
                <code>{state.board.boardId}</code>
              </dd>
              <dt>Group id</dt>
              <dd>
                <code>{state.board.groupId ?? '(default)'}</code>
              </dd>
            </dl>
            <table className="settings__cols">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Column id</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(COLUMN_LABELS).map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <code>{state.board?.columns?.[key] ?? '—'}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="settings__btn" onClick={onProvision} disabled={busy}>
              {busy ? 'Working…' : 'Recreate board'}
            </button>
          </div>
        ) : (
          <div className="settings__config">
            <p className="page__sub">No board configured yet.</p>
            <button
              className="settings__btn"
              onClick={onProvision}
              disabled={busy || !state.oauthConnected}
            >
              {busy ? 'Creating…' : 'Create events board'}
            </button>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}
      </section>
    </div>
  );
}

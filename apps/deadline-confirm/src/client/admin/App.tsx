// The admin screen — v4: two tabs. "הגדרות" carries the v2 flow (connection →
// board → action buttons → email templates → secret); "מייל מסכם" carries the
// digest config + preview + manual send. One shared save footer, one draft.

import { useCallback, useEffect, useState } from 'react';
import { Button, Loader, Tab, TabList, TabPanel, TabPanels, TabsContext } from '@vibe/core';
import type { ActionButton, AppState, Board, BoardColumn, EmailTemplate } from './types';
import { type ConfigDraft, type DigestDraft, draftFromConfig, draftToConfig } from './draft';
import { apiFetch, ApiError } from './services/api';
import { fetchBoards, fetchBoardColumns } from './services/monday';
import { ConnectionSection } from './components/ConnectionSection';
import { BoardConfigSection } from './components/BoardConfigSection';
import { ButtonsSection } from './components/ButtonsSection';
import { TemplatesSection } from './components/TemplatesSection';
import { SecretSection } from './components/SecretSection';
import { DigestSection } from './components/DigestSection';
import logger from './utils/logger';
import { useViewTracking } from './utils/viewTracking';

type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export function App() {
  // Usage telemetry (D3): the admin settings screen is reported once per session.
  useViewTracking(logger, 'admin_settings');

  const [state, setState] = useState<AppState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [pickersError, setPickersError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ConfigDraft>(draftFromConfig(null));
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });

  const [rotating, setRotating] = useState(false);
  const [rotateSuccess, setRotateSuccess] = useState(false);

  const loadState = useCallback(async (opts: { initDraft: boolean }) => {
    const nextState = await apiFetch<AppState>('/api/state');
    setState(nextState);
    if (opts.initDraft) {
      setDraft(draftFromConfig(nextState.config));
      setDirty(false);
    }
  }, []);

  // Boot: server state first (auth also proves the session), then boards.
  useEffect(() => {
    (async () => {
      try {
        await loadState({ initDraft: true });
        setBoards(await fetchBoards());
      } catch (err) {
        logger.error('admin', 'boot_failed', err);
        setBootError('טעינת ההגדרות נכשלה. ודאו שאתם פותחים את המסך מתוך monday ונסו לרענן.');
      }
    })();
  }, [loadState]);

  // Board picked → load its columns.
  useEffect(() => {
    if (!draft.boardId) {
      setColumns([]);
      return;
    }
    let cancelled = false;
    setColumnsLoading(true);
    setPickersError(null);
    fetchBoardColumns(draft.boardId)
      .then((cols) => {
        if (cancelled) return;
        setColumns(cols);
        const firstPeople = cols.find((c) => c.type === 'people');
        setDraft((d) =>
          d.peopleColumnId === null && firstPeople ? { ...d, peopleColumnId: firstPeople.id } : d
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('admin', 'columns_load_failed', err);
        setPickersError('טעינת עמודות הלוח נכשלה. נסו לרענן.');
      })
      .finally(() => {
        if (!cancelled) setColumnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.boardId]);

  const onDraftChange = (patch: Partial<ConfigDraft>) => {
    setSaveStatus({ kind: 'idle' });
    setDirty(true);
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Board switch invalidates every column-dependent pick.
      if (patch.boardId !== undefined && patch.boardId !== d.boardId) {
        next.peopleColumnId = null;
        next.buttons = next.buttons.map((b) => ({
          ...b,
          statusColumnId: '',
          targetIndex: -1,
          targetLabel: '',
        }));
        // Digest section date columns + status conditions live on the tasks
        // board too — a board switch invalidates them.
        next.digest = {
          ...next.digest,
          sections: next.digest.sections.map((s) => ({
            ...s,
            dateColumnId: null,
            dateColumnTitle: '',
            includeStatusLabelIds: [],
          })),
        };
      }
      return next;
    });
  };

  const onButtonsChange = (buttons: ActionButton[]) => onDraftChange({ buttons });
  const onTemplatesChange = (templates: EmailTemplate[]) => onDraftChange({ templates });
  const onDigestChange = (patch: Partial<DigestDraft>) =>
    onDraftChange({ digest: { ...draft.digest, ...patch } });

  const payload = draftToConfig(draft);

  const onSave = async () => {
    if (!payload) return;
    setSaveStatus({ kind: 'saving' });
    try {
      const res = await apiFetch<{ ok: boolean; config: AppState['config'] }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      // Re-sync from the normalized config (server may have generated ids).
      setDraft(draftFromConfig(res.config));
      setDirty(false);
      setSaveStatus({ kind: 'saved' });
      await loadState({ initDraft: false });
    } catch (err) {
      logger.error('admin', 'config_save_failed', err);
      const message =
        err instanceof ApiError && err.field
          ? `השמירה נכשלה — שדה לא תקין: ${err.field}`
          : 'השמירה נכשלה. נסו שוב.';
      setSaveStatus({ kind: 'error', message });
    }
  };

  const onRotate = async () => {
    setRotating(true);
    setRotateSuccess(false);
    setSaveStatus({ kind: 'idle' });
    try {
      // Masked secret only (V6 write-only full secret) — update UI without relying
      // on a follow-up GET /api/state that can 500 on SecureStorage after write.
      const res = await apiFetch<{ ok: boolean; secret: string | null }>('/api/secret/rotate', {
        method: 'POST',
      });
      setRotateSuccess(true);
      setState((s) => (s ? { ...s, secret: res.secret ?? s.secret } : s));
      try {
        await loadState({ initDraft: false });
      } catch (refreshErr) {
        logger.error('admin', 'secret_rotate_refresh_failed', refreshErr);
        setSaveStatus({
          kind: 'error',
          message: 'המפתח הוחלף, אבל רענון המסך נכשל. רעננו את העמוד.',
        });
      }
    } catch (err) {
      logger.error('admin', 'secret_rotate_failed', err);
      setRotateSuccess(false);
      const detail =
        err instanceof ApiError && typeof err.message === 'string' && err.message.startsWith('[admin ')
          ? err.message
          : null;
      setSaveStatus({
        kind: 'error',
        message: detail ?? 'יצירת מפתח חדש נכשלה. נסו שוב.',
      });
    } finally {
      setRotating(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadState({ initDraft: false });
    } catch (err) {
      logger.error('admin', 'state_refresh_failed', err);
      setBootError('רענון הסטטוס נכשל. נסו שוב.');
    } finally {
      setRefreshing(false);
    }
  };

  if (bootError) {
    return (
      <div className="dc-page">
        <div className="dc-error">{bootError}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="dc-page" style={{ alignItems: 'center', paddingTop: 80 }}>
        <Loader size={40} />
      </div>
    );
  }

  return (
    <div className="dc-page">
      <h1 style={{ margin: 0, fontSize: 20 }}>Deadline Confirm — הגדרות</h1>
      <TabsContext>
        <TabList>
          <Tab>הגדרות</Tab>
          <Tab>מייל מסכם</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="dc-tab-panel">
              <ConnectionSection oauth={state.oauth} onRefresh={onRefresh} refreshing={refreshing} />
              <BoardConfigSection
                boards={boards}
                columns={columns}
                columnsLoading={columnsLoading}
                draft={draft}
                onChange={onDraftChange}
              />
              {pickersError && <div className="dc-error">{pickersError}</div>}
              <ButtonsSection
                columns={columns}
                columnsLoading={columnsLoading}
                buttons={draft.buttons}
                dirty={dirty}
                onChange={onButtonsChange}
              />
              <TemplatesSection
                templates={draft.templates}
                buttons={draft.buttons}
                onChange={onTemplatesChange}
              />
              <SecretSection
                maskedSecret={state.secret}
                rotateSuccess={rotateSuccess}
                rotating={rotating}
                onRotate={onRotate}
              />
            </div>
          </TabPanel>
          <TabPanel>
            <div className="dc-tab-panel">
              <DigestSection
                boards={boards}
                tasksColumns={columns}
                tasksColumnsLoading={columnsLoading}
                buttons={draft.buttons}
                digest={draft.digest}
                dirty={dirty}
                onChange={onDigestChange}
              />
            </div>
          </TabPanel>
        </TabPanels>
      </TabsContext>
      <section className="dc-section">
        <h2>שמירה</h2>
        <div className="dc-footer">
          <Button onClick={onSave} disabled={!payload} loading={saveStatus.kind === 'saving'}>
            שמירת הגדרות
          </Button>
          {saveStatus.kind === 'saved' && <span className="dc-success">נשמר ✓</span>}
          {saveStatus.kind === 'error' && <span className="dc-error">{saveStatus.message}</span>}
          {!payload && (
            <span className="dc-hint">
              נדרשים: לוח + לפחות כפתור אחד מלא (ותבניות ללא שדות ריקים)
            </span>
          )}
        </div>
        <div className="dc-hint">
          גרסה {__APP_VERSION__} · {__BUILD_SHA__.slice(0, 7)}
        </div>
      </section>
    </div>
  );
}

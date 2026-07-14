// The single admin screen (spec §10): connection → board config → secret →
// snippet → save. No routing, no state library.

import { useCallback, useEffect, useState } from 'react';
import { Button, Loader } from '@vibe/core';
import type { AppState, Board, BoardColumn } from './types';
import { type ConfigDraft, draftFromConfig, draftToConfig } from './draft';
import { apiFetch, ApiError } from './services/api';
import { fetchBoards, fetchBoardColumns } from './services/monday';
import { ConnectionSection } from './components/ConnectionSection';
import { BoardConfigSection } from './components/BoardConfigSection';
import { SecretSection } from './components/SecretSection';
import { SnippetSection } from './components/SnippetSection';

type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [pickersError, setPickersError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ConfigDraft>(draftFromConfig(null));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });

  const [snippet, setSnippet] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const loadSnippet = useCallback(async () => {
    try {
      const res = await apiFetch<{ snippet: string }>('/api/snippet');
      setSnippet(res.snippet);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSnippet(null); // no secret yet — the section shows its hint
        return;
      }
      console.error('snippet load failed', err);
      setSnippet(null);
    }
  }, []);

  const loadState = useCallback(
    async (opts: { initDraft: boolean }) => {
      const nextState = await apiFetch<AppState>('/api/state');
      setState(nextState);
      if (opts.initDraft) setDraft(draftFromConfig(nextState.config));
      await loadSnippet();
    },
    [loadSnippet]
  );

  // Boot: server state first (auth also proves the session), then boards.
  useEffect(() => {
    (async () => {
      try {
        await loadState({ initDraft: true });
        setBoards(await fetchBoards());
      } catch (err) {
        console.error('admin boot failed', err);
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
        // Default people column (spec §10.2): first people column when unset.
        const firstPeople = cols.find((c) => c.type === 'people');
        setDraft((d) =>
          d.peopleColumnId === null && firstPeople ? { ...d, peopleColumnId: firstPeople.id } : d
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('columns load failed', err);
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
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Board switch invalidates every column-dependent pick.
      if (patch.boardId !== undefined && patch.boardId !== d.boardId) {
        next.statusColumnId = null;
        next.fromIndex = null;
        next.toIndex = null;
        next.peopleColumnId = null;
        next.expiryDateColumnId = null;
      }
      // Status column switch invalidates the label picks.
      if (patch.statusColumnId !== undefined && patch.statusColumnId !== d.statusColumnId) {
        next.fromIndex = null;
        next.toIndex = null;
      }
      return next;
    });
  };

  const payload = draftToConfig(draft, columns);

  const onSave = async () => {
    if (!payload) return;
    setSaveStatus({ kind: 'saving' });
    try {
      await apiFetch<{ ok: boolean }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSaveStatus({ kind: 'saved' });
      await loadState({ initDraft: false });
    } catch (err) {
      console.error('config save failed', err);
      const message =
        err instanceof ApiError && err.field
          ? `השמירה נכשלה — שדה לא תקין: ${err.field}`
          : 'השמירה נכשלה. נסו שוב.';
      setSaveStatus({ kind: 'error', message });
    }
  };

  const onRotate = async () => {
    setRotating(true);
    try {
      const res = await apiFetch<{ secret: string }>('/api/secret/rotate', { method: 'POST' });
      setRotatedSecret(res.secret);
      await loadState({ initDraft: false });
    } catch (err) {
      console.error('secret rotate failed', err);
      setSaveStatus({ kind: 'error', message: 'יצירת מפתח חדש נכשלה. נסו שוב.' });
    } finally {
      setRotating(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadState({ initDraft: false });
    } catch (err) {
      console.error('state refresh failed', err);
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
      <ConnectionSection oauth={state.oauth} onRefresh={onRefresh} refreshing={refreshing} />
      <BoardConfigSection
        boards={boards}
        columns={columns}
        columnsLoading={columnsLoading}
        draft={draft}
        onChange={onDraftChange}
      />
      {pickersError && <div className="dc-error">{pickersError}</div>}
      <SecretSection
        maskedSecret={state.secret}
        rotatedSecret={rotatedSecret}
        rotating={rotating}
        onRotate={onRotate}
      />
      <SnippetSection snippet={snippet} />
      <section className="dc-section">
        <h2>שמירה</h2>
        <div className="dc-footer">
          <Button onClick={onSave} disabled={!payload} loading={saveStatus.kind === 'saving'}>
            שמירת הגדרות
          </Button>
          {saveStatus.kind === 'saved' && <span className="dc-success">נשמר ✓</span>}
          {saveStatus.kind === 'error' && <span className="dc-error">{saveStatus.message}</span>}
        </div>
        <div className="dc-hint">
          גרסה {__APP_VERSION__} · {__BUILD_SHA__.slice(0, 7)}
        </div>
      </section>
    </div>
  );
}

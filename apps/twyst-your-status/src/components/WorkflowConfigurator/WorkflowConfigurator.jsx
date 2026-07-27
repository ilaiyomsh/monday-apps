import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import { GET_WORKFLOW_BOARD_METADATA } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import workflowClient from '../../services/workflowClient';
import logger from '../../utils/logger';
import { VERSION_LABEL } from '../../utils/versionLabel';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import './WorkflowConfigurator.css';

function newTransition(statusColumns) {
  const firstLabels = normalizeStatusLabels(statusColumns[0]?.settings);
  return {
    id: crypto.randomUUID(),
    fromLabelId: firstLabels[0] ? String(firstLabels[0].index) : '',
    toLabelId: firstLabels[1] ? String(firstLabels[1].index) : '',
    permissions: { mode: 'any', userIds: [], teamIds: [] },
    requiredColumnIds: [],
    formFields: [],
  };
}

function multiValues(event) {
  return [...event.target.selectedOptions].map((option) => option.value);
}

function TransitionCard({ transition, index, labels, columns, users, teams, onChange, onRemove }) {
  const update = (patch) => onChange({ ...transition, ...patch });
  const allowedFormIds = new Set(transition.formFields.map((field) => field.columnId));
  const toggleFormField = (column) => {
    const formFields = allowedFormIds.has(column.id)
      ? transition.formFields.filter((field) => field.columnId !== column.id)
      : [...transition.formFields, { columnId: column.id, required: false, label: column.title }];
    update({ formFields });
  };

  return (
    <article className="workflow-card">
      <header><h3>מעבר {index + 1}</h3><button type="button" onClick={onRemove}>מחיקה</button></header>
      <div className="workflow-grid two">
        <label>מסטאטוס<select value={transition.fromLabelId} onChange={(event) => update({ fromLabelId: event.target.value })}>
          {labels.map((label) => <option key={label.index} value={label.index}>{label.label || 'ללא שם'}</option>)}
        </select></label>
        <label>לסטאטוס<select value={transition.toLabelId} onChange={(event) => update({ toLabelId: event.target.value })}>
          {labels.map((label) => <option key={label.index} value={label.index}>{label.label || 'ללא שם'}</option>)}
        </select></label>
      </div>
      <label>הרשאה<select value={transition.permissions.mode} onChange={(event) => update({ permissions: { mode: event.target.value, userIds: [], teamIds: [] } })}>
        <option value="any">כל משתמש</option><option value="allowlist">משתמשים או צוותים מסוימים</option>
      </select></label>
      {transition.permissions.mode === 'allowlist' && <div className="workflow-grid two">
        <label>משתמשים<select multiple value={transition.permissions.userIds} onChange={(event) => update({ permissions: { ...transition.permissions, userIds: multiValues(event) } })}>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select></label>
        <label>צוותים<select multiple value={transition.permissions.teamIds} onChange={(event) => update({ permissions: { ...transition.permissions, teamIds: multiValues(event) } })}>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></label>
      </div>}
      <label>שדות שחייבים להיות מלאים<select multiple value={transition.requiredColumnIds} onChange={(event) => update({ requiredColumnIds: multiValues(event) })}>
        {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
      </select></label>
      <fieldset className="workflow-form-fields"><legend>שדות למילוי בזמן המעבר</legend>
        {columns.filter((column) => column.type !== 'status').map((column) => {
          const field = transition.formFields.find((candidate) => candidate.columnId === column.id);
          return <div key={column.id} className="workflow-inline-check">
            <label><input type="checkbox" checked={Boolean(field)} onChange={() => toggleFormField(column)} />{column.title}</label>
            {field && <label><input type="checkbox" checked={field.required} onChange={(event) => update({ formFields: transition.formFields.map((candidate) => candidate.columnId === column.id ? { ...candidate, required: event.target.checked } : candidate) })} />חובה בטופס</label>}
          </div>;
        })}
      </fieldset>
    </article>
  );
}

function WorkflowConfigurator({ context }) {
  const boardId = String(context.boardId);
  const [metadata, setMetadata] = useState(null);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [data, stored] = await Promise.all([
        mondayService.query(GET_WORKFLOW_BOARD_METADATA, { boardIds: [boardId] }),
        workflowClient.getBoardConfig(boardId),
      ]);
      const board = data.boards?.[0];
      if (!board) throw new Error('הלוח לא נמצא.');
      const statusColumns = board.columns.filter((column) => column.type === 'status');
      const targetColumnId = stored.config?.targetColumnId ?? statusColumns[0]?.id ?? '';
      setMetadata({ columns: board.columns, statusColumns, users: data.users ?? [], teams: data.teams ?? [] });
      setConnected(stored.connected);
      setDraft(stored.config ?? {
        schemaVersion: 1,
        targetColumnId,
        hiddenManualLabelIds: [],
        transitions: [],
        enforcement: { enabled: false },
      });
    } catch (caught) {
      logger.error('WorkflowConfigurator', 'Failed to load workflow configuration', caught);
      setError(caught.message);
    } finally { setLoading(false); }
  }, [boardId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type === 'twyst-oauth-connected') load();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);
  const targetColumn = metadata?.statusColumns.find((column) => column.id === draft?.targetColumnId);
  const labels = useMemo(() => normalizeStatusLabels(targetColumn?.settings), [targetColumn]);

  const save = async () => {
    try {
      setSaving(true); setError(null);
      await workflowClient.saveBoardConfig(boardId, draft);
      await mondayService.showNotice('ה־Workflow נשמר והאכיפה הופעלה לפי ההגדרות.');
      await load();
    } catch (caught) {
      logger.error('WorkflowConfigurator', 'Failed to save workflow configuration', caught);
      setError(caught.message);
    } finally { setSaving(false); }
  };

  if (!context.user?.isAdmin) return <ErrorState message="רק מנהלי החשבון יכולים לערוך את ה־Workflow." />;
  if (loading) return <LoadingState message="טוען את הגדרות ה־Workflow…" />;
  if (error && !draft) return <ErrorState message={error} onRetry={load} />;
  if (metadata.statusColumns.length === 0) return <ErrorState message="בלוח הזה אין עמודת Status." />;

  return <main className="workflow-configurator">
    <header className="workflow-title"><div><p>Twyst Your Status</p><h1>Workflow Configurator</h1><span>הגדירו מסלול עבודה אכיף לעמודת סטאטוס אחת בלוח.</span></div>
      <button className="primary-action" type="button" disabled={saving || !connected} onClick={save}>{saving ? 'שומר…' : 'שמירת Workflow'}</button>
    </header>
    {error && <div className="workflow-alert error">{error}</div>}
    {!connected && <section className="workflow-alert"><strong>נדרש חיבור מאובטח לחשבון monday</strong><span>החיבור מאפשר לשרת לרשום Webhook, לאכוף מעברים ולשלוח התראות.</span><button type="button" onClick={() => workflowClient.connectAccount()}>חיבור החשבון</button></section>}
    <section className="workflow-section">
      <h2>1. עמודת יעד</h2>
      <label>עמודת Status<select value={draft.targetColumnId} onChange={(event) => setDraft({ ...draft, targetColumnId: event.target.value, hiddenManualLabelIds: [], transitions: [] })}>
        {metadata.statusColumns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
      </select></label>
      <label className="workflow-toggle"><input type="checkbox" checked={draft.enforcement.enabled} onChange={(event) => setDraft({ ...draft, enforcement: { enabled: event.target.checked } })} />אכיפה פעילה גם על שינויים ישירים בטבלה</label>
    </section>
    <section className="workflow-section"><h2>2. לייבלים מוסתרים מבחירה ידנית</h2><div className="workflow-chip-list">
      {labels.map((label) => { const value = String(label.index); const checked = draft.hiddenManualLabelIds.includes(value); return <label key={value} className="workflow-chip"><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, hiddenManualLabelIds: checked ? draft.hiddenManualLabelIds.filter((id) => id !== value) : [...draft.hiddenManualLabelIds, value] })} /><i style={{ background: label.color }} />{label.label || 'ללא שם'}</label>; })}
    </div></section>
    <section className="workflow-section"><header className="workflow-section-header"><div><h2>3. מעברים והרשאות</h2><p>לכל מצב אפשר להגדיר כמה יעדים, הרשאות ושדות חובה.</p></div><button type="button" onClick={() => setDraft({ ...draft, transitions: [...draft.transitions, newTransition(metadata.statusColumns.filter((column) => column.id === draft.targetColumnId))] })}>הוספת מעבר</button></header>
      {draft.transitions.length === 0 && <p className="workflow-empty">עדיין לא הוגדרו מעברים.</p>}
      {draft.transitions.map((transition, index) => <TransitionCard key={transition.id} transition={transition} index={index} labels={labels} columns={metadata.columns.filter((column) => column.id !== draft.targetColumnId)} users={metadata.users} teams={metadata.teams} onChange={(next) => setDraft({ ...draft, transitions: draft.transitions.map((candidate) => candidate.id === transition.id ? next : candidate) })} onRemove={() => setDraft({ ...draft, transitions: draft.transitions.filter((candidate) => candidate.id !== transition.id) })} />)}
    </section>
    <footer className="workflow-version" aria-label="גרסת האפליקציה">{VERSION_LABEL}</footer>
  </main>;
}

export default WorkflowConfigurator;

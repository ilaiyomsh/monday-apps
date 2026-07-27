import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { findMissingRequiredColumnIds, isActorPermitted } from '../../domain/workflowPolicy';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import { GET_USERS_BY_IDS, GET_WORKFLOW_ITEM_DATA } from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import workflowClient from '../../services/workflowClient';
import logger from '../../utils/logger';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import './WorkflowPanel.css';

function formColumnsFor(transition, itemValues) {
  const missing = new Set(findMissingRequiredColumnIds(transition.requiredColumnIds, itemValues));
  const fields = new Map(transition.formFields.map((field) => [field.columnId, field]));
  missing.forEach((columnId) => {
    if (!fields.has(columnId)) fields.set(columnId, { columnId, required: true, label: '' });
  });
  return [...fields.values()].map((field) => ({ ...field, required: field.required || missing.has(field.columnId) }));
}

function inputType(columnType) {
  if (columnType === 'numbers') return 'number';
  if (columnType === 'date') return 'date';
  if (columnType === 'email') return 'email';
  return 'text';
}

function serializeValue(columnType, value) {
  if (columnType === 'numbers') return value === '' ? '' : Number(value);
  if (columnType === 'date') return value === '' ? '' : { date: value };
  if (columnType === 'email') return value === '' ? '' : { email: value, text: value };
  return value;
}

function TransitionModal({ transition, fields, columns, busy, onClose, onSubmit }) {
  const [values, setValues] = useState({});
  const submit = (event) => {
    event.preventDefault();
    const serialized = Object.fromEntries(fields.map((field) => {
      const column = columns.get(field.columnId);
      return [field.columnId, serializeValue(column?.type, values[field.columnId] ?? '')];
    }));
    onSubmit(serialized);
  };
  return <div className="workflow-modal-backdrop" role="presentation">
    <form className="workflow-modal" onSubmit={submit} aria-labelledby="transition-modal-title">
      <header><div><p>מעבר סטאטוס</p><h2 id="transition-modal-title">השלמת פרטים</h2></div><button type="button" onClick={onClose} disabled={busy}>×</button></header>
      {fields.map((field) => { const column = columns.get(field.columnId); return <label key={field.columnId}>{field.label || column?.title || field.columnId}{field.required && <b> *</b>}<input type={inputType(column?.type)} required={field.required} value={values[field.columnId] ?? ''} onChange={(event) => setValues({ ...values, [field.columnId]: event.target.value })} /></label>; })}
      <footer><button type="button" onClick={onClose} disabled={busy}>ביטול</button><button className="primary-action" type="submit" disabled={busy}>{busy ? 'מבצע מעבר…' : `מעבר אל ${transition.toLabel}`}</button></footer>
    </form>
  </div>;
}

function WorkflowPanel({ context }) {
  const boardId = String(context.boardId);
  const itemId = String(context.itemId ?? context.pulseId);
  const userId = String(context.user?.id);
  const [model, setModel] = useState(null);
  const [auditUsers, setAuditUsers] = useState({});
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const workflow = await workflowClient.getItemWorkflow(boardId, itemId);
      if (!workflow.config) { setModel({ workflow }); return; }
      const config = workflow.config;
      const columnIds = [...new Set([config.targetColumnId, ...config.transitions.flatMap((transition) => [...transition.requiredColumnIds, ...transition.formFields.map((field) => field.columnId)])])];
      const data = await mondayService.query(GET_WORKFLOW_ITEM_DATA, { boardIds: [boardId], itemIds: [itemId], columnIds, statusColumnIds: [config.targetColumnId], userIds: [userId] });
      const item = data.items?.[0];
      if (!item) throw new Error('הפריט לא נמצא.');
      const actor = data.users?.[0] ? { userId, teamIds: (data.users[0].teams ?? []).map((team) => String(team.id)) } : { userId, teamIds: [] };
      const labels = normalizeStatusLabels(data.boards?.[0]?.columns?.[0]?.settings);
      const statusValue = item.column_values.find((value) => value.id === config.targetColumnId);
      const currentLabelId = statusValue?.index == null ? null : String(statusValue.index);
      setModel({ workflow, config, item, actor, labels, currentLabelId, itemValues: item.column_values });
      const auditIds = [...new Set(workflow.audit.entries.map((entry) => entry.actorUserId).filter(Boolean))];
      if (auditIds.length > 0) {
        const usersData = await mondayService.query(GET_USERS_BY_IDS, { userIds: auditIds });
        setAuditUsers(Object.fromEntries((usersData.users ?? []).map((user) => [String(user.id), user.name])));
      }
    } catch (caught) {
      logger.error('WorkflowPanel', 'Failed to load item workflow', caught);
      setError(caught.message);
    } finally { setLoading(false); }
  }, [boardId, itemId, userId]);

  useEffect(() => { load(); }, [load]);
  const columns = useMemo(() => new Map((model?.item?.column_values ?? []).map((value) => [value.id, value.column])), [model]);
  const labelsById = useMemo(() => new Map((model?.labels ?? []).map((label) => [String(label.index), label])), [model]);

  const execute = async (transition, formValues = {}) => {
    try {
      setBusy(true); setError(null);
      await workflowClient.executeTransition(boardId, itemId, transition.id, formValues);
      setModal(null);
      await mondayService.showNotice('המעבר בוצע ונרשם ביומן.');
      await load();
    } catch (caught) {
      logger.error('WorkflowPanel', 'Failed to execute transition', caught);
      setError(caught.message);
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState message="טוען את ה־Workflow של הפריט…" />;
  if (error && !model) return <ErrorState message={error} onRetry={load} />;
  if (!model?.workflow.config) return <ErrorState message="עדיין לא הוגדר Workflow ללוח הזה." />;
  const currentLabel = labelsById.get(model.currentLabelId);
  const transitions = model.config.transitions.filter((transition) => transition.fromLabelId === model.currentLabelId);

  return <main className="workflow-panel">
    <header><div><p>Twyst Your Status</p><h1>{model.item.name}</h1></div><span className="workflow-current" style={{ '--status-color': currentLabel?.color ?? '#c4c4c4' }}>{currentLabel?.label || 'ללא סטאטוס'}</span></header>
    {error && <div className="workflow-panel-error">{error}</div>}
    <section><h2>פעולות זמינות</h2><div className="workflow-actions">
      {transitions.map((transition) => { const target = labelsById.get(transition.toLabelId); const permitted = isActorPermitted(transition.permissions, model.actor); const fields = formColumnsFor(transition, model.itemValues); return <button key={transition.id} type="button" disabled={!permitted || busy} title={permitted ? '' : 'אין לך הרשאה לבצע את המעבר'} onClick={() => fields.length > 0 ? setModal({ transition: { ...transition, toLabel: target?.label || transition.toLabelId }, fields }) : execute(transition)}><i style={{ background: target?.color ?? '#c4c4c4' }} />{target?.label || transition.toLabelId}{!permitted && <small>אין הרשאה</small>}</button>; })}
      {transitions.length === 0 && <p>אין מעברים מוגדרים מהסטאטוס הנוכחי.</p>}
    </div></section>
    <section><h2>יומן מעברים</h2><div className="workflow-audit-wrap"><table><thead><tr><th>מתי</th><th>משתמש</th><th>מעבר</th><th>פרטים</th></tr></thead><tbody>
      {model.workflow.audit.entries.map((entry) => <tr key={entry.id}><td>{new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.occurredAt))}</td><td>{auditUsers[entry.actorUserId] || (entry.actorUserId ? `#${entry.actorUserId}` : 'לא ידוע')}</td><td>{labelsById.get(entry.fromLabelId)?.label || entry.fromLabelId || '—'} ← {labelsById.get(entry.toLabelId)?.label || entry.toLabelId || '—'}</td><td>{Object.entries(entry.formValues).map(([key, value]) => `${columns.get(key)?.title || key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ') || '—'}</td></tr>)}
      {model.workflow.audit.entries.length === 0 && <tr><td colSpan="4">טרם בוצעו מעברים.</td></tr>}
    </tbody></table></div></section>
    {modal && <TransitionModal transition={modal.transition} fields={modal.fields} columns={columns} busy={busy} onClose={() => setModal(null)} onSubmit={(values) => execute(modal.transition, values)} />}
  </main>;
}

export default WorkflowPanel;

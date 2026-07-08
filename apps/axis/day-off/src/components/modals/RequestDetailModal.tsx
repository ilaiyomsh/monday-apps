/**
 * RequestDetailModal — view a request with avatar/status, detail-list, two note
 * cards (employee + manager), and manager/employee footer actions.
 * Ported from the prototype's RequestDetailModal (modals.jsx).
 */
import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, MiniLoader, Modal, Rng, StatusBadge, TypeChip } from '../ui';
import { ABSENCE_TYPES } from '../../domain/absence';
import { workdaysBetween } from '../../domain/dates';
import { useL10n } from '../../domain/useL10n';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import type { DayOffRequest } from '../../domain/types';

/** Human-readable file size (technical units, not localized). */
function fmtFileSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export interface RequestDetailModalProps {
  request: DayOffRequest;
  viewerIsManager: boolean;
  onClose: () => void;
  onApprove: (request: DayOffRequest) => void;
  onReject: (request: DayOffRequest) => void;
  onCancel: (request: DayOffRequest) => void;
  onEdit?: (request: DayOffRequest) => void;
}

interface EditableNoteProps {
  value: string;
  liveValue: string;
  editable: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  saveLabel: string;
}

function EditableNote({
  value,
  liveValue,
  editable,
  saving,
  onChange,
  onSave,
  saveLabel,
}: EditableNoteProps) {
  const dirty = value.trim() !== (liveValue ?? '').trim();

  if (!editable) {
    return <div className="note-body">{liveValue}</div>;
  }

  return (
    <div className="note-edit">
      <textarea
        className="textarea note-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {dirty && (
        <button type="button" className="btn btn-secondary btn-sm note-save" disabled={saving} onClick={onSave}>
          {saving ? <MiniLoader size={13} /> : null}
          {saveLabel}
        </button>
      )}
    </div>
  );
}

export function RequestDetailModal({
  request,
  viewerIsManager,
  onClose,
  onApprove,
  onReject,
  onCancel,
  onEdit,
}: RequestDetailModalProps) {
  const { t, fmtRange } = useL10n();
  const {
    requests,
    empById,
    canAttachDocuments,
    attachDocument,
    saveRequestNotes,
    canEditEmployeeNote,
    canEditManagerNote,
  } = useDayOffData();

  const live = requests.find((r) => r.id === request.id) ?? request;

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);
  const [employeeNote, setEmployeeNote] = useState(live.note ?? '');
  const [managerNote, setManagerNote] = useState(live.managerNote ?? '');
  const [savingEmployeeNote, setSavingEmployeeNote] = useState(false);
  const [savingManagerNote, setSavingManagerNote] = useState(false);

  useEffect(() => {
    setEmployeeNote(live.note ?? '');
  }, [live.id, live.note]);

  useEffect(() => {
    setManagerNote(live.managerNote ?? '');
  }, [live.id, live.managerNote]);

  async function onPickAndUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      await attachDocument(live, f);
      setJustUploaded(true);
    } finally {
      setUploading(false);
    }
  }

  async function onSaveEmployeeNote() {
    setSavingEmployeeNote(true);
    try {
      await saveRequestNotes(live, { employeeNote: employeeNote.trim() });
    } finally {
      setSavingEmployeeNote(false);
    }
  }

  async function onSaveManagerNote() {
    setSavingManagerNote(true);
    try {
      await saveRequestNotes(live, { managerNote: managerNote.trim() });
    } finally {
      setSavingManagerNote(false);
    }
  }

  const emp = empById(live.employeeId);
  const meta = ABSENCE_TYPES[live.type] ?? { id: live.type, labelKey: live.type, color: 'var(--color-primary)', index: 0 };
  const workdays = workdaysBetween(live.start, live.end);
  const decidedBy = live.decidedBy ? empById(live.decidedBy) : null;
  const canManage = viewerIsManager && live.status === 'pending';
  const canCancel = !viewerIsManager && live.status === 'pending';
  const canEditEmployee = !viewerIsManager && canEditEmployeeNote;
  const canEditManager = viewerIsManager && canEditManagerNote;

  return (
    <Modal
      title={t(meta.labelKey)}
      onClose={onClose}
      footer={
        <>
          {canCancel && (
            <>
              {onEdit && (
                <button className="btn btn-ghost" onClick={() => onEdit(live)}>
                  {t('detail.editRequest')}
                </button>
              )}
              <button className="btn btn-danger" onClick={() => onCancel(live)}>
                <Icon name="trash" size={15} /> {t('detail.cancelRequest')}
              </button>
            </>
          )}
          {canManage && (
            <>
              <button className="btn btn-reject" onClick={() => onReject(live)}>
                <Icon name="x" size={16} /> {t('detail.reject')}
              </button>
              <button className="btn btn-approve" onClick={() => onApprove(live)}>
                <Icon name="check" size={16} /> {t('detail.approve')}
              </button>
            </>
          )}
          {!canManage && !canCancel && (
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        <Avatar emp={emp} size="lg" />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-on-dark)' }}>{emp?.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{emp?.title}</div>
        </div>
        <div style={{ marginInlineStart: 'auto' }}>
          <StatusBadge status={live.status} />
        </div>
      </div>

      <div className="detail-list card" style={{ padding: '4px var(--spacing-lg)' }}>
        <div className="detail-row">
          <span className="dl">{t('detail.rowType')}</span>
          <span className="dv">
            <TypeChip type={live.type} />
          </span>
        </div>
        <div className="detail-row">
          <span className="dl">{t('detail.rowDates')}</span>
          <span className="dv">
            <Rng start={live.start} end={live.end} />
          </span>
        </div>
        <div className="detail-row">
          <span className="dl">{t('detail.rowDuration')}</span>
          <span className="dv">{t('common.workdays', { count: workdays })}</span>
        </div>
        <div className="detail-row">
          <span className="dl">{t('detail.rowSubmitted')}</span>
          <span className="dv" dir="ltr">{fmtRange(live.submittedAt, live.submittedAt)}</span>
        </div>
        {live.attachment && (
          <div className="detail-row">
            <span className="dl">{t('detail.rowDocument')}</span>
            <span className="dv">
              {live.attachment.url ? (
                <a className="file-link" href={live.attachment.url} target="_blank" rel="noopener">
                  <Icon name="paperclip" size={15} />
                  {live.attachment.name}
                </a>
              ) : (
                <span className="file-link" style={{ cursor: 'default' }}>
                  <Icon name="paperclip" size={15} />
                  {live.attachment.name}
                </span>
              )}
              {live.attachment.size != null && (
                <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginInlineStart: 6 }}>
                  · {fmtFileSize(live.attachment.size)}
                </span>
              )}
            </span>
          </div>
        )}
        {decidedBy && (
          <div className="detail-row">
            <span className="dl">{live.status === 'approved' ? t('detail.decidedByApproved') : t('detail.decidedByRejected')}</span>
            <span className="dv">{decidedBy.name}</span>
          </div>
        )}
        {canAttachDocuments && (
          <div className="detail-row">
            <span className="dl">{t('detail.attachDocument')}</span>
            <span className="dv">
              <input ref={fileRef} type="file" hidden onChange={onPickAndUpload} />
              <button
                type="button"
                className="file-attach-btn"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="paperclip" size={14} />
                {uploading
                  ? t('detail.uploading')
                  : justUploaded
                    ? t('detail.uploaded')
                    : live.attachment
                      ? t('detail.replaceDocument')
                      : t('detail.attachDocument')}
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="notes-block">
        {(canEditEmployee || live.note) && (
          <div className="note-card employee">
            <div className="note-head">
              <Icon name="user" size={13} /> {t('detail.employeeNote')}
            </div>
            <EditableNote
              value={employeeNote}
              liveValue={live.note ?? ''}
              editable={canEditEmployee}
              saving={savingEmployeeNote}
              onChange={setEmployeeNote}
              onSave={onSaveEmployeeNote}
              saveLabel={t('common.save')}
            />
          </div>
        )}
        {/* Manager note always shows — even empty — so the approver's response area is visible. */}
        <div className={`note-card manager ${live.status === 'rejected' ? 'danger' : ''}`}>
          <div className="note-head">
            <Icon name="check" size={13} /> {t('detail.managerNote')}
          </div>
          <EditableNote
            value={managerNote}
            liveValue={live.managerNote ?? ''}
            editable={canEditManager}
            saving={savingManagerNote}
            onChange={setManagerNote}
            onSave={onSaveManagerNote}
            saveLabel={t('common.save')}
          />
        </div>
      </div>
    </Modal>
  );
}

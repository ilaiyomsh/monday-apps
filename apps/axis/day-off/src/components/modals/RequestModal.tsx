/**
 * RequestModal — new / edit absence request. Ported from the prototype's
 * modals.jsx. Type picker, date range, live summary, over-balance + overlap-
 * holidays warnings, manager note, and an attachment chip / file-drop.
 *
 * Data that the prototype read off window.DayOffData (balanceFor, COMPANY_DAYS)
 * now comes from useDayOffData(); date formatting via useL10n(); strings via t().
 */
import { useEffect, useRef, useState } from 'react';
import type { AbsenceType, Attachment, RequestDraft, Employee } from '../../domain/types';
import { ABSENCE_TYPES, TYPE_ORDER } from '../../domain/absence';
import { todayKey, workdaysBetween, calDaysBetween } from '../../domain/dates';
import { useL10n } from '../../domain/useL10n';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { Modal, Icon, MiniLoader, Rng } from '../ui';

/** Human-readable file size — kept local, matches the prototype helper. */
export function fmtFileSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface RequestModalProps {
  currentUser: Employee;
  initial?: (Partial<RequestDraft> & { id?: string }) | null;
  onClose: () => void;
  onSubmit: (draft: RequestDraft) => void;
  busy?: boolean;
}

export function RequestModal({ currentUser, initial, onClose, onSubmit, busy }: RequestModalProps) {
  const { t } = useL10n();
  const { balanceFor, companyDays } = useDayOffData();

  // No default type (change #76): a new request opens with NOTHING selected —
  // the required type must be a conscious choice. Editing keeps the saved type.
  const [type, setType] = useState<AbsenceType | ''>(initial?.type || '');
  const [start, setStart] = useState(initial?.start || todayKey());
  const [end, setEnd] = useState(initial?.end || initial?.start || todayKey());
  const [note, setNote] = useState(initial?.note || '');
  const [attachment, setAttachment] = useState<Attachment | null>(initial?.attachment || null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A selected type whose label was removed from the board falls back to
    // unselected (not to an arbitrary first type).
    if (type && TYPE_ORDER.length > 0 && !TYPE_ORDER.includes(type)) setType('');
  }, [type]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (f) setAttachment({ name: f.name, size: f.size, url: URL.createObjectURL(f), file: f });
    e.target.value = '';
  }

  // keep end >= start: clamp end up whenever start moves past it
  function changeStart(v: string) {
    setStart(v);
    if (end < v) setEnd(v);
  }

  const datesValid = !!(start && end && end >= start);
  const valid = !!type && datesValid;
  const workdays = datesValid ? workdaysBetween(start, end) : 0;
  const calDays = datesValid ? calDaysBetween(start, end) : 0;

  // overlapping company days within range
  const overlapHolidays = datesValid ? companyDays.filter((h) => h.start <= end && h.end >= start) : [];

  const bal = type && datesValid ? balanceFor(Number(start.slice(0, 4)), currentUser.id, type) : null;
  // Quotas were removed (entitled is always 0) → no remaining/over-balance hints.
  const remaining = bal && bal.entitled > 0 ? bal.entitled - bal.used : null;
  const overBalance = remaining != null && workdays > remaining;
  const tt = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };

  return (
    <Modal
      title={initial?.id ? t('request.editTitle') : t('request.newTitle')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => {
              if (!type) return; // unreachable while disabled — narrows the union
              onSubmit({ type, start, end, note: note.trim(), attachment: attachment || undefined });
            }}
          >
            {busy ? <MiniLoader size={15} /> : null}
            {t('request.submit')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          {t('request.typeLabel')} <span className="req">{t('request.required')}</span>
        </label>
        <div className="type-picker">
          {TYPE_ORDER.map((id) => {
            const meta = ABSENCE_TYPES[id];
            return (
              <button
                key={id}
                className={`type-opt ${type === id ? 'selected' : ''}`}
                style={{ '--sel': meta.color } as React.CSSProperties}
                onClick={() => setType(id)}
              >
                {t(meta.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="two-col">
        <div className="field">
          <label className="field-label">
            {t('request.fromLabel')} <span className="req">{t('request.required')}</span>
          </label>
          <input
            className="input"
            type="date"
            value={start}
            onChange={(e) => changeStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">
            {t('request.toLabel')} <span className="req">{t('request.required')}</span>
          </label>
          <input
            className="input"
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      {valid && (
        <div className="summary summary--inline">
          <span className="summary-part">
            <span className="summary-label">{t('request.summaryDatesLabel')}</span>
            <strong className="summary-num">
              <Rng start={start} end={end} />
            </strong>
          </span>
          <span className="summary-sep" aria-hidden="true" />
          <span className="summary-part">
            <span className="summary-label">{t('request.summaryCalDaysLabel')}</span>
            <strong className="summary-num">{calDays}</strong>
          </span>
          <span className="summary-sep" aria-hidden="true" />
          <span className="summary-part">
            <span className="summary-label">{t('request.summaryWorkdays')}</span>
            <strong className="summary-num">{workdays}</strong>
          </span>
          {remaining != null && (
            <>
              <span className="summary-sep" aria-hidden="true" />
              <span className="summary-part">
                <span className="summary-label">{t('request.summaryRemaining')}</span>
                <strong className="summary-num">{remaining - workdays}</strong>
              </span>
            </>
          )}
        </div>
      )}

      {overBalance && (
        <div className="warn-box">
          <Icon name="alert" size={16} />
          <span>{t('request.overBalance', { type: t(tt.labelKey), count: remaining })}</span>
        </div>
      )}
      {overlapHolidays.length > 0 && (
        <div
          className="warn-box"
          style={{
            background: 'var(--color-info-bg)',
            borderColor: 'var(--color-info-border)',
            color: 'var(--color-text-dark)',
          }}
        >
          <Icon name="info" size={16} />
          <span>
            {t('request.overlapHolidays', { names: overlapHolidays.map((h) => h.name).join(', ') })}
          </span>
        </div>
      )}

      <div className="field">
        <label className="field-label">{t('request.noteLabel')}</label>
        <textarea
          className="textarea"
          placeholder={t('request.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label">
          {t('request.fileLabel')}{' '}
          <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
            {t('request.fileOptional')}
          </span>
        </label>
        {attachment ? (
          <div className="file-chip">
            <span className="fc-icon">
              <Icon name="file" size={17} />
            </span>
            <div className="fc-meta">
              <span className="fc-name">{attachment.name}</span>
              {attachment.size != null && <span className="fc-size">{fmtFileSize(attachment.size)}</span>}
            </div>
            <button
              className="fc-remove"
              onClick={() => setAttachment(null)}
              title={t('common.remove')}
            >
              <Icon name="x" size={17} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="file-drop"
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            <Icon name="paperclip" size={17} />
            <span>{t('request.filePick')}</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          style={{ display: 'none' }}
          onChange={onPickFile}
        />
      </div>
    </Modal>
  );
}

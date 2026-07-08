/**
 * CompanyDayModal — manager add / edit of a company-wide day off (holiday).
 * Ported from the prototype's modals.jsx. Name, date range, live day-count
 * summary, a mandatory/optional switch, and a delete action when editing.
 *
 * Date formatting via useL10n(); strings via t(). onSave receives a
 * CompanyDayDraft; onDelete receives the original CompanyDay.
 */
import { useState } from 'react';
import type { CompanyDay, CompanyDayDraft } from '../../domain/types';
import { todayKey, calDaysBetween } from '../../domain/dates';
import { useL10n } from '../../domain/useL10n';
import { Modal, Icon, MiniLoader } from '../ui';

interface CompanyDayModalProps {
  initial?: CompanyDay | null;
  onClose: () => void;
  onSave: (draft: CompanyDayDraft) => void;
  onDelete: (companyDay: CompanyDay) => void;
  /** Write in flight — buttons lock, Save shows a loader, the owner closes on success. */
  busy?: boolean;
}

export function CompanyDayModal({ initial, onClose, onSave, onDelete, busy }: CompanyDayModalProps) {
  const { t, fmtRange } = useL10n();

  const [start, setStart] = useState(initial?.start || todayKey());
  const [end, setEnd] = useState(initial?.end || initial?.start || todayKey());
  const [name, setName] = useState(initial?.name || '');
  const [mandatory, setMandatory] = useState(initial?.mandatory ?? true);

  // keep end >= start: clamp end up whenever start moves past it
  function changeStart(v: string) {
    setStart(v);
    if (end < v) setEnd(v);
  }

  const valid = !!(start && end && end >= start && name.trim());
  const days = valid ? calDaysBetween(start, end) : 0;

  return (
    <Modal
      title={initial?.id ? t('companyDay.editTitle') : t('companyDay.addTitle')}
      sub={t('companyDay.sub')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {initial?.id && (
            <button className="btn btn-danger spread" disabled={busy} onClick={() => onDelete(initial)}>
              <Icon name="trash" size={15} /> {t('companyDay.delete')}
            </button>
          )}
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => onSave({ id: initial?.id, start, end, name: name.trim(), mandatory })}
          >
            {busy ? <MiniLoader size={15} /> : <Icon name="check" size={16} />} {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          {t('companyDay.nameLabel')} <span className="req">{t('request.required')}</span>
        </label>
        <input
          className="input"
          placeholder={t('companyDay.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="two-col">
        <div className="field">
          <label className="field-label">
            {t('companyDay.fromLabel')} <span className="req">{t('request.required')}</span>
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
            {t('companyDay.toLabel')} <span className="req">{t('request.required')}</span>
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
        <div className="summary">
          <span className="summary-num" style={{ color: 'var(--color-event-holiday)' }}>
            {days}
          </span>
          <span>
            <b>{days === 1 ? t('companyDay.dayUnit') : t('companyDay.daysUnit')}</b> ·{' '}
            <span className="ltr-range" dir="ltr">
              {fmtRange(start, end)}
            </span>
          </span>
        </div>
      )}
      <div className="toggle-row">
        <div>
          <div className="tr-label">{t('companyDay.mandatoryLabel')}</div>
          <div className="tr-hint">
            {mandatory ? t('companyDay.mandatoryHint') : t('companyDay.optionalHint')}
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={mandatory}
            onChange={(e) => setMandatory(e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>
    </Modal>
  );
}

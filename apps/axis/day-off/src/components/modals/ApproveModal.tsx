/**
 * ApproveModal — approve a request with an optional manager note. Ported from
 * the prototype's modals.jsx.
 *
 * Data the prototype read off window.DayOffData (empById, ABSENCE_TYPES label)
 * now comes from useDayOffData() + ABSENCE_TYPES; strings via t().
 */
import { useState } from 'react';
import type { DayOffRequest } from '../../domain/types';
import { ABSENCE_TYPES } from '../../domain/absence';
import { useL10n } from '../../domain/useL10n';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import { Modal, Icon, MiniLoader, Rng } from '../ui';

interface ApproveModalProps {
  request: DayOffRequest;
  onClose: () => void;
  onConfirm: (request: DayOffRequest, note: string) => void;
  busy?: boolean;
}

export function ApproveModal({ request, onClose, onConfirm, busy }: ApproveModalProps) {
  const { t } = useL10n();
  const { empById } = useDayOffData();
  const [note, setNote] = useState(request.managerNote ?? '');
  const emp = empById(request.employeeId);
  const typeMeta = ABSENCE_TYPES[request.type] ?? { id: request.type, labelKey: request.type, color: 'var(--color-primary)', index: 0 };

  return (
    <Modal
      title={t('approve.title')}
      sub={
        <>
          {emp?.name} · {t(typeMeta.labelKey)}, <Rng start={request.start} end={request.end} />
        </>
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common.back')}
          </button>
          <button className="btn btn-approve" disabled={busy} onClick={() => onConfirm(request, note.trim())}>
            {busy ? <MiniLoader size={15} /> : <Icon name="check" size={16} />}
            {t('approve.confirm')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">
          {t('approve.noteLabel')}{' '}
          <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
            {t('approve.noteOptional')}
          </span>
        </label>
        <textarea
          className="textarea"
          placeholder={t('approve.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
        <span className="field-hint">{t('approve.noteHint')}</span>
      </div>
    </Modal>
  );
}

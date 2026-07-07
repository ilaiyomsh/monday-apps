/**
 * RejectModal — manager rejects a request with a reason / manager note.
 * Ported from the prototype (modals.jsx); preserves component/prop/class names.
 */
import { useState } from 'react';
import { Modal, Icon, Rng } from '../ui';
import { useL10n } from '../../domain/useL10n';
import { ABSENCE_TYPES } from '../../domain/absence';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import type { DayOffRequest } from '../../domain/types';

export interface RejectModalProps {
  request: DayOffRequest;
  onClose: () => void;
  onConfirm: (request: DayOffRequest, reason: string) => void;
}

export function RejectModal({ request, onClose, onConfirm }: RejectModalProps) {
  const { t } = useL10n();
  const { empById } = useDayOffData();
  const [reason, setReason] = useState(request.managerNote ?? '');
  const emp = empById(request.employeeId);
  const typeMeta = ABSENCE_TYPES[request.type] ?? { id: request.type, labelKey: request.type, color: 'var(--color-primary)', index: 0 };

  return (
    <Modal
      title={t('reject.title')}
      sub={
        <>
          {emp?.name} · {t(typeMeta.labelKey)}, <Rng start={request.start} end={request.end} />
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.back')}
          </button>
          <button className="btn btn-reject" onClick={() => onConfirm(request, reason.trim())}>
            <Icon name="x" size={16} /> {t('reject.confirm')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">{t('reject.noteLabel')}</label>
        <textarea
          className="textarea"
          placeholder={t('reject.notePlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <span className="field-hint">{t('reject.noteHint')}</span>
      </div>
    </Modal>
  );
}

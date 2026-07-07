/* ============================================================
   Day Off — Drill-down modal: the requests behind a number.
   Ported from the prototype's DrillModal. A wide modal listing the
   requests for a clicked dashboard cell, via RequestRow (showEmp).
   `title`/`sub` are localized by the caller (DashboardView builds the
   drill payload with useL10n); empty-state strings come from useL10n.
   ============================================================ */
import { useMemo, useState, type ReactNode } from 'react';
import { useL10n } from '../../domain/useL10n';
import type { DayOffRequest } from '../../domain/types';
import { ABSENCE_TYPES, TYPE_ORDER } from '../../domain/absence';
import { workdaysBetween } from '../../domain/dates';
import { Modal, EmptyState } from '../ui';
import { RequestRow } from '../views/EmployeeView';

export interface DrillModalProps {
  title: ReactNode;
  sub?: ReactNode;
  requests: DayOffRequest[];
  onOpenRequest: (request: DayOffRequest) => void;
  onClose: () => void;
}

export function DrillModal({ title, sub, requests, onOpenRequest, onClose }: DrillModalProps) {
  const { t } = useL10n();
  const groups = useMemo(
    () =>
      [...new Set([...TYPE_ORDER, ...requests.map((r) => r.type)])]
        .map((type) => ({
          type,
          requests: requests.filter((r) => r.type === type),
        }))
        .filter((g) => g.requests.length > 0),
    [requests],
  );
  const [openType, setOpenType] = useState<string | null>(groups[0]?.type ?? null);

  return (
    <Modal title={title} sub={sub} wide onClose={onClose}>
      {requests.length ? (
        <div className="card list" style={{ boxShadow: 'none' }}>
          {groups.map((group) => {
            const reqDays = group.requests.reduce((s, r) => s + workdaysBetween(r.start, r.end), 0);
            const isOpen = openType === group.type;
            const meta = ABSENCE_TYPES[group.type] ?? { id: group.type, labelKey: group.type, color: 'var(--color-primary)', index: 0 };
            return (
              <section key={group.type} className="drill-acc">
                <button type="button" className="drill-acc-head" onClick={() => setOpenType((p) => (p === group.type ? null : group.type))}>
                  <span className="drill-acc-title">{t(meta.labelKey)}</span>
                  <span className="drill-acc-meta">{t('views.dashboard.drillGroupMeta', { count: group.requests.length, days: reqDays })}</span>
                </button>
                {isOpen && (
                  <div className="drill-acc-body">
                    {group.requests.map((r) => (
                      <RequestRow key={r.id} request={r} onClick={onOpenRequest} showEmp />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState title={t('drill.emptyTitle')} sub={t('drill.emptySub')} />
      )}
    </Modal>
  );
}

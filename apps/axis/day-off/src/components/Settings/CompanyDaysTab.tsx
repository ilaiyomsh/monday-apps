/**
 * CompanyDaysTab — company-days / holidays management embedded in the Settings
 * dialog (moved out of the top-level nav). Self-contained: reads companyDays/years
 * from useDayOffData(), owns the year filter + add/edit modal state, and persists
 * via saveCompanyDay/deleteCompanyDay (immediate writes — not part of the settings
 * draft). The CompanyDayModal overlay (z-index 1500) stacks above the dialog (1000).
 */
import { useState } from 'react';
import { useL10n } from '../../domain/useL10n';
import { todayKey, calDaysBetween } from '../../domain/dates';
import { useDayOffData } from '../../contexts/DayOffDataProvider';
import type { CompanyDay } from '../../domain/types';
import { Icon, Rng, YearSelect, EmptyState } from '../ui';
import { CompanyDayModal } from '../modals/CompanyDayModal';

export function CompanyDaysTab() {
  const { t, relDays } = useL10n();
  const { companyDays, years, year, saveCompanyDay, deleteCompanyDay } = useDayOffData();
  const [filterYear, setFilterYear] = useState(year);
  // null = closed; { initial } = open (initial undefined → add, CompanyDay → edit).
  const [modal, setModal] = useState<{ initial?: CompanyDay | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const tKey = todayKey();
  const all = companyDays
    .filter((d) => Number(d.start.slice(0, 4)) === filterYear)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="cd-settings">
      <div className="cd-settings-head">
        <div>
          <span style={{ fontWeight: 600 }}>{t('settings.company.title')}</span>
        </div>
        <div className="head-actions">
          <YearSelect year={filterYear} years={years} onChange={setFilterYear} />
          <button className="btn btn-primary" onClick={() => setModal({})}>
            <Icon name="plus" size={17} strokeWidth={2} /> {t('views.company.addDay')}
          </button>
        </div>
      </div>

      {all.length ? (
        <div className="card cd-card">
          <table className="cd-table">
            <thead>
              <tr>
                <th>{t('views.company.colName')}</th>
                <th>{t('views.company.colDates')}</th>
                <th className="cd-num-col">{t('views.company.colDays')}</th>
                <th>{t('views.company.colKind')}</th>
                <th aria-label={t('views.company.colEdit')} />
              </tr>
            </thead>
            <tbody>
              {all.map((h) => {
                const past = h.end < tKey;
                const dcount = calDaysBetween(h.start, h.end);
                return (
                  <tr key={h.id} className={`cd-row ${past ? 'past' : ''}`} onClick={() => setModal({ initial: h })}>
                    <td className="cd-name">
                      <span className={`cd-mark ${h.mandatory ? '' : 'optional'}`}>
                        <Icon name="square" size={9} fill={h.mandatory ? 'currentColor' : 'none'} />
                      </span>
                      <span className="cd-name-txt">{h.name}</span>
                      {!past && relDays(h.start) && <span className="cd-rel">{relDays(h.start)}</span>}
                    </td>
                    <td><Rng start={h.start} end={h.end} /></td>
                    <td className="cd-num-col">{dcount}</td>
                    <td>
                      <span className={`req-pill ${h.mandatory ? 'mandatory' : 'optional'}`}>
                        {h.mandatory ? t('companyDay.mandatory') : t('companyDay.optional')}
                      </span>
                    </td>
                    <td className="cd-edit">
                      <Icon name="chevron-right" size={17} className="rtl-flip" style={{ color: 'var(--color-text-disabled)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card list">
          <EmptyState icon="calendar" title={t('views.company.emptyTitle', { year: filterYear })} sub={t('views.company.emptySub')} />
        </div>
      )}

      {modal && (
        <CompanyDayModal
          initial={modal.initial}
          busy={saving}
          onClose={() => setModal(null)}
          onSave={(draft) => {
            void (async () => {
              setSaving(true);
              const ok = await saveCompanyDay(draft);
              setSaving(false);
              // Failure keeps the modal open (input preserved); the provider
              // already surfaced the error.
              if (ok) setModal(null);
            })();
          }}
          onDelete={(h) => {
            void deleteCompanyDay(h);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

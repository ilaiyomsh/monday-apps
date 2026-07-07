/**
 * TypeLegend — swatch + label per absence type, in TYPE_ORDER. Ported from the
 * prototype; labels resolved via ABSENCE_TYPES[type].labelKey + t().
 */
import { useTranslation } from 'react-i18next';
import { absenceTypeMeta, TYPE_ORDER } from '../../domain/absence';

export function TypeLegend() {
  const { t } = useTranslation();
  return (
    <div className="legend">
      {TYPE_ORDER.map((type) => (
        <span key={type} className="legend-item">
          <span className="legend-swatch" style={{ background: absenceTypeMeta(type).color }} />
          {t(absenceTypeMeta(type).labelKey)}
        </span>
      ))}
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: 'var(--color-event-holiday)' }} />
        {t('views.dashboard.legendCompany')}
      </span>
    </div>
  );
}

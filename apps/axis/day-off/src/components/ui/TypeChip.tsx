/**
 * TypeChip — colored dot + absence-type label. Ported from the prototype;
 * label resolved via ABSENCE_TYPES[type].labelKey + t().
 */
import { useTranslation } from 'react-i18next';
import { ABSENCE_TYPES } from '../../domain/absence';
import type { AbsenceType } from '../../domain/types';

export interface TypeChipProps {
  type: AbsenceType;
}

export function TypeChip({ type }: TypeChipProps) {
  const { t } = useTranslation();
  const meta = ABSENCE_TYPES[type] ?? { id: type, labelKey: type, color: 'var(--color-primary)', index: 0 };
  return (
    <span className="type-chip">
      <span className="dot" style={{ background: meta.color }} />
      {t(meta.labelKey)}
    </span>
  );
}

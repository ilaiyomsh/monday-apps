import { SOURCE_FIELD_LABELS } from '../../../../lib/sourceFields';
import type { SourceField } from '../../../../types';

interface Props {
  source: SourceField;
}

export function VariableChip({ source }: Props) {
  const label = SOURCE_FIELD_LABELS[source];
  return (
    <span
      role="button"
      aria-label={`Variable: ${label}, press Backspace to remove`}
      contentEditable={false}
      style={{
        background: 'var(--primary-background-hover-color, #e6e9ef)',
        color: 'var(--primary-text-color, #323338)',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 500,
        display: 'inline-block',
        marginInline: 1,
        userSelect: 'none',
        cursor: 'default',
        lineHeight: '16px',
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
}

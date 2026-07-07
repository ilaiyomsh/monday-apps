import { StatusValuePicker } from '../../conditionals/StatusValuePicker';
import type { Column, ColumnMappingEntry, ConditionalValue } from '../../../types';

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

// The mapping editor stores `{ type: 'status', value: { id } }` — same shape
// the ConditionalValue picker emits for status, so we reuse it directly.
export function StatusLabelEditor({ entry, column, disabled, onChange }: Props) {
  const value: ConditionalValue | null =
    entry?.type === 'status' ? { type: 'status', value: { id: entry.value.id } } : null;

  return (
    <StatusValuePicker
      column={column}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        if (!next) onChange(null);
        else if (next.type === 'status') {
          onChange({ type: 'status', value: { id: next.value.id } });
        }
      }}
    />
  );
}

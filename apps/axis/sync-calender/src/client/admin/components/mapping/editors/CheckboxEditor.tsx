import { Toggle } from '@vibe/core';
import type { Column, ColumnMappingEntry } from '../../../types';

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

export function CheckboxEditor({ entry, column: _column, disabled, onChange }: Props) {
  const checked = entry?.type === 'checkbox' ? entry.value : false;

  return (
    <Toggle
      size="small"
      isSelected={checked}
      disabled={disabled}
      onOverrideText="Checked"
      offOverrideText="Unchecked"
      onChange={(value) => {
        onChange({ type: 'checkbox', value });
      }}
      ariaLabel="Toggle checkbox value"
    />
  );
}

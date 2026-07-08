import { Dropdown } from '@vibe/core';
import type { Column } from '../../types';

interface Option { value: string; label: string }

interface Props {
  columns: Column[];
  value: string | null;
  onChange: (columnId: string | null) => void;
  typeFilter?: (c: Column) => boolean;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
}

export function ColumnPicker({ columns, value, onChange, typeFilter, placeholder, disabled, clearable = true }: Props) {
  const filtered = typeFilter ? columns.filter(typeFilter) : columns;
  const options: Option[] = filtered.map((c) => ({ value: c.id, label: c.title }));
  const selected = options.find((o) => o.value === (value ?? '')) || null;
  return (
    <Dropdown
      placeholder={placeholder || 'Choose a column…'}
      options={options}
      value={selected}
      disabled={disabled}
      searchable
      clearable={clearable}
      onChange={(opt) => onChange((opt as Option | null)?.value || null)}
    />
  );
}

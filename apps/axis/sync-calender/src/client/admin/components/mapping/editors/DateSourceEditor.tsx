import { Dropdown } from '@vibe/core';
import type { Column, ColumnMappingEntry } from '../../../types';

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

type DateSource = 'startDate' | 'endDate';

interface DateOption {
  value: DateSource;
  label: string;
}

const DATE_OPTIONS: DateOption[] = [
  { value: 'startDate', label: 'Start date' },
  { value: 'endDate', label: 'End date' },
];

export function DateSourceEditor({ entry, column: _column, disabled, onChange }: Props) {
  const currentSource: DateSource =
    entry?.type === 'date' ? entry.source : 'startDate';

  const selectedOption = DATE_OPTIONS.find((o) => o.value === currentSource) ?? DATE_OPTIONS[0];

  return (
    <Dropdown
      size="small"
      options={DATE_OPTIONS}
      value={selectedOption}
      disabled={disabled}
      onChange={(opt) => {
        const picked = opt as DateOption | null;
        if (picked) onChange({ type: 'date', source: picked.value });
        else onChange(null);
      }}
    />
  );
}

import { Dropdown, Text } from '@vibe/core';
import { parseDropdownLabels } from '../../../lib/columnSettings';
import type { Column, ColumnMappingEntry } from '../../../types';

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

interface DropdownOption {
  value: number;
  label: string;
}

export function DropdownLabelEditor({ entry, column, disabled, onChange }: Props) {
  const labels = parseDropdownLabels(column);

  if (labels.length === 0) {
    return <Text type="text2" color="secondary">No dropdown options on this column.</Text>;
  }

  const options: DropdownOption[] = labels.map((l) => ({
    value: l.id,
    label: l.name,
  }));

  const selectedIds: number[] =
    entry?.type === 'dropdown' ? entry.value.ids : [];

  const selectedOptions = options.filter((o) => selectedIds.includes(o.value));

  return (
    <Dropdown
      size="small"
      options={options}
      value={selectedOptions.length > 0 ? selectedOptions : null}
      disabled={disabled}
      multi
      clearable
      placeholder="Pick options…"
      onChange={(opts) => {
        const picked = opts as DropdownOption[] | null;
        if (!picked || picked.length === 0) {
          onChange(null);
        } else {
          onChange({ type: 'dropdown', value: { ids: picked.map((o) => o.value) } });
        }
      }}
    />
  );
}

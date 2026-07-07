import { Dropdown } from '@vibe/core';
import { parseBoardRelationBoards } from '../../lib/columnSettings';
import { useLinkedBoardItems } from '../../hooks/useLinkedBoardItems';
import type { Column, ConditionalValue } from '../../types';

interface Props {
  column: Column;
  value: ConditionalValue | null;
  disabled?: boolean;
  onChange: (next: ConditionalValue | null) => void;
}

export function BoardRelationValuePicker({ column, value, disabled, onChange }: Props) {
  const linkedBoards = parseBoardRelationBoards(column);
  const { items, loading } = useLinkedBoardItems(linkedBoards, !disabled);

  if (linkedBoards.length === 0) {
    return <span style={{ color: '#676879', fontSize: 12 }}>This column has no linked board.</span>;
  }

  const options = items.map((it) => ({ value: Number(it.id), label: it.name }));
  const currentId = value?.type === 'board_relation' ? value.value.itemId : null;
  const selected = currentId !== null ? options.find((o) => o.value === currentId) ?? null : null;

  return (
    <Dropdown
      size="small"
      options={options}
      value={selected}
      disabled={disabled}
      clearable
      searchable
      menuPlacement="auto"
      menuPosition="fixed"
      placeholder={loading ? 'Loading items…' : 'Pick an item…'}
      onChange={(opt: unknown) => {
        const picked = opt as { value: number } | null;
        if (!picked) onChange(null);
        else onChange({ type: 'board_relation', value: { itemId: picked.value } });
      }}
    />
  );
}

import { useMemo } from 'react';
import { Button, Dropdown } from '@vibe/core';
import { Update } from '@vibe/icons';
import { useBoards } from '../../hooks/useBoards';
import type { Board } from '../../types';

interface Option { value: string; label: string }

interface Props {
  value: string | null;
  onChange: (boardId: string | null, board?: Board) => void;
  disabled?: boolean;
  tokenReady: boolean;
}

export function BoardPicker({ value, onChange, disabled, tokenReady }: Props) {
  const { boards, loading, error, refetch } = useBoards(tokenReady);

  // If the saved boardId isn't in the loaded list, surface it as a single
  // synthetic option so the user always sees what's currently selected — even
  // when the Monday API call is failing (or the saved board is no longer
  // visible to the current user).
  const options: Option[] = useMemo(() => {
    const fromBoards: Option[] = boards.map((b) => ({ value: String(b.id), label: b.name }));
    const sel = value ? String(value) : '';
    if (sel && !fromBoards.some((o) => o.value === sel)) {
      fromBoards.unshift({ value: sel, label: `Saved board · ${sel}` });
    }
    return fromBoards;
  }, [boards, value]);

  const selected = options.find((o) => o.value === String(value ?? '')) || null;

  const placeholder = loading
    ? 'Loading boards…'
    : error
    ? 'Failed to load boards'
    : 'Choose a board…';

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Dropdown
          placeholder={placeholder}
          options={options}
          value={selected}
          disabled={disabled}
          searchable
          clearable
          onChange={(opt) => {
            const v = (opt as Option | null)?.value || null;
            onChange(v, boards.find((b) => String(b.id) === v));
          }}
        />
        {error && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--negative-color)' }}>
            {error}
          </p>
        )}
      </div>
      {(error || !loading) && (
        <Button
          size="small"
          kind="tertiary"
          leftIcon={Update}
          onClick={refetch}
          disabled={disabled || loading}
          title="Reload boards"
        >
          {loading ? 'Reloading…' : 'Reload'}
        </Button>
      )}
    </div>
  );
}

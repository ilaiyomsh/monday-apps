import { Dropdown, Flex, Toggle } from '@vibe/core';
import { defaultEntryFor } from '../../../lib/mappingEntry';
import { SOURCE_FIELD_LABELS, SOURCE_FIELDS_ORDERED } from '../../../lib/sourceFields';
import type { Column, ColumnMappingEntry, SourceField } from '../../../types';

interface Props {
  entry: ColumnMappingEntry | null;
  column: Column;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

interface SourceOption {
  value: SourceField;
  label: string;
}

const SOURCE_OPTIONS: SourceOption[] = SOURCE_FIELDS_ORDERED.map((f) => ({
  value: f,
  label: SOURCE_FIELD_LABELS[f],
}));

function resolveEntry(entry: ColumnMappingEntry | null): Extract<ColumnMappingEntry, { type: 'numbers' }> {
  if (entry?.type === 'numbers') return entry;
  const d = defaultEntryFor('numbers');
  // defaultEntryFor('numbers') always returns a numbers entry
  return d as Extract<ColumnMappingEntry, { type: 'numbers' }>;
}

export function NumberEditor({ entry, column: _column, disabled, onChange }: Props) {
  const resolved = resolveEntry(entry);
  const isSource = resolved.kind === 'source';

  const toggleKind = (toSource: boolean) => {
    if (toSource) {
      onChange({ type: 'numbers', kind: 'source', source: 'duration' });
    } else {
      onChange({ type: 'numbers', kind: 'literal', value: '' });
    }
  };

  const currentSource: SourceField = resolved.kind === 'source' ? resolved.source : 'duration';
  const selectedSourceOption = SOURCE_OPTIONS.find((o) => o.value === currentSource) ?? SOURCE_OPTIONS[0];

  const literalValue = resolved.kind === 'literal' ? String(resolved.value) : '';

  return (
    <Flex gap="small" align="center">
      <Toggle
        size="small"
        isSelected={isSource}
        disabled={disabled}
        onOverrideText="Field"
        offOverrideText="Value"
        onChange={(checked) => toggleKind(checked)}
        ariaLabel="Toggle between literal value and source field"
      />
      {isSource ? (
        <div style={{ flex: 1, minWidth: 200 }}>
          <Dropdown
            size="small"
            options={SOURCE_OPTIONS}
            value={selectedSourceOption}
            disabled={disabled}
            onChange={(opt) => {
              const picked = opt as SourceOption | null;
              if (picked) onChange({ type: 'numbers', kind: 'source', source: picked.value });
              else onChange(null);
            }}
          />
        </div>
      ) : (
        <input
          type="text"
          inputMode="decimal"
          value={literalValue}
          disabled={disabled}
          placeholder="e.g. 42"
          style={{
            width: 80,
            padding: '4px 8px',
            fontSize: 13,
            border: '1px solid var(--layout-border-color, #e6e9ef)',
            borderRadius: 4,
            color: 'inherit',
            background: disabled ? 'var(--disabled-background-color, #f5f6f8)' : 'transparent',
          }}
          onChange={(e) => {
            onChange({ type: 'numbers', kind: 'literal', value: e.target.value });
          }}
        />
      )}
    </Flex>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@vibe/core';
import type { Column } from '../../types';

// Column types eligible for conditional value overrides. Keep in sync with
// ConditionalValue union in src/client/admin/types/index.ts and the server-side
// validator in src/helpers/conditionals-validator.js.
const ELIGIBLE_TYPES = new Set(['status', 'board_relation']);

interface Props {
  columns: Column[];
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

export function EligibleColumnsPicker({ columns, value, disabled, onChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(value));
  const timer = useRef<number | null>(null);
  const lastSerialized = useRef<string>(JSON.stringify([...value].sort()));
  // Tracks the cleaned set we already sent to the server so a transient save
  // failure (server still returning the dirty value) doesn't loop.
  const cleanupSentRef = useRef<string | null>(null);

  const supported = useMemo(
    () => columns.filter((c) => ELIGIBLE_TYPES.has(c.type)),
    [columns]
  );

  // When `value` or `columns` change, drop IDs whose column isn't on this
  // board (orphans from a previous board) and persist the cleanup once.
  // Without this, switching boards leaves stale IDs in the saved policy
  // because the picker only renders rows for columns it knows about — the
  // user can't see or toggle the orphans, but they survive every save.
  useEffect(() => {
    if (columns.length === 0) {
      setSelected(new Set(value));
      lastSerialized.current = JSON.stringify([...value].sort());
      return;
    }
    const supportedIds = new Set(supported.map((c) => c.id));
    const cleaned = [...value].filter((id) => supportedIds.has(id)).sort();
    if (cleaned.length === value.length) {
      cleanupSentRef.current = null;
      setSelected(new Set(value));
      lastSerialized.current = JSON.stringify([...value].sort());
      return;
    }
    const cleanedKey = JSON.stringify(cleaned);
    setSelected(new Set(cleaned));
    lastSerialized.current = cleanedKey;
    if (cleanupSentRef.current !== cleanedKey) {
      cleanupSentRef.current = cleanedKey;
      onChange(cleaned);
    }
  }, [value, columns, supported, onChange]);

  const scheduleSave = (next: Set<string>) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const arr = [...next].sort();
      const serialized = JSON.stringify(arr);
      if (serialized === lastSerialized.current) return;
      lastSerialized.current = serialized;
      onChange(arr);
    }, 500);
  };

  const toggle = (colId: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(colId)) next.delete(colId);
    else next.add(colId);
    setSelected(next);
    scheduleSave(next);
  };

  if (supported.length === 0) {
    return (
      <Text type="text2" color="secondary">
        No status or connect-boards columns on this board — nothing to enable.
      </Text>
    );
  }

  return (
    <div>
      <Text type="text2" color="secondary" element="div" style={{ marginBottom: 8 }}>
        Columns a user may override via their Conditions. Only status and connect-boards columns are supported in v1.
      </Text>
      <div style={{ display: 'grid', gap: 6 }}>
        {supported.map((col) => {
          const isOn = selected.has(col.id);
          return (
            <label
              key={col.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                border: '1px solid #e6e9ef',
                borderRadius: 4,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                background: isOn ? 'rgba(85, 89, 223, 0.04)' : '#fff',
              }}
            >
              <input
                type="checkbox"
                checked={isOn}
                disabled={disabled}
                onChange={() => toggle(col.id)}
                style={{ cursor: 'inherit' }}
              />
              <strong style={{ fontSize: 13 }}>{col.title}</strong>
              <TypePill type={col.type} />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TypePill({ type }: { type: string }) {
  return (
    <span
      style={{
        marginLeft: 'auto',
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: '#eef1fa',
        color: '#5559df',
      }}
    >
      {type}
    </span>
  );
}

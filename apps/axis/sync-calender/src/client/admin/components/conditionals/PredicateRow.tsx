import { useMemo } from 'react';
import { Dropdown, IconButton, TextField } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import type { Predicate, PredicateField, PredicateOp } from '../../types';

interface Props {
  predicate: Predicate;
  disabled?: boolean;
  leadingSlot?: React.ReactNode;
  onChange: (next: Predicate) => void;
  onRemove: () => void;
}

interface FieldOption { value: PredicateField; label: string; }
interface OpOption { value: PredicateOp; label: string; }

const FIELD_OPTIONS: FieldOption[] = [
  { value: 'attendee_email', label: 'Attendee email' },
  { value: 'event_title', label: 'Event title' },
  { value: 'description', label: 'Description' },
  { value: 'location', label: 'Location' },
];

const OPS_BY_FIELD: Record<PredicateField, OpOption[]> = {
  attendee_email: [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
    { value: 'domain', label: 'domain is' },
  ],
  event_title: [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
    { value: 'regex', label: 'matches regex' },
  ],
  description: [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
  ],
  location: [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
  ],
};

function placeholderFor(field: PredicateField, op: PredicateOp): string {
  if (field === 'attendee_email') {
    if (op === 'domain') return 'google.com';
    return 'alice@example.com';
  }
  if (op === 'regex') return '^Q\\d';
  return '';
}

// Allow switching field while preserving the value; coerce op to a valid one.
function switchField(p: Predicate, nextField: PredicateField): Predicate {
  const ops = OPS_BY_FIELD[nextField];
  const keepOp = ops.some((o) => o.value === p.op) ? p.op : ops[0].value;
  return { field: nextField, op: keepOp, value: p.value } as Predicate;
}

export function PredicateRow({ predicate, disabled, leadingSlot, onChange, onRemove }: Props) {
  const opOptions = OPS_BY_FIELD[predicate.field];
  const fieldOption = FIELD_OPTIONS.find((f) => f.value === predicate.field) ?? FIELD_OPTIONS[0];
  const opOption = opOptions.find((o) => o.value === predicate.op) ?? opOptions[0];

  const regexInvalid = useMemo(() => {
    if (predicate.field !== 'event_title' || predicate.op !== 'regex') return false;
    try { new RegExp(predicate.value); return false; } catch { return true; }
  }, [predicate.field, predicate.op, predicate.value]);

  return (
    <div className="predicate-row">
      {leadingSlot ?? <span />}
      <Dropdown
        size="small"
        options={FIELD_OPTIONS}
        value={fieldOption}
        disabled={disabled}
        clearable={false}
        menuPlacement="auto"
        menuPosition="fixed"
        onChange={(opt: unknown) => {
          const o = opt as FieldOption | null;
          if (o) onChange(switchField(predicate, o.value));
        }}
      />
      <Dropdown
        size="small"
        options={opOptions}
        value={opOption}
        disabled={disabled}
        clearable={false}
        menuPlacement="auto"
        menuPosition="fixed"
        onChange={(opt: unknown) => {
          const o = opt as OpOption | null;
          if (o) onChange({ ...predicate, op: o.value } as Predicate);
        }}
      />
      <TextField
        size={TextField.sizes.SMALL}
        value={predicate.value}
        placeholder={placeholderFor(predicate.field, predicate.op)}
        disabled={disabled}
        validation={regexInvalid ? { status: 'error', text: 'Invalid regex' } : undefined}
        onChange={(v: string) => onChange({ ...predicate, value: v } as Predicate)}
      />
      <IconButton
        icon={CloseSmall}
        kind="tertiary"
        size="small"
        disabled={disabled}
        onClick={onRemove}
        ariaLabel="Remove predicate"
      />
    </div>
  );
}

import { Chips, ExpandCollapse, IconButton, TextField } from '@vibe/core';
import { Delete, Duplicate, MoveArrowUp, MoveArrowDown } from '@vibe/icons';
import { RuleList } from './RuleList';
import { ValueSection } from './ValueSection';
import { parseStatusLabels } from '../../lib/columnSettings';
import type { Column, Conditional, ConditionalAction, ConditionalValue, Predicate } from '../../types';

const FIELD_LABEL: Record<Predicate['field'], string> = {
  attendee_email: 'attendee email',
  event_title: 'event title',
  description: 'description',
  location: 'location',
};

const OP_LABEL: Record<string, string> = {
  equals: 'equals',
  contains: 'contains',
  regex: 'matches',
  domain: 'has domain',
};

function describePredicateChip(p: Predicate): string {
  const field = FIELD_LABEL[p.field];
  const op = OP_LABEL[p.op] ?? p.op;
  const val = p.value || '…';
  return `${field} ${op} "${val}"`;
}

function describeValueChip(col: Column, v: ConditionalValue): string {
  if (v.type === 'status') {
    const labels = parseStatusLabels(col);
    const hit = labels.find((l) => l.id === v.value.id);
    return `${col.title} = ${hit?.label || `status ${v.value.id}`}`;
  }
  return `${col.title} = ${v.value.itemId ? `#${v.value.itemId}` : 'linked item'}`;
}

interface HeaderSentenceProps {
  conditional: Conditional;
  variant: ConditionalAction;
  eligibleColumns: Column[];
}

function RuleHeaderSentence({ conditional, variant, eligibleColumns }: HeaderSentenceProps) {
  const { predicates, operator, values } = conditional;
  const predChips = predicates.map(describePredicateChip);
  const overrideChips = Object.entries(values)
    .map(([colId, v]) => {
      const col = eligibleColumns.find((c) => c.id === colId);
      if (!col) return null;
      return describeValueChip(col, v);
    })
    .filter(Boolean) as string[];

  if (predChips.length === 0 && overrideChips.length === 0) {
    return (
      <span style={{ color: 'var(--secondary-text-color)', fontSize: 14 }}>
        New {variant === 'skip' ? 'skip' : 'override'} rule — add predicates and values.
      </span>
    );
  }

  const lead = variant === 'skip' ? 'Skip when' : 'When';

  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <strong>{lead}</strong>
      {predChips.length === 0 ? (
        <em style={{ color: 'var(--secondary-text-color)', fontStyle: 'normal' }}>(no predicates yet)</em>
      ) : (
        predChips.map((txt, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && (
              <span style={{ color: 'var(--secondary-text-color)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {operator}
              </span>
            )}
            <Chips label={txt} color="primary" readOnly noAnimation />
          </span>
        ))
      )}
      {variant === 'override' && (
        <>
          <strong>set</strong>
          {overrideChips.length === 0 ? (
            <em style={{ color: 'var(--secondary-text-color)', fontStyle: 'normal' }}>(no column values)</em>
          ) : (
            overrideChips.map((txt, i) => (
              <Chips key={i} label={txt} color="positive" readOnly noAnimation />
            ))
          )}
        </>
      )}
    </span>
  );
}

interface Props {
  conditional: Conditional;
  variant: ConditionalAction;
  eligibleColumns: Column[];
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: Conditional) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ConditionalCard({
  conditional,
  variant,
  eligibleColumns,
  disabled,
  canMoveUp,
  canMoveDown,
  open,
  onOpenChange,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {

  const setName = (name: string) => onChange({ ...conditional, name });
  const setOperator = (operator: 'AND' | 'OR') => onChange({ ...conditional, operator });
  const setPredicates = (predicates: Predicate[]) => onChange({ ...conditional, predicates });
  const setValues = (values: Record<string, ConditionalValue>) => onChange({ ...conditional, values });

  return (
    <div
      style={{
        border: '1px solid #e6e9ef',
        borderRadius: 6,
        background: '#fff',
      }}
    >
      <ExpandCollapse
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' }}>
            {conditional.name && (
              <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{conditional.name}</strong>
            )}
            {conditional.name && (
              <span style={{ color: 'var(--secondary-text-color)' }}>·</span>
            )}
            <RuleHeaderSentence
              conditional={conditional}
              variant={variant}
              eligibleColumns={eligibleColumns}
            />
          </div>
        }
        open={open}
        onClick={() => onOpenChange(!open)}
        hideBorder
      >
        <div style={{ display: 'grid', gap: 16, padding: '0 8px 12px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <TextField
                title="Name"
                size={TextField.sizes.SMALL}
                value={conditional.name}
                placeholder="e.g. Project A"
                disabled={disabled}
                onChange={setName}
              />
            </div>
            <IconButton
              icon={MoveArrowUp}
              kind="tertiary"
              size="small"
              disabled={disabled || !canMoveUp}
              onClick={onMoveUp}
              ariaLabel="Move up"
            />
            <IconButton
              icon={MoveArrowDown}
              kind="tertiary"
              size="small"
              disabled={disabled || !canMoveDown}
              onClick={onMoveDown}
              ariaLabel="Move down"
            />
            <IconButton
              icon={Duplicate}
              kind="tertiary"
              size="small"
              disabled={disabled}
              onClick={onDuplicate}
              ariaLabel="Duplicate"
            />
            <IconButton
              icon={Delete}
              kind="tertiary"
              size="small"
              disabled={disabled}
              onClick={onDelete}
              ariaLabel="Delete"
            />
          </div>

          <RuleList
            operator={conditional.operator}
            predicates={conditional.predicates}
            disabled={disabled}
            onOperatorChange={setOperator}
            onPredicatesChange={setPredicates}
          />

          {variant === 'override' && (
            <div style={{ borderTop: '1px solid var(--layout-border-color)', paddingTop: 12 }}>
              <ValueSection
                eligibleColumns={eligibleColumns}
                values={conditional.values || {}}
                disabled={disabled}
                onChange={setValues}
              />
            </div>
          )}
        </div>
      </ExpandCollapse>
    </div>
  );
}

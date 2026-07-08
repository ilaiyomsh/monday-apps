import { Button, Text } from '@vibe/core';
import { PredicateRow } from './PredicateRow';
import type { Predicate } from '../../types';

interface Props {
  operator: 'AND' | 'OR';
  predicates: Predicate[];
  disabled?: boolean;
  onOperatorChange: (op: 'AND' | 'OR') => void;
  onPredicatesChange: (next: Predicate[]) => void;
}

function newPredicate(): Predicate {
  return { field: 'event_title', op: 'contains', value: '' };
}

export function RuleList({
  operator,
  predicates,
  disabled,
  onOperatorChange,
  onPredicatesChange,
}: Props) {
  const setAt = (i: number, next: Predicate) => {
    const arr = predicates.slice();
    arr[i] = next;
    onPredicatesChange(arr);
  };
  const removeAt = (i: number) => {
    const arr = predicates.slice();
    arr.splice(i, 1);
    onPredicatesChange(arr);
  };
  const add = () => onPredicatesChange([...predicates, newPredicate()]);
  const toggleOp = () => onOperatorChange(operator === 'AND' ? 'OR' : 'AND');

  return (
    <div className="cond-predicates">
      <div className="cond-predicates-head">
        <span className="cond-caps-title">Predicates</span>
        <span className="cond-caps-meta">
          First match wins · {operator} between predicates
        </span>
      </div>

      {predicates.length === 0 ? (
        <Text type="text2" color="secondary">
          No conditions yet — add one to control when this rule matches.
        </Text>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {predicates.map((p, i) => (
            <PredicateRow
              key={i}
              predicate={p}
              disabled={disabled}
              leadingSlot={
                i === 0 ? (
                  <span className="predicate-when">WHEN</span>
                ) : (
                  <button
                    type="button"
                    className="predicate-connector"
                    disabled={disabled}
                    onClick={toggleOp}
                    title={`Toggle to ${operator === 'AND' ? 'OR' : 'AND'}`}
                  >
                    {operator}
                  </button>
                )
              }
              onChange={(next) => setAt(i, next)}
              onRemove={() => removeAt(i)}
            />
          ))}
        </div>
      )}

      <div>
        <Button size="small" kind="tertiary" disabled={disabled} onClick={add}>
          + Add predicate
        </Button>
      </div>
    </div>
  );
}

import { parseStatusLabels } from '../../lib/columnSettings';
import type { Column, Conditional, ConditionalAction, Predicate } from '../../types';

interface Props {
  conditional: Conditional;
  variant: ConditionalAction;
  eligibleColumns: Column[];
}

const FIELD_LABEL: Record<Predicate['field'], string> = {
  attendee_email: 'attendee email',
  event_title: 'event title',
  description: 'description',
  location: 'location',
};

const OP_LABEL: Record<string, string> = {
  equals: 'equals',
  contains: 'contains',
  regex: 'matches regex',
  domain: 'has domain',
};

function describePredicate(p: Predicate): string {
  return `${FIELD_LABEL[p.field]} ${OP_LABEL[p.op] ?? p.op} "${p.value || '…'}"`;
}

function describeValue(col: Column, v: Conditional['values'][string]): string {
  if (v.type === 'status') {
    const labels = parseStatusLabels(col);
    const hit = labels.find((l) => l.id === v.value.id);
    return hit?.label || `status ${v.value.id}`;
  }
  return v.value.itemId ? `item #${v.value.itemId}` : 'linked item';
}

export function ConditionalSentence({ conditional, variant, eligibleColumns }: Props) {
  const { predicates, operator, values } = conditional;
  if (predicates.length === 0 && Object.keys(values).length === 0) return null;

  const predParts = predicates.map((p) => describePredicate(p));

  if (variant === 'skip') {
    return (
      <div className="cond-sentence">
        <strong>Skip </strong>events where{' '}
        {predParts.map((txt, i) => (
          <span key={i}>
            {i > 0 && <em> {operator} </em>}
            {txt}
          </span>
        ))}
        .
      </div>
    );
  }

  const overrideParts = Object.entries(values).map(([colId, v]) => {
    const col = eligibleColumns.find((c) => c.id === colId);
    const label = col ? describeValue(col, v) : '—';
    return { title: col?.title || colId, label };
  });

  return (
    <div className="cond-sentence">
      <strong>When </strong>
      {predParts.length === 0 ? (
        <span>(no predicates)</span>
      ) : (
        predParts.map((txt, i) => (
          <span key={i}>
            {i > 0 && <em> {operator} </em>}
            {txt}
          </span>
        ))
      )}
      {overrideParts.length > 0 ? (
        <>
          , <strong>set </strong>
          {overrideParts.map((o, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {o.title} = <em>{o.label}</em>
            </span>
          ))}
        </>
      ) : (
        <>, <strong>set </strong>no overrides yet.</>
      )}
    </div>
  );
}

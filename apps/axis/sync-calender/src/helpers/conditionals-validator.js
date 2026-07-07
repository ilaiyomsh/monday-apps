// Validator for per-user Conditional override rules. Runs on PATCH
// /api/configs/:configId before persisting. Returns { ok: true } or
// { ok: false, index?, error }.
//
// Shape (matches src/client/admin/types/index.ts):
//   Conditional = {
//     id: string,
//     name: string,
//     operator: 'AND' | 'OR',
//     predicates: Predicate[],
//     values: Record<columnId, ConditionalValue>,
//   }

const FIELD_OPS = {
  attendee_email: new Set(['equals', 'contains', 'domain']),
  event_title: new Set(['equals', 'contains', 'regex']),
  description: new Set(['contains', 'equals']),
  location: new Set(['contains', 'equals']),
};

const VALUE_TYPES = new Set(['status', 'board_relation']);

function validatePredicate(p) {
  if (!p || typeof p !== 'object') return 'predicate must be an object';
  const ops = FIELD_OPS[p.field];
  if (!ops) return `unknown predicate field "${p.field}"`;
  if (!ops.has(p.op)) return `op "${p.op}" not allowed for field "${p.field}"`;
  if (typeof p.value !== 'string' || p.value === '') return 'predicate value must be a non-empty string';
  if (p.field === 'event_title' && p.op === 'regex') {
    try { new RegExp(p.value); } catch (e) { return `invalid regex: ${e.message}`; }
  }
  return null;
}

function validateValue(v) {
  if (!v || typeof v !== 'object') return 'value must be an object';
  if (!VALUE_TYPES.has(v.type)) return `unknown value type "${v.type}"`;
  if (v.type === 'status') {
    // Accept new `id` and legacy `index` — same stable label identifier.
    const id = v.value?.id ?? v.value?.index;
    if (!Number.isInteger(id) || id < 0) return 'status id must be a non-negative integer';
    return null;
  }
  if (v.type === 'board_relation') {
    const id = v.value?.itemId;
    if (!Number.isInteger(id) || id <= 0) return 'board_relation itemId must be a positive integer';
    return null;
  }
  return `unhandled value type "${v.type}"`;
}

const ACTIONS = new Set(['override', 'skip']);

function validateConditional(c) {
  if (!c || typeof c !== 'object') return 'conditional must be an object';
  if (typeof c.id !== 'string' || !c.id) return 'conditional.id is required';
  if (typeof c.name !== 'string') return 'conditional.name must be a string';
  const action = c.action ?? 'override';
  if (!ACTIONS.has(action)) return `action must be one of ${[...ACTIONS].join(', ')}`;
  if (c.operator !== 'AND' && c.operator !== 'OR') return 'operator must be AND or OR';
  if (!Array.isArray(c.predicates)) return 'predicates must be an array';
  for (let i = 0; i < c.predicates.length; i++) {
    const err = validatePredicate(c.predicates[i]);
    if (err) return `predicates[${i}]: ${err}`;
  }
  if (action === 'skip') {
    // Skip rules never write columns; reject stray values so the UI contract
    // and persisted shape stay in sync.
    if (c.values != null && (typeof c.values !== 'object' || Object.keys(c.values).length > 0)) {
      return 'skip rules must not define values';
    }
    return null;
  }
  if (c.values == null || typeof c.values !== 'object' || Array.isArray(c.values)) {
    return 'values must be an object';
  }
  for (const [columnId, value] of Object.entries(c.values)) {
    const err = validateValue(value);
    if (err) return `values["${columnId}"]: ${err}`;
  }
  return null;
}

export function validateConditionals(list) {
  if (list == null) return { ok: true };
  if (!Array.isArray(list)) return { ok: false, error: 'conditionals must be an array' };
  const seenIds = new Set();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const err = validateConditional(c);
    if (err) return { ok: false, index: i, error: err };
    if (seenIds.has(c.id)) return { ok: false, index: i, error: `duplicate id "${c.id}"` };
    seenIds.add(c.id);
  }
  return { ok: true };
}

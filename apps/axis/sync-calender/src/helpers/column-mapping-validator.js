// Per-type tabular validator for ColumnMappingEntry. Runs on PATCH /api/policy
// before persisting. Returns { ok: true } or { ok: false, columnId?, error }.
//
// During the T1–T7 migration the validator accepts both shapes:
//   - legacy string ("eventName" | "startDate" | …)
//   - new ColumnMappingEntry object
// T7 will tighten this once the UI no longer produces the legacy shape.

const VALID_SOURCES = new Set([
  'eventName',
  'startDate',
  'endDate',
  'description',
  'duration',
  'eventLink',
]);

function validateTokens(tokens) {
  if (!Array.isArray(tokens)) return 'tokens must be an array';
  for (const t of tokens) {
    if (!t || typeof t !== 'object') return 'token must be an object';
    if (t.kind === 'text') {
      if (typeof t.value !== 'string') return 'text token value must be a string';
    } else if (t.kind === 'var') {
      if (!VALID_SOURCES.has(t.value)) return `unknown var "${t.value}"`;
    } else {
      return `unknown token kind "${t.kind}"`;
    }
  }
  return null;
}

function validateEntry(entry) {
  // Legacy string shape: bare source name. Empty string also tolerated (the
  // renderer treats it as "skip" — same behavior as the historical code path).
  if (typeof entry === 'string') {
    if (entry === '') return null;
    return VALID_SOURCES.has(entry) ? null : `unknown legacy source "${entry}"`;
  }

  // Old { source } / { literal } objects from before T1. Tolerated for now.
  if (entry && typeof entry === 'object' && !entry.type) {
    if (entry.source !== undefined) {
      return VALID_SOURCES.has(entry.source) ? null : `unknown source "${entry.source}"`;
    }
    if (entry.literal !== undefined) return null;
    return 'object entry needs type, source, or literal';
  }

  if (!entry || typeof entry !== 'object') {
    return 'entry must be a string or object';
  }

  switch (entry.type) {
    case 'text':
    case 'long_text':
    case 'email_simple':
    case 'phone_simple':
      return validateTokens(entry.tokens);

    case 'status': {
      // Accept new `id` and legacy `index` — same stable label identifier.
      const id = entry.value?.id ?? entry.value?.index;
      if (!Number.isInteger(id) || id < 0) {
        return 'status id must be a non-negative integer';
      }
      return null;
    }

    case 'dropdown': {
      const ids = entry.value?.ids;
      if (!Array.isArray(ids)) return 'dropdown ids must be an array';
      if (!ids.every((n) => Number.isInteger(n) && n >= 0)) {
        return 'dropdown ids must be non-negative integers';
      }
      return null;
    }

    case 'numbers':
      if (entry.kind === 'literal') {
        if (entry.value === null || entry.value === undefined) {
          return 'numbers literal value required';
        }
        if (typeof entry.value !== 'string' && typeof entry.value !== 'number') {
          return 'numbers literal must be a string or number';
        }
        return null;
      }
      if (entry.kind === 'source') {
        return VALID_SOURCES.has(entry.source) ? null : `unknown numbers source "${entry.source}"`;
      }
      return `unknown numbers kind "${entry.kind}"`;

    case 'date':
      return entry.source === 'startDate' || entry.source === 'endDate'
        ? null
        : 'date source must be startDate or endDate';

    case 'checkbox':
      return typeof entry.value === 'boolean' ? null : 'checkbox value must be boolean';

    default:
      return `unknown entry type "${entry.type}"`;
  }
}

export function validateColumnMapping(mapping) {
  if (mapping == null) return { ok: true };
  if (typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { ok: false, error: 'columnMapping must be an object' };
  }
  for (const [columnId, entry] of Object.entries(mapping)) {
    const err = validateEntry(entry);
    if (err) return { ok: false, columnId, error: err };
  }
  return { ok: true };
}

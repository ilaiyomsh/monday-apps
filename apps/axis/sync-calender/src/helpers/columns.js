// Column-value helpers for the Custom Object sync path. Converts a
// CanonicalEvent into monday-native column_values JSON shapes.
//
// Operates on canonical events (provider-agnostic). See
// src/services/providers/canonical-event.js for the shape.

// monday Date column rejects ISO datetime strings — it requires
// { date: "YYYY-MM-DD", time: "HH:MM:SS" } (UTC). All-day events come as
// YYYY-MM-DD and get passed through as { date } only.
export function toMondayDate(iso) {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

// Event duration in hours as a stringified decimal. Empty string for all-day
// events. Two-decimal precision, trailing zeros stripped.
export function eventDurationHours(event) {
  if (!event || event.isAllDay) return '';
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  const start = startIso ? new Date(startIso).getTime() : null;
  const end = endIso ? new Date(endIso).getTime() : null;
  if (!start || !end || end <= start) return '';
  const hours = (end - start) / (1000 * 60 * 60);
  return String(Number(hours.toFixed(2)));
}

// Resolve a canonical-field source key to a plain string (used for item name
// and any other scalar target). Date sources use the raw ISO string so the
// item name stays human-readable — monday Date columns still need the object
// form (handled in mapEventToColumns via toMondayDate).
export function resolveSourceAsString(event, source) {
  if (!event) return '';
  switch (source) {
    case 'eventName': return event.title || '';
    case 'description': return event.description || '';
    case 'eventLink': return event.externalUrl || '';
    case 'startDate': return event.start?.dateTime || '';
    case 'endDate': return event.end?.dateTime || '';
    case 'duration': return eventDurationHours(event);
    default: return '';
  }
}

// Concatenate a TemplateToken[] against an event. Plain text passes through;
// var tokens resolve via resolveSourceAsString.
export function joinTokens(tokens, event) {
  if (!Array.isArray(tokens)) return '';
  return tokens
    .map((t) => {
      if (!t || typeof t !== 'object') return '';
      if (t.kind === 'var') return resolveSourceAsString(event, t.value);
      return String(t.value ?? '');
    })
    .join('');
}

// Render one ColumnMappingEntry (new shape) into the column_value JS object
// monday expects. Returns `undefined` when the entry produces nothing useful
// (e.g. empty template) so mapEventToColumns can skip the column entirely.
export function renderColumnValue(entry, event) {
  if (!entry || typeof entry !== 'object' || !entry.type) return undefined;
  switch (entry.type) {
    case 'text':
    case 'email_simple':
    case 'phone_simple': {
      const s = joinTokens(entry.tokens, event);
      return s === '' ? undefined : s;
    }
    case 'long_text': {
      const s = joinTokens(entry.tokens, event);
      return s === '' ? undefined : { text: s };
    }
    case 'status': {
      // monday's write API names the field `index`, but the value is the
      // stable label id (the same number exposed as `id` in `Column.settings`).
      // We always store/read `value.id` — never the position.
      const id = entry.value?.id;
      return Number.isInteger(id) ? { index: id } : undefined;
    }
    case 'dropdown':
      return Array.isArray(entry.value?.ids) && entry.value.ids.length > 0
        ? { ids: entry.value.ids }
        : undefined;
    case 'board_relation': {
      const id = entry.value?.itemId;
      return Number.isInteger(id) && id > 0 ? { item_ids: [id] } : undefined;
    }
    case 'numbers':
      if (entry.kind === 'literal') {
        const v = entry.value;
        return v === '' || v === null || v === undefined ? undefined : String(v);
      }
      if (entry.kind === 'source') {
        const s = resolveSourceAsString(event, entry.source);
        return s === '' ? undefined : s;
      }
      return undefined;
    case 'date': {
      const iso = resolveSourceAsString(event, entry.source);
      const d = toMondayDate(iso);
      return d === '' ? undefined : d;
    }
    case 'checkbox':
      // monday clears a checkbox by sending {} (not {checked:'false'}).
      return entry.value ? { checked: 'true' } : {};
    default:
      return undefined;
  }
}

// Map a CanonicalEvent + instance policy + row owner into a monday
// column_values object ready for create_item / change_multiple_column_values.
//
// columnMapping accepts two shapes during the T1–T7 migration:
//   { [columnId]: "eventName" }                              — legacy string
//   { [columnId]: { type: "...", ... } }                     — new entry shape
// T7 narrows storage to the new shape only and the legacy branch can drop.
//
// policy.linkColumnId  — always written with event.externalUrl (text = url).
// policy.peopleColumnId — always written with row owner's monday user id.
export function mapEventToColumns(event, policy, rowOwnerMondayUserId) {
  const values = {};
  for (const [columnId, raw] of Object.entries(policy?.columnMapping || {})) {
    if (raw == null || raw === '') continue;
    let rendered;
    if (typeof raw === 'string') {
      const s = resolveSourceAsString(event, raw);
      rendered = s === '' ? undefined : s;
    } else if (typeof raw === 'object') {
      // Old { source } / { literal } shapes from before T1 fall through here.
      if (raw.type) {
        rendered = renderColumnValue(raw, event);
      } else if (raw.literal !== undefined) {
        rendered = raw.literal;
      } else if (raw.source) {
        const s = resolveSourceAsString(event, raw.source);
        rendered = s === '' ? undefined : s;
      }
    }
    if (rendered === undefined) continue;
    values[columnId] = rendered;
  }

  if (policy?.linkColumnId) {
    const link = event?.externalUrl || '';
    if (link) values[policy.linkColumnId] = { url: link, text: link };
  }

  if (policy?.peopleColumnId && rowOwnerMondayUserId) {
    values[policy.peopleColumnId] = {
      personsAndTeams: [{ id: Number(rowOwnerMondayUserId), kind: 'person' }],
    };
  }

  return values;
}

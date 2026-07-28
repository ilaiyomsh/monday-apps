/**
 * columnFields — ONE registry entry per monday column type that can serve as a
 * required field on a status transition. Adding a column type means adding a
 * record here; nothing else in the app enumerates column types.
 *
 * Each spec carries what a required field needs:
 *   control   — which form control renders it (see components/OnClickDialog/FieldControl)
 *   icon      — @vibe/icons component NAME for the field's label, and `iconTone`
 *               its background. This mirrors monday's own item form, which labels
 *               every row with the column's coloured icon. monday does not expose
 *               column-type icons or their colours through the API, so both are our
 *               approximation of its palette, resolved to components in FieldControl
 *               (kept as strings here so this module imports no React).
 *   fragment  — the typed GraphQL fragment its READ needs, or null when the
 *               ColumnValue interface's own `text`/`value` suffice
 *   prefill   — column_value  → form value
 *   serialize — form value    → change_multiple_column_values payload
 *   isEmpty   — form value    → "still unfilled?", the required-field gate
 *
 * `isEmpty` exists because the browser's `required` attribute cannot express
 * these types: an unchecked checkbox is a valid form value but an unfilled
 * required field, and a picker holds an array, not a string.
 *
 * SOURCE of the pattern: apps/discussions/src/utils/mondayApi/monday-client.js
 * (`TYPE_FRAGMENTS` / `cvSelection` / `parseValue` / `formatValue` /
 * `sanitizeColumnValues`) — the proven modular shape, adapted to one registry
 * so a type's read, write, control and emptiness rule sit together.
 *
 * Write formats follow the monday-api skill's references/column-formats.md;
 * read fragments were introspected against API 2026-04 (the version pinned in
 * services/mondayService.js), not guessed.
 */

import logger from '../utils/logger.js';

/* ------------------------------------------------------------------ helpers */

function asText(columnValue) {
  return typeof columnValue?.text === 'string' ? columnValue.text : '';
}

/**
 * Read one key out of a column value's stored JSON, falling back to the display
 * text. Used by the contact columns, whose typed fields we do not select.
 */
function fromStoredJson(columnValue, key) {
  const text = asText(columnValue);
  if (typeof columnValue?.value !== 'string' || columnValue.value === '') return text;
  try {
    const parsed = JSON.parse(columnValue.value);
    const found = parsed?.[key];
    return typeof found === 'string' && found !== '' ? found : text;
  } catch (err) {
    logger.warn('columnFields', `Corrupt stored JSON on a column value; falling back to text`, err);
    return text;
  }
}

function trimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isBlankString(value) {
  return trimmedString(value) === '';
}

function entryList(value) {
  return Array.isArray(value) ? value : [];
}

/* ------------------------------------------------------------------- specs */

const TEXTUAL_EMPTY = (value) => isBlankString(value);

const FIELD_SPECS = {
  text: {
    control: 'text',
    icon: 'Text',
    iconTone: '#ffcb00',
    fragment: null,
    prefill: (cv) => asText(cv),
    serialize: (value) => String(value ?? ''),
    isEmpty: TEXTUAL_EMPTY,
  },

  long_text: {
    control: 'textarea',
    icon: 'LongText',
    iconTone: '#ffcb00',
    fragment: null,
    prefill: (cv) => fromStoredJson(cv, 'text'),
    serialize: (value) => ({ text: String(value ?? '') }),
    isEmpty: TEXTUAL_EMPTY,
  },

  numbers: {
    control: 'number',
    icon: 'Numbers',
    iconTone: '#66ccff',
    fragment: null,
    prefill: (cv) => asText(cv),
    serialize: (value) => (isBlankString(value) ? '' : String(value)),
    isEmpty: TEXTUAL_EMPTY,
  },

  email: {
    control: 'email',
    icon: 'Email',
    iconTone: '#0086c0',
    fragment: null,
    prefill: (cv) => fromStoredJson(cv, 'email'),
    serialize: (value) => {
      const email = trimmedString(value);
      return email === '' ? {} : { email, text: email };
    },
    isEmpty: TEXTUAL_EMPTY,
  },

  phone: {
    control: 'phone',
    icon: 'Mobile',
    iconTone: '#0086c0',
    fragment: null,
    prefill: (cv) => fromStoredJson(cv, 'phone'),
    serialize: (value) => {
      const phone = trimmedString(value);
      // countryShortName is required by monday and fixed to IL — this app's
      // users are Israeli. Revisit when the app ships outside Israel.
      return phone === '' ? {} : { phone, countryShortName: 'IL' };
    },
    isEmpty: TEXTUAL_EMPTY,
  },

  link: {
    control: 'link',
    icon: 'Link',
    iconTone: '#0086c0',
    fragment: null,
    prefill: (cv) => fromStoredJson(cv, 'url'),
    serialize: (value) => {
      const url = trimmedString(value);
      return url === '' ? {} : { url, text: url };
    },
    isEmpty: TEXTUAL_EMPTY,
  },

  // Form value: { date: 'YYYY-MM-DD', time: 'HH:MM' } in LOCAL wall-clock time.
  // monday stores the time part in UTC, so both directions convert.
  date: {
    control: 'date',
    icon: 'Calendar',
    iconTone: '#a25ddc',
    fragment: '... on DateValue { date time }',
    // READ is NOT converted: probe-verified (board 18424030023, API 2026-04)
    // that DateValue.date/time already arrive in the ACCOUNT timezone — writing
    // UTC 2026-07-27 21:30:00 reads back as 2026-07-28 / 00:30. Converting here
    // too would shift the offset twice. The write side below IS UTC; the
    // asymmetry is monday's.
    prefill: (cv) => {
      const date = typeof cv?.date === 'string' ? cv.date.slice(0, 10) : '';
      if (!date) return { date: '', time: '' };
      const storedTime = typeof cv?.time === 'string' ? cv.time : '';
      return { date, time: storedTime.slice(0, 5) };
    },
    serialize: (value) => {
      const date = trimmedString(value?.date);
      if (date === '') return {};
      const time = trimmedString(value?.time);
      if (time === '') return { date };
      // BOTH parts must come from ONE instant: 00:30 local in Asia/Jerusalem
      // falls on the PREVIOUS UTC date, so a local date beside a UTC time
      // silently writes the wrong day.
      const [year, month, day] = date.split('-').map(Number);
      const [hour, minute] = time.split(':').map(Number);
      const instant = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
      if (Number.isNaN(instant.getTime())) return { date };
      const iso = instant.toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
    },
    isEmpty: (value) => isBlankString(value?.date),
  },

  // Form value: array of label id STRINGS. Written by id, never by typed text —
  // writing labels made a typo either fail the mutation or invent a new label.
  dropdown: {
    control: 'dropdown',
    icon: 'Dropdown',
    iconTone: '#ff642e',
    fragment: '... on DropdownValue { values { id label } }',
    prefill: (cv) => entryList(cv?.values)
      .map((option) => trimmedString(option?.id))
      .filter((id) => id !== ''),
    serialize: (value) => ({ ids: entryList(value).map(String) }),
    isEmpty: (value) => entryList(value).length === 0,
  },

  // Form value: array of { id, kind } — kind is 'person' or 'team'.
  people: {
    control: 'people',
    icon: 'Person',
    iconTone: '#00a9ff',
    fragment: '... on PeopleValue { persons_and_teams { id kind } }',
    prefill: (cv) => entryList(cv?.persons_and_teams)
      .map((entry) => ({
        id: trimmedString(entry?.id),
        kind: entry?.kind === 'team' ? 'team' : 'person',
      }))
      .filter((entry) => entry.id !== ''),
    serialize: (value) => ({
      personsAndTeams: entryList(value).map((entry) => ({
        id: Number(entry?.id),
        kind: entry?.kind === 'team' ? 'team' : 'person',
      })),
    }),
    isEmpty: (value) => entryList(value).length === 0,
  },

  checkbox: {
    control: 'checkbox',
    icon: 'Checkbox',
    iconTone: '#00c875',
    fragment: '... on CheckboxValue { checked }',
    prefill: (cv) => cv?.checked === true,
    // null is the ONLY shape that unchecks. Sending checked with a false string
    // CHECKS the box instead of clearing it — see references/column-formats.md.
    serialize: (value) => (value === true ? { checked: 'true' } : null),
    // A required checkbox must be CHECKED; unchecked is a valid form value but
    // an unfilled required field.
    isEmpty: (value) => value !== true,
  },

  // Form value: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } — date-only, no UTC
  // conversion (monday timeline columns carry no time part).
  timeline: {
    control: 'timeline',
    icon: 'Timeline',
    iconTone: '#a25ddc',
    fragment: '... on TimelineValue { from to }',
    // monday sends full ISO timestamps here (probe-verified:
    // "2026-07-01T00:00:00+00:00"), which a date input rejects — keep the day.
    prefill: (cv) => ({
      from: typeof cv?.from === 'string' ? cv.from.slice(0, 10) : '',
      to: typeof cv?.to === 'string' ? cv.to.slice(0, 10) : '',
    }),
    serialize: (value) => {
      const from = trimmedString(value?.from);
      const to = trimmedString(value?.to);
      // A half-entered range is not writable — isEmpty blocks it in the form,
      // and anything that still reaches here clears rather than corrupts.
      if (from === '' || to === '') return {};
      return { from, to };
    },
    isEmpty: (value) => isBlankString(value?.from) || isBlankString(value?.to),
  },

  // Form value: number of stars, or null when unrated. monday treats 0 as
  // unrated, so a required rating needs at least one star.
  rating: {
    control: 'rating',
    icon: 'Favorite',
    iconTone: '#fdab3d',
    fragment: '... on RatingValue { rating }',
    prefill: (cv) => (typeof cv?.rating === 'number' ? cv.rating : null),
    serialize: (value) => {
      const rating = Number(value);
      if (value === null || value === undefined || value === '' || !Number.isFinite(rating)) return {};
      return { rating };
    },
    isEmpty: (value) => value === null || value === undefined || value === '' || !(Number(value) > 0),
  },

  // Form value: the label id as a string. Label id 0 is a REAL label, so every
  // check here is null/blank-based, never truthiness.
  status: {
    control: 'status',
    icon: 'Status',
    iconTone: '#e2445c',
    fragment: '... on StatusValue { index }',
    prefill: (cv) => (typeof cv?.index === 'number' ? String(cv.index) : ''),
    serialize: (value) => {
      if (isBlankString(value)) return {};
      const index = Number(value);
      return Number.isFinite(index) ? { index } : {};
    },
    isEmpty: (value) => isBlankString(value),
  },
};

// monday reports a single-person column as `person`; same value type, same spec.
FIELD_SPECS.person = FIELD_SPECS.people;

/* ------------------------------------------------------- option-type settings */

/**
 * monday returns `Column.settings` as a JSON scalar, so the SDK usually hands us
 * an object — but a raw HTTP path can deliver the string. Tolerate both.
 */
function parseColumnSettings(settings) {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings;
  if (typeof settings !== 'string' || settings === '') return null;
  try {
    const parsed = JSON.parse(settings);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.warn('columnFields', 'Column settings were not parseable JSON', err);
    return null;
  }
}

/**
 * Selectable options of a dropdown column, in board order.
 *
 * Shape is probe-verified: `{ labels: [{ id, label, is_deactivated }] }` — the key
 * is `label`, NOT `name`, and the ids arrive as numbers here while the CELL's
 * values arrive as strings, so options are normalized to string ids to match the
 * form value.
 */
export function dropdownOptionsFrom(settings) {
  const labels = parseColumnSettings(settings)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label) => label?.is_deactivated !== true)
    .map((label) => ({
      id: trimmedString(label?.id),
      label: typeof label?.label === 'string' ? label.label : '',
    }))
    .filter((option) => option.id !== '');
}

/* --------------------------------------------------------------- public API */

export function getFieldSpec(type) {
  if (typeof type !== 'string' || type === '') return null;
  return Object.prototype.hasOwnProperty.call(FIELD_SPECS, type) ? FIELD_SPECS[type] : null;
}

export function isSupportedFormColumnType(type) {
  return getFieldSpec(type) !== null;
}

export function fieldControlFor(type) {
  return getFieldSpec(type)?.control ?? null;
}

/**
 * Build the leanest `column_values { ... }` selection that can be fed to
 * prefillFieldValue for the given column types. `column { ... settings }` is
 * always selected — the dropdown/status/rating controls read their options off
 * the column's settings.
 */
export function columnValuesSelection(types = []) {
  const fragments = [];
  entryList(types).forEach((type) => {
    const fragment = getFieldSpec(type)?.fragment;
    if (fragment && !fragments.includes(fragment)) fragments.push(fragment);
  });
  return ['id', 'type', 'text', 'value', 'column { id title type settings }', ...fragments].join(' ');
}

/** Selection covering every registered type — for a mixed, un-narrowed read. */
export const ALL_COLUMN_VALUE_FIELDS = columnValuesSelection(Object.keys(FIELD_SPECS));

export function prefillFieldValue(type, columnValue) {
  const spec = getFieldSpec(type);
  if (!spec) return '';
  if (!columnValue) {
    // An absent cell still needs that type's empty form value, or the control
    // mounts with the wrong value shape.
    return spec.prefill({});
  }
  return spec.prefill(columnValue);
}

export function serializeFieldValue(type, value) {
  const spec = getFieldSpec(type);
  if (!spec) {
    logger.warn('columnFields', `Refusing to serialize unsupported column type "${type}"`);
    return undefined;
  }
  return spec.serialize(value);
}

export function isFieldValueEmpty(type, value) {
  const spec = getFieldSpec(type);
  if (!spec) return true;
  return spec.isEmpty(value) === true;
}

/* --------------------------------------------------- write-payload sanitizer */

function sanitizeArrayField(value, key, mapEntry, keepEntry) {
  const raw = entryList(value[key]);
  const cleaned = raw.map(mapEntry).filter(keepEntry);
  // Had entries but none survived ⇒ the caller meant to write real data and all
  // of it was junk; omit the column rather than clear it by accident.
  if (raw.length > 0 && cleaned.length === 0) return undefined;
  return { ...value, [key]: cleaned };
}

/**
 * Sanitize ONE monday column value. Returns the value (possibly cleaned), or
 * `undefined` meaning "omit this column". Pure.
 *
 * This is the guard that turns a malformed payload into a skipped column
 * instead of a whole-mutation ColumnValueException — one bad people id would
 * otherwise fail the status transition too.
 */
export function sanitizeColumnValue(value) {
  // null (checkbox uncheck) and plain scalars (text/numbers) are intentional.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  if ('personsAndTeams' in value) {
    return sanitizeArrayField(
      value,
      'personsAndTeams',
      (entry) => entry,
      (entry) => entry !== null
        && entry !== undefined
        && Number.isFinite(Number(entry.id))
        && Number(entry.id) !== 0,
    );
  }

  if ('ids' in value) {
    return sanitizeArrayField(
      value,
      'ids',
      (id) => id,
      (id) => !isBlankString(id),
    );
  }

  if ('labels' in value) {
    return sanitizeArrayField(
      value,
      'labels',
      (label) => label,
      (label) => !isBlankString(label),
    );
  }

  // { index: N } — a NaN index serializes to null and monday rejects it. Label
  // id 0 is valid and kept.
  if ('index' in value) {
    return Number.isFinite(Number(value.index)) ? value : undefined;
  }

  if ('label' in value) {
    return isBlankString(value.label) ? undefined : value;
  }

  // date { date[, time] }, timeline { from, to }, checkbox { checked },
  // rating { rating }, and the empty {} used to clear all pass through.
  return value;
}

/** Sanitize a whole columnId → value map, omitting the columns that emptied. */
export function sanitizeColumnValues(columnValues) {
  const out = {};
  Object.entries(columnValues || {}).forEach(([columnId, value]) => {
    const cleaned = sanitizeColumnValue(value);
    if (cleaned !== undefined) out[columnId] = cleaned;
  });
  return out;
}

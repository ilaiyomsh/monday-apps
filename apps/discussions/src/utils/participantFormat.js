/*
 * participantFormat — how a participant is written in the export (round315).
 *
 * Pure and dependency-free on purpose: the same composition has to hold for the
 * .docx renderer, the live preview (which renders the real .docx) and anything
 * that later wants to print a person. The renderer only decides WHERE the strings
 * go (one row vs one line each); WHAT each person reads like lives here.
 *
 * A part is `{ key, sep }` where `key` is 'name' | 'title' | 'cf:<metaId>' and
 * `sep` is the separator written BEFORE that part (ignored for the first part
 * that actually produces text). See boards.config.js for the constants.
 */
import {
  PARTICIPANT_PART_NAME,
  PARTICIPANT_PART_TITLE,
  PARTICIPANT_CF_PREFIX,
  DEFAULT_PARTICIPANT_SEPARATOR,
  DEFAULT_PARTICIPANT_PARTS,
  RETIRED_LONG_DASH_SEPARATOR,
  RECORD_MARKER_NONE,
  RECORD_MARKER_NUMBER,
  RECORD_MARKER_BULLET,
  RECORD_BULLET_GLYPH,
} from './mondayApi/boards.config.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/*
 * round357 — 'מקף' used to be the LONG em dash and is now the short one. A stored
 * template still carries the retired value: left as-is it would show an empty picker
 * (the value matches no offered option) and keep exporting the glyph the owner asked
 * to replace. Mapping a RETIRED option forward is not rewriting a choice — the choice
 * it recorded no longer exists. Any other separator is the owner's and is untouched.
 */
function migrateSeparator(sep) {
  if (typeof sep !== 'string') return DEFAULT_PARTICIPANT_SEPARATOR;
  return sep === RETIRED_LONG_DASH_SEPARATOR ? ' – ' : sep;
}

/**
 * The parts of ONE meta field, always a usable list.
 *
 * A stored template written before round315 has no `parts` at all, and an owner
 * can uncheck every part — both resolve to the shipped default (the name), because
 * a participant list of empty strings is not a document anyone wants. Unknown part
 * keys are dropped rather than rendered as themselves.
 */
export function resolveParticipantParts(field) {
  const raw = Array.isArray(field?.parts) ? field.parts : null;
  if (!raw) return DEFAULT_PARTICIPANT_PARTS;
  const clean = raw
    .filter((p) => p && typeof p.key === 'string' && isKnownPartKey(p.key))
    .map((p) => ({
      key: p.key,
      sep: migrateSeparator(p.sep),
      // A custom field's stored display label is CARRIED THROUGH: it is the only
      // way the editor can still name a field whose account definition was
      // removed (otherwise the owner faces a bare numeric id).
      ...(typeof p.label === 'string' && p.label ? { label: p.label } : {}),
    }));
  return clean.length ? clean : DEFAULT_PARTICIPANT_PARTS;
}

/**
 * The ONE people format a template carries (round319): how every person in the
 * document is written, and whether the external participants join the participants
 * list instead of getting their own row.
 *
 * `includeExternal` is coerced rather than trusted: it decides whether two lists
 * become one, and a stored `"false"` (or any truthy leftover) merging them would be
 * a document the owner never asked for.
 *
 * @param {{ people?: { perLine?: boolean, parts?: Array, includeExternal?: boolean } }} template
 */
export function resolvePeopleFormat(template) {
  const people = template && typeof template === 'object' ? template.people : null;
  return {
    perLine: people?.perLine === true,
    parts: resolveParticipantParts(people),
    includeExternal: people?.includeExternal === true,
  };
}

export function isKnownPartKey(key) {
  if (key === PARTICIPANT_PART_NAME || key === PARTICIPANT_PART_TITLE) return true;
  return typeof key === 'string' && key.startsWith(PARTICIPANT_CF_PREFIX) && key.length > PARTICIPANT_CF_PREFIX.length;
}

/** The custom-field meta id a 'cf:<id>' part points at ('' for other keys). */
export function partCustomFieldId(key) {
  if (typeof key !== 'string' || !key.startsWith(PARTICIPANT_CF_PREFIX)) return '';
  return key.slice(PARTICIPANT_CF_PREFIX.length);
}

/** The text ONE part contributes for a person ('' when the profile has nothing). */
function partValue(person, key) {
  if (key === PARTICIPANT_PART_NAME) return text(person?.name);
  if (key === PARTICIPANT_PART_TITLE) return text(person?.title);
  const cfId = partCustomFieldId(key);
  if (!cfId) return '';
  return text(person?.customFields?.[cfId]);
}

/**
 * One participant as a single string.
 *
 * A part whose profile value is empty is SKIPPED, and its separator with it — a
 * user without a Title must not export as "עידו פיוטרקובסקי, ". If nothing at all
 * resolves (e.g. only Title was chosen and this person has none) the NAME is used
 * as the fallback: an export may never silently drop a participant.
 */
export function formatParticipantSegments(person, parts) {
  const list = Array.isArray(parts) && parts.length ? parts : DEFAULT_PARTICIPANT_PARTS;
  const segs = [];
  list.forEach(({ key, sep }) => {
    const value = partValue(person, key);
    if (!value) return; // the part contributes nothing — and its separator goes with it
    if (segs.length) segs.push({ text: migrateSeparator(sep), sep: true });
    segs.push({ text: value, sep: false });
  });
  if (segs.length) return segs;
  const fallback = text(person?.name);
  return fallback ? [{ text: fallback, sep: false }] : [];
}

/**
 * The same participant as ONE string — the single-row form and any plain-text
 * consumer. Derived from the segments so the two compositions cannot drift.
 */
export function formatParticipantLabel(person, parts) {
  return formatParticipantSegments(person, parts).map((s) => s.text).join('');
}

/**
 * round357 — the marker for the record at `index` of a people component.
 * Unrecognized kinds render nothing rather than printing themselves.
 */
export function recordMarker(kind, index) {
  if (kind === RECORD_MARKER_NUMBER) return `${index + 1}.`;
  if (kind === RECORD_MARKER_BULLET) return RECORD_BULLET_GLYPH;
  return '';
}

/** The marker a people FIELD carries; 'none' unless it says otherwise. */
export function resolveRecordMarker(field) {
  const m = field && typeof field === 'object' ? field.marker : null;
  return m === RECORD_MARKER_NUMBER || m === RECORD_MARKER_BULLET ? m : RECORD_MARKER_NONE;
}

/**
 * Every participant, formatted, with the empty ones dropped. Callers decide
 * whether to join them into one row or write a line each.
 */
export function formatParticipantLabels(people, parts) {
  return (Array.isArray(people) ? people : [])
    .map((p) => formatParticipantLabel(p, parts))
    .filter(Boolean);
}

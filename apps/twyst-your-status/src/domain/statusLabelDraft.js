/**
 * Pure helpers for editing monday status-column labels in settings.
 * Mutations must resend the FULL labels array (including deactivated).
 * @see monday-api references/column-formats.md
 */

import { migrateSettings } from './settingsSchema.js';
import {
  ensureUniqueStatusColors,
  normalizeStatusColorEnum,
  pickUnusedStatusColor,
  resolveStatusColorHex,
} from './statusColors.js';
import logger from '../utils/logger.js';

let newLabelSeq = 0;

export function nextNewLabelClientId() {
  newLabelSeq += 1;
  return `new:${newLabelSeq}`;
}

/** Reset only in tests. */
export function __resetNewLabelSeqForTests() {
  newLabelSeq = 0;
}

function draftColorValue(label) {
  const raw = label.colorValue ?? label.color;
  if (raw == null) return 'working_orange';
  try {
    return normalizeStatusColorEnum(raw);
  } catch (err) {
    logger.warn('statusLabelDraft', 'Unrecognized status color; falling back to working_orange', err);
    return 'working_orange';
  }
}

/**
 * @param {Array<{
 *   id: string,
 *   index: number,
 *   label?: string,
 *   color?: string,
 *   colorValue?: string|number,
 *   isDeactivated?: boolean,
 * }>} liveLabels
 */
export function createLabelsDraft(liveLabels) {
  const list = Array.isArray(liveLabels) ? liveLabels : [];
  return list
    .filter((label) => !label?.isDeactivated)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((label) => {
      const colorValue = draftColorValue(label);
      return {
        clientKey: String(label.id),
        id: String(label.id),
        index: label.index,
        label: typeof label.label === 'string' ? label.label : '',
        color: typeof label.color === 'string' ? label.color : (resolveStatusColorHex(colorValue) ?? '#c4c4c4'),
        colorValue,
        isNew: false,
      };
    });
}

/**
 * @param {ReturnType<typeof createLabelsDraft>} draft
 * @param {ReturnType<typeof createLabelsDraft>} baseline
 */
export function hasPendingLabelEdits(draft, baseline) {
  const a = Array.isArray(draft) ? draft : [];
  const b = Array.isArray(baseline) ? baseline : [];
  if (a.length !== b.length) return true;
  return a.some((label, i) => {
    const other = b[i];
    if (!other) return true;
    if (label.id !== other.id) return true;
    if (label.label !== other.label) return true;
    if (Number(label.index) !== Number(other.index)) return true;
    return String(label.colorValue ?? label.color) !== String(other.colorValue ?? other.color);
  });
}

/**
 * Build the full update_status_column labels payload (active + deactivated).
 * New labels omit `id`. Existing removed labels are marked is_deactivated.
 *
 * **Indexes are one unique space across the WHOLE payload** — actives take 0..n-1 in
 * display order, deactivated rows are packed above them. monday replaces the entire
 * labels array and rejects it with `INVALID_INPUT` / "Indexes should be unique" if any
 * two rows share an index, and the deactivated rows are invisible in the settings UI,
 * so every collision here is one the screen cannot show. Two were reachable before
 * 3.9.1, each needing only a label removed at some point in the past:
 *
 *  - a new label takes `max(active index) + 1`, colliding with a deactivated label
 *    above every active one (the label removed last was the last in the list);
 *  - a reorder renumbers the actives to 0..n-1, colliding with a deactivated label
 *    inside that range (a removed MIDDLE label).
 *
 * Rewriting a deactivated row's index is safe: `index` is display order only, and a
 * status CELL references its label by **id** (`{"index": <labelId>}` is the monday
 * naming quirk — see statusPolicy.js and monday-api references/column-formats.md).
 *
 * @param {ReturnType<typeof createLabelsDraft>} draftActive
 * @param {Array<{ id: string, index: number, label?: string, color?: string, colorValue?: string|number }>} liveAll
 * @returns {Array<{ id?: number, color: string, label: string, index: number, isDeactivated: boolean }>}
 */
export function buildStatusLabelsUpdatePayload(draftActive, liveAll) {
  const draft = Array.isArray(draftActive) ? draftActive : [];
  const live = Array.isArray(liveAll) ? liveAll : [];
  const existingIds = new Set(
    live
      .map((label) => Number(label.id))
      .filter((id) => Number.isInteger(id) && id >= 0),
  );

  const activePayload = draft
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((label, orderIndex) => {
      const numericId = Number(label.id);
      const isExisting = Number.isInteger(numericId) && existingIds.has(numericId) && !label.isNew;
      return {
        ...(isExisting ? { id: numericId } : {}),
        color: normalizeStatusColorEnum(label.colorValue ?? label.color),
        label: typeof label.label === 'string' ? label.label : '',
        // The POSITION, not the draft's own index: the draft's number can collide
        // with a deactivated row's (see the note above), and position preserves the
        // order the admin arranged, which is all `index` means here.
        index: orderIndex,
        isDeactivated: false,
      };
    });

  const activeIds = new Set(
    activePayload
      .map((label) => label.id)
      .filter((id) => Number.isInteger(id)),
  );

  const deactivatedPayload = live
    .filter((label) => {
      const numericId = Number(label.id);
      return Number.isInteger(numericId) && existingIds.has(numericId) && !activeIds.has(numericId);
    })
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((label, deactivatedIndex) => ({
      id: Number(label.id),
      color: normalizeStatusColorEnum(label.colorValue ?? label.color),
      label: typeof label.label === 'string' ? label.label : '',
      // Packed ABOVE the actives, so no deactivated row can ever share an index with
      // a visible one. Their own relative order is kept for stability.
      index: activePayload.length + deactivatedIndex,
      isDeactivated: true,
    }));

  // monday rejects update_status_column when any two labels share a color,
  // including deactivated rows in the full-replace payload.
  return ensureUniqueStatusColors([...activePayload, ...deactivatedPayload]);
}

/**
 * Match each NEW draft label to the id monday assigned it by the save.
 *
 * A new label has no id until `update_status_column` has run, but its permission
 * rules are keyed BY id — so the settings screen holds them under the draft's
 * `clientKey` ("new:1") and this is how they find their real home afterwards.
 *
 * The candidate set is what the refresh has that the pre-mutation labels did not:
 * a set difference, so a pre-existing label can never be claimed no matter how well
 * it matches. Within that set, matching is by the two things WE sent — the label
 * text and the index — and it deliberately stops there. Falling back to "zip the
 * leftovers in order" would attach one status's permissions to another, which is
 * worse than losing them: an unresolved draft simply keeps its `new:` key, and the
 * prune drops it (`migrateSettings` only accepts numeric keys).
 *
 * @param {{
 *   draft?: ReturnType<typeof createLabelsDraft>,
 *   liveBefore?: Array<{id: string|number}>,
 *   refreshedLabels?: Array<{id: string|number, index?: number, label?: string, isDeactivated?: boolean}>,
 * }} input
 * @returns {Record<string, string>} clientKey → the assigned label id
 */
/**
 * Renumber a labels draft to 0..n-1 in display order.
 *
 * The caller runs this before saving so its draft carries the SAME indexes the
 * payload will send (see buildStatusLabelsUpdatePayload) — `resolveNewLabelIds`
 * matches a new label to its assigned id by text and index, and a draft still
 * holding `max + 1` while monday stored the packed position would be left matching
 * on text alone.
 *
 * Do NOT run it before `hasPendingLabelEdits`: on a column with a removed label the
 * live indexes are non-contiguous, so renumbering first would read as an edit and
 * fire a labels mutation on every save.
 *
 * @param {ReturnType<typeof createLabelsDraft>} draft
 */
export function renumberDraftIndexes(draft) {
  return (Array.isArray(draft) ? draft : [])
    .slice()
    .sort((a, b) => Number(a?.index) - Number(b?.index))
    .map((label, index) => ({ ...label, index }));
}

export function resolveNewLabelIds({ draft, liveBefore, refreshedLabels } = {}) {
  const newDrafts = (Array.isArray(draft) ? draft : [])
    .filter((label) => label?.isNew && label.clientKey);
  if (newDrafts.length === 0) return {};

  const beforeIds = new Set(
    (Array.isArray(liveBefore) ? liveBefore : []).map((label) => String(label?.id)),
  );
  const candidates = (Array.isArray(refreshedLabels) ? refreshedLabels : [])
    .filter((label) => !label?.isDeactivated && !beforeIds.has(String(label?.id)));

  const resolved = {};
  const claimed = new Set();
  const text = (value) => String(value ?? '').trim();

  const matchPass = (predicate) => {
    newDrafts.forEach((label) => {
      if (resolved[label.clientKey]) return;
      const hit = candidates.find(
        (candidate) => !claimed.has(String(candidate.id)) && predicate(candidate, label),
      );
      if (!hit) return;
      resolved[label.clientKey] = String(hit.id);
      claimed.add(String(hit.id));
    });
  };

  // Both, then either. The strictest pass runs first so a label that matches
  // exactly cannot be consumed by a looser match on another draft.
  matchPass((candidate, label) => text(candidate.label) === text(label.label)
    && Number(candidate.index) === Number(label.index));
  matchPass((candidate, label) => text(candidate.label) === text(label.label));
  matchPass((candidate, label) => Number(candidate.index) === Number(label.index));

  return resolved;
}

/**
 * Re-key a settings DRAFT: rules and hidden ids held under a `new:` client key move
 * to the real label id. Runs before `pruneSettingsForActiveLabels`, which is where
 * anything still unresolved is dropped.
 *
 * Deliberately does not go through `migrateSettings` — that would strip the very
 * `new:` keys this function exists to rename.
 *
 * @param {object|null} settings  the in-memory draft, client keys included
 * @param {Record<string, string>} idByClientKey
 */
export function remapDraftLabelKeys(settings, idByClientKey) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const map = (idByClientKey && typeof idByClientKey === 'object') ? idByClientKey : {};
  const entries = Object.entries(settings.labels ?? {});

  // Untouched keys first, remapped ones second, so a rule the user just configured
  // wins over a stale rule already sitting under the id monday handed out.
  const labels = {};
  entries.forEach(([key, rule]) => {
    if (!map[key]) labels[key] = rule;
  });
  entries.forEach(([key, rule]) => {
    if (map[key]) labels[map[key]] = rule;
  });

  const hiddenLabelIds = [...new Set(
    (Array.isArray(settings.hiddenLabelIds) ? settings.hiddenLabelIds : [])
      .map((id) => map[String(id)] ?? String(id)),
  )];

  return { ...settings, hiddenLabelIds, labels };
}

/**
 * Drop permission rules / hidden ids for labels that no longer exist as active.
 * @param {object|null} settings
 * @param {string[]} activeLabelIds
 */
export function pruneSettingsForActiveLabels(settings, activeLabelIds) {
  const migrated = migrateSettings(settings) ?? {
    version: 1,
    hiddenLabelIds: [],
    labels: {},
  };
  const keep = new Set((activeLabelIds ?? []).map(String));
  const labels = {};
  Object.entries(migrated.labels).forEach(([key, rule]) => {
    if (keep.has(key)) labels[key] = rule;
  });
  return {
    version: migrated.version,
    hiddenLabelIds: migrated.hiddenLabelIds.filter((id) => keep.has(id)),
    labels,
  };
}

/**
 * Build a GraphQL mutation document for update_status_column.
 * StatusColumnColors must be unquoted enum literals.
 */
export function buildUpdateStatusColumnMutation(labelsPayload) {
  const labelsLiteral = (Array.isArray(labelsPayload) ? labelsPayload : [])
    .map((label) => {
      const fields = [
        Number.isInteger(label.id) ? `id: ${label.id}` : null,
        `color: ${label.color}`,
        `label: ${JSON.stringify(label.label ?? '')}`,
        `index: ${label.index}`,
        label.isDeactivated ? 'is_deactivated: true' : null,
      ].filter(Boolean);
      return `{ ${fields.join(', ')} }`;
    })
    .join(',\n          ');

  return `mutation UpdateStatusColumnLabels($boardId: ID!, $columnId: String!, $revision: String!) {
    update_status_column(board_id: $boardId, id: $columnId, revision: $revision, settings: {
      labels: [
          ${labelsLiteral}
      ]
    }) { id }
  }`;
}

export function createBlankLabelDraft(existingDraft) {
  const list = Array.isArray(existingDraft) ? existingDraft : [];
  const maxIndex = list.reduce((max, label) => Math.max(max, Number(label.index) || 0), -1);
  const usedColors = list.map((label) => {
    try {
      return normalizeStatusColorEnum(label.colorValue ?? label.color);
    } catch (err) {
      logger.warn('statusLabelDraft', 'Skipping unrecognized draft color while picking a free one', err);
      return null;
    }
  }).filter(Boolean);
  const colorValue = pickUnusedStatusColor(usedColors);
  const clientKey = nextNewLabelClientId();
  return {
    clientKey,
    id: clientKey,
    index: maxIndex + 1,
    label: 'לייבל חדש',
    color: resolveStatusColorHex(colorValue) ?? '#00c875',
    colorValue,
    isNew: true,
  };
}

/**
 * Move a label by delta (−1 / +1 in display order) and renormalize `index` to 0..n-1.
 *
 * @param {ReturnType<typeof createLabelsDraft>} draft
 * @param {string} clientKey
 * @param {number} delta
 * @returns {ReturnType<typeof createLabelsDraft>}
 */
export function reorderLabelsDraft(draft, clientKey, delta) {
  const list = Array.isArray(draft) ? draft.slice() : [];
  const withIndexes = (items) => items.map((label, index) => ({ ...label, index }));
  const from = list.findIndex((label) => label.clientKey === clientKey);
  const step = Number(delta);
  if (from < 0 || !Number.isInteger(step) || step === 0) {
    return withIndexes(list);
  }
  const to = from + step;
  if (to < 0 || to >= list.length) {
    return withIndexes(list);
  }
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return withIndexes(list);
}

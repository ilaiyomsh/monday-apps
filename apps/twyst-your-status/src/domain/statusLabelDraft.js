/**
 * Pure helpers for editing monday status-column labels in settings.
 * Mutations must resend the FULL labels array (including deactivated).
 * @see monday-api references/column-formats.md
 */

import { migrateSettings } from './settingsSchema.js';
import {
  RESERVED_EMPTY_LABEL_COLOR,
  RESERVED_EMPTY_LABEL_HEX,
  RESERVED_EMPTY_LABEL_ID,
  ensureUniqueStatusColors,
  isReservedEmptyLabelId,
  normalizeStatusColorEnum,
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

/** One past the highest index in a draft — where the next row sorts. */
function nextDraftIndex(draft) {
  return (Array.isArray(draft) ? draft : [])
    .reduce((max, label) => Math.max(max, Number(label?.index) || 0), -1) + 1;
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
  const rows = list
    .filter((label) => !label?.isDeactivated)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((label) => {
      // The grey default label is not a colour choice: `explosive` IS monday's reserved
      // slot, and the platform pins the row to id 5 and hex #c4c4c4 whatever arrives.
      const isDefaultEmpty = isReservedEmptyLabelId(label.id);
      const colorValue = isDefaultEmpty ? RESERVED_EMPTY_LABEL_COLOR : draftColorValue(label);
      return {
        clientKey: String(label.id),
        id: String(label.id),
        index: label.index,
        label: typeof label.label === 'string' ? label.label : '',
        // monday's STORED hex, never one re-derived from the colour index: the platform
        // overrides some colours server-side (the reserved id 5 renders grey whatever
        // enum was sent), and the swatch has to show what the board shows.
        color: isDefaultEmpty
          ? RESERVED_EMPTY_LABEL_HEX
          : (typeof label.color === 'string' ? label.color : (resolveStatusColorHex(colorValue) ?? '#c4c4c4')),
        colorValue,
        isDone: label.isDone === true,
        description: typeof label.description === 'string' ? label.description : undefined,
        isNew: false,
        // Set only on the reserved row, so every other draft row keeps the exact shape
        // its consumers already assert.
        ...(isDefaultEmpty ? { isDefaultEmpty: true } : {}),
      };
    });

  // Last, whatever index the column stores for it — monday shows the grey label at the
  // bottom of the list and so do we, and a save renumbers positions from this order.
  const colored = rows.filter((label) => !label.isDefaultEmpty);
  const reserved = rows.filter((label) => label.isDefaultEmpty);
  if (reserved.length === 0) return colored;
  return [
    ...colored,
    ...reserved.map((label) => ({ ...label, index: nextDraftIndex(colored) })),
  ];
}

/**
 * The grey DEFAULT label row, as the settings list always shows it.
 *
 * monday does not create that label until somebody names it — a fresh status column comes
 * back with four labels and no id 5 — so the settings screen synthesises the row rather
 * than waiting for the API to have one. Nothing is written for a synthesised row that
 * stays empty (see buildStatusLabelsUpdatePayload): the label cannot be deleted once it
 * exists, so an admin who never typed in it must not be given one.
 *
 * @param {ReturnType<typeof createLabelsDraft>} draft
 * @returns {ReturnType<typeof createLabelsDraft>}
 */
export function ensureDefaultLabelRow(draft) {
  const list = Array.isArray(draft) ? draft.slice() : [];
  if (list.some((label) => label?.isDefaultEmpty)) return list;
  return [...list, {
    clientKey: String(RESERVED_EMPTY_LABEL_ID),
    // The id monday WILL assign it. Holding it now means permission rules typed on this
    // card survive the save that creates the label, instead of being pruned as orphans.
    id: String(RESERVED_EMPTY_LABEL_ID),
    index: nextDraftIndex(list),
    label: '',
    color: RESERVED_EMPTY_LABEL_HEX,
    colorValue: RESERVED_EMPTY_LABEL_COLOR,
    isDone: false,
    description: undefined,
    isNew: false,
    isDefaultEmpty: true,
  }];
}

/**
 * Place a freshly created label ABOVE the grey default row, which stays at the bottom.
 * Only the default row's index moves; a coloured row keeps the index it already had, so
 * an unsaved edit elsewhere does not start reading as a reorder.
 *
 * @param {ReturnType<typeof createLabelsDraft>} draft
 * @param {object} row
 * @returns {ReturnType<typeof createLabelsDraft>}
 */
export function insertLabelBeforeDefault(draft, row) {
  const list = Array.isArray(draft) ? draft.slice() : [];
  const colored = list.filter((label) => !label?.isDefaultEmpty);
  const reserved = list.filter((label) => label?.isDefaultEmpty);
  const withRow = [...colored, { ...row, index: nextDraftIndex(colored) }];
  return [
    ...withRow,
    ...reserved.map((label) => ({ ...label, index: nextDraftIndex(withRow) })),
  ];
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
 * The default row the column does not have and the admin left empty — the one row a
 * payload must leave out entirely.
 * @param {{ isDefaultEmpty?: boolean, label?: string }} label
 * @param {Set<number>} existingIds ids monday already has on the column
 */
function isUnwrittenEmptyDefault(label, existingIds) {
  if (!label?.isDefaultEmpty) return false;
  if (existingIds.has(RESERVED_EMPTY_LABEL_ID)) return false;
  return String(label.label ?? '').trim() === '';
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
    // An empty default label that monday does not already have is not written at all.
    // Writing it would CREATE the one label on a status column that can never be deleted
    // afterwards — for a row the admin never typed a single character into.
    .filter((label) => !isUnwrittenEmptyDefault(label, existingIds))
    .map((label, orderIndex) => {
      const numericId = Number(label.id);
      const isExisting = Number.isInteger(numericId) && existingIds.has(numericId) && !label.isNew;
      return {
        ...(isExisting ? { id: numericId } : {}),
        // Flagged through to ensureUniqueStatusColors, which must not reassign this one:
        // `explosive` is the slot's identity, not a colour preference.
        ...(label.isDefaultEmpty ? { isDefaultEmpty: true } : {}),
        color: label.isDefaultEmpty
          ? RESERVED_EMPTY_LABEL_COLOR
          : normalizeStatusColorEnum(label.colorValue ?? label.color),
        label: typeof label.label === 'string' ? label.label : '',
        // The POSITION, not the draft's own index: the draft's number can collide
        // with a deactivated row's (see the note above), and position preserves the
        // order the admin arranged, which is all `index` means here.
        index: orderIndex,
        // Resent, not derived: a payload that omits these CLEARS them, so leaving them
        // out silently dropped the column's "Done" designation and every label
        // description on any save that touched labels.
        isDone: label.isDone === true,
        description: label.description,
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
      isDone: label.isDone === true,
      description: label.description,
      isDeactivated: true,
    }));

  // monday rejects update_status_column when any two labels share a color,
  // including deactivated rows in the full-replace payload.
  return ensureUniqueStatusColors([...activePayload, ...deactivatedPayload]);
}

/**
 * Renumber a labels draft to 0..n-1 in display order.
 *
 * Run before saving so the draft carries the SAME indexes the payload will send (see
 * buildStatusLabelsUpdatePayload, which sends positions and packs deactivated rows
 * above the actives).
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
  /*
   * round321 — two keep-sets with different jobs (review-confirmed distinction):
   *
   * `keepTargets` is the caller's list verbatim — a transition may only point at a
   * label that really exists (or will exist after this save). '5' earns its place
   * here like anyone else; force-keeping it left a phantom target behind the
   * name-then-clear flow, one the editor could never show and the counts kept
   * counting.
   *
   * `keepKeys` additionally always holds the reserved id: the rule keyed '5'
   * governs what may be picked from an EMPTY status, its card is always on the
   * settings screen (round313), and the refreshed active ids after a labels
   * mutation list only labels monday really has — so a save that never created the
   * grey label would otherwise silently discard the empty state's configuration.
   */
  const keepTargets = new Set((activeLabelIds ?? []).map(String));
  const keepKeys = new Set([...keepTargets, String(RESERVED_EMPTY_LABEL_ID)]);
  const labels = {};
  Object.entries(migrated.labels).forEach(([key, rule]) => {
    if (!keepKeys.has(key)) return;
    if (!Array.isArray(rule.nextLabelIds)) {
      labels[key] = rule;
      return;
    }
    const nextLabelIds = rule.nextLabelIds.filter((id) => keepTargets.has(id));
    if (nextLabelIds.length === 0 && rule.nextLabelIds.length > 0) {
      /*
       * The restriction was emptied BY this prune — every label it pointed at is
       * gone. Keeping the empty list would silently convert "only via X" into a
       * TERMINAL status the moment X is deleted; unrestricting is the smaller
       * surprise. A stored [] (deliberately terminal) takes the branch above this
       * one untouched, because 0 === 0.
       */
      const { nextLabelIds: dropped, ...rest } = rule;
      labels[key] = rest;
      return;
    }
    /*
     * Canonical form (Codex PR review, confirmed): the editor's ONE spelling of
     * "unrestricted" is no field at all — its all-checked state stores null so a
     * label added later is allowed. A list that covers every possible target for
     * this source (everything active except the source itself) is that same state
     * in different bytes, and pruning could mint it: delete the one label the
     * admin had unchecked and the survivors are all listed — the editor shows
     * all-checked, SAYS unrestricted, yet the next label added would be silently
     * blocked. Non-empty is required: an explicit terminal [] on a column with no
     * other labels covers everything only vacuously, and it must stay terminal.
     */
    const nextSet = new Set(nextLabelIds);
    const coversEveryTarget = nextLabelIds.length > 0
      && [...keepTargets].every((id) => id === key || nextSet.has(id));
    if (coversEveryTarget) {
      const { nextLabelIds: dropped, ...rest } = rule;
      labels[key] = rest;
      return;
    }
    labels[key] = { ...rule, nextLabelIds };
  });
  return {
    version: migrated.version,
    hiddenLabelIds: migrated.hiddenLabelIds.filter((id) => keepKeys.has(id)),
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
        // Sent only when there is something to preserve: `is_done: false` and an absent
        // description are already the default, and omitting them keeps the document
        // (and its diffs) readable.
        label.isDone === true ? 'is_done: true' : null,
        typeof label.description === 'string' && label.description !== ''
          ? `description: ${JSON.stringify(label.description)}`
          : null,
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

/** The name a label is created with; the admin renames it in place afterwards. */
export const NEW_LABEL_NAME = 'לייבל חדש';

/**
 * Build the payload that CREATES one label, leaving every existing label as monday
 * currently has it.
 *
 * Creation is its own mutation, fired when the admin clicks "add label" rather than
 * deferred to save, because the colour the admin sees has to be the colour monday
 * assigned: the platform derives the new label's **id** from the colour and can override
 * the colour itself server-side, so an optimistic local row was showing something the
 * board disagreed with (purple in settings, grey on the board, orange on re-entry).
 *
 * Every existing label is resent, deactivated rows included — omitting one is a DELETE.
 *
 * @param {ReturnType<typeof import('./statusPolicy.js').normalizeStatusLabels>} liveAll
 * @param {{ label?: string, colorValue: string }} newLabel
 */
export function buildCreateLabelPayload(liveAll, { label, colorValue } = {}) {
  const live = Array.isArray(liveAll) ? liveAll : [];
  const activeDraft = createLabelsDraft(live);
  const clientKey = nextNewLabelClientId();
  const created = {
    clientKey,
    id: clientKey,
    index: activeDraft.length,
    label: typeof label === 'string' && label !== '' ? label : NEW_LABEL_NAME,
    color: resolveStatusColorHex(colorValue) ?? '#c4c4c4',
    colorValue,
    isDone: false,
    isNew: true,
  };
  return buildStatusLabelsUpdatePayload([...activeDraft, created], live);
}

/**
 * Identify the label monday just created: a set difference on id, so a pre-existing
 * label can never be mistaken for it however well it matches on text or position.
 *
 * @param {Array<{id: string|number}>} liveBefore
 * @param {Array<{id: string|number, isDeactivated?: boolean}>} refreshedLabels
 * @returns {object|null} the created label, or null if the refresh does not show one
 */
export function findCreatedLabel(liveBefore, refreshedLabels) {
  const beforeIds = new Set(
    (Array.isArray(liveBefore) ? liveBefore : []).map((label) => String(label?.id)),
  );
  const fresh = (Array.isArray(refreshedLabels) ? refreshedLabels : [])
    .filter((label) => !label?.isDeactivated && !beforeIds.has(String(label?.id)));
  // Exactly one, or we do not guess: two would mean a concurrent editor, and picking
  // either would hand this admin's rename to somebody else's label.
  return fresh.length === 1 ? fresh[0] : null;
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
  const all = Array.isArray(draft) ? draft.slice() : [];
  // The grey default label sits at the bottom, as it does in monday, and neither moves
  // nor is moved over — only the coloured labels take part in the reorder.
  const list = all.filter((label) => !label?.isDefaultEmpty);
  const reserved = all.filter((label) => label?.isDefaultEmpty);
  const withIndexes = (items) => [...items, ...reserved]
    .map((label, index) => ({ ...label, index }));
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

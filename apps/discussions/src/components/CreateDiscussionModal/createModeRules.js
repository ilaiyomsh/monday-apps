import { CREATE_DISCUSSION_MODES } from '@generated/utils/mondayApi/boards.config.js';

/*
 * round381 — the create card's third path, "דיון על פרויקט" (owner spec: it should
 * behave as closely as possible to "דיון מתבנית").
 *
 * The decisions the two paths SHARE live here, as pure functions, for one reason:
 * "as similar as possible" is only true if it is the same code. A second copy of
 * the auto-name gate or the reveal rule inside the project branch would drift from
 * the template branch the first time either is touched — which is exactly how the
 * custom status cell drifted from the base one in round372.
 */

/*
 * DISPLAY order, RTL-leading first. Every list this module returns is sorted by
 * it, so the toggle, the settings section and "the first enabled mode" all agree
 * on what "first" means.
 */
export const CREATE_MODE_ORDER = [
  CREATE_DISCUSSION_MODES.TEMPLATE,
  CREATE_DISCUSSION_MODES.PROJECT,
  CREATE_DISCUSSION_MODES.ADHOC,
];

// Shipped default (round383, owner spec): template + adhoc on, project off.
export const DEFAULT_ENABLED_MODES = [CREATE_DISCUSSION_MODES.TEMPLATE, CREATE_DISCUSSION_MODES.ADHOC];

/*
 * Which modes the OWNER has enabled, in display order.
 *
 * round383 replaced the single `projectDiscussions` boolean with a set, so the
 * legacy key is read as a fallback: an owner who had already switched the project
 * path on (round382) keeps it, without a migration pass over stored settings.
 *
 * Never returns an empty list. An instance whose stored set somehow empties would
 * otherwise render a create card with no path at all — the settings UI blocks that,
 * but a hand-edited store is not the settings UI.
 */
export function resolveEnabledModes(preferences) {
  const stored = preferences?.enabledCreateModes;
  let list;
  if (Array.isArray(stored)) {
    list = CREATE_MODE_ORDER.filter((m) => stored.includes(m));
  } else {
    // legacy shape: template + adhoc always, project iff the old boolean was on
    list = DEFAULT_ENABLED_MODES.slice();
    if (preferences?.projectDiscussions === true) list = CREATE_MODE_ORDER.slice();
  }
  return list.length ? list : DEFAULT_ENABLED_MODES.slice();
}

/*
 * Which paths the TOGGLE offers: the enabled set, minus PROJECT when the app
 * cannot carry it (the column is not mapped — see isProjectModeReady).
 *
 * The two conditions are separate on purpose. "Enabled" is the owner's intent and
 * survives an unmapped column; "ready" is whether it can work right now. Collapsing
 * them would silently un-tick the owner's checkbox the moment a mapping broke.
 */
export function availableCreateModes(preferences, projectReady) {
  return resolveEnabledModes(preferences)
    .filter((m) => m !== CREATE_DISCUSSION_MODES.PROJECT || projectReady);
}

/*
 * May this mode be switched OFF? Only if it is not the last one standing — a create
 * card with no path is unreachable, so the settings UI locks the final checkbox
 * rather than letting the owner produce that state and discover it later.
 */
export function canDisableMode(enabled, mode) {
  const list = Array.isArray(enabled) ? enabled : [];
  return list.includes(mode) && list.length > 1;
}

// Toggling a mode on/off, in display order. Refuses to remove the last one.
export function nextEnabledModes(enabled, mode, on) {
  const list = Array.isArray(enabled) ? enabled : [];
  if (on) return CREATE_MODE_ORDER.filter((m) => m === mode || list.includes(m));
  if (!canDisableMode(list, mode)) return list;
  return list.filter((m) => m !== mode);
}

/*
 * The mode the card OPENS on. It must be one the owner actually enabled, so a
 * default pointing at a disabled path falls back to the first enabled one.
 *
 * The stored preference is deliberately NOT rewritten when that happens: re-enabling
 * the mode restores the owner's choice by itself, which is why disabling a path is a
 * reversible act rather than one that quietly loses a setting.
 */
export function resolveDefaultMode(preferences, enabled) {
  const list = (Array.isArray(enabled) && enabled.length) ? enabled : resolveEnabledModes(preferences);
  const stored = preferences?.createDiscussionMode;
  return list.includes(stored) ? stored : list[0];
}

export const CREATE_MODE_LABEL = {
  [CREATE_DISCUSSION_MODES.TEMPLATE]: 'דיון מתבנית',
  [CREATE_DISCUSSION_MODES.PROJECT]: 'דיון על פרויקט',
  [CREATE_DISCUSSION_MODES.ADHOC]: 'דיון מזדמן',
};

/*
 * A mode that FOLDS the form until its subject is picked. Both the template and
 * the project path do — you cannot fill in a discussion before you know which
 * template or which project it is about. ADHOC reveals immediately.
 */
export function isFoldingMode(mode) {
  return mode === CREATE_DISCUSSION_MODES.TEMPLATE || mode === CREATE_DISCUSSION_MODES.PROJECT;
}

/*
 * Is the form body shown? Edit and duplicate always reveal (their fields are
 * prefilled); otherwise a folding mode waits for its subject.
 *
 * `subjectChosen` is the mode's own subject — the type in TEMPLATE, the project in
 * PROJECT — so the caller decides what "chosen" means and this stays one rule.
 */
export function isFormRevealed({ isEdit, isDuplicate, mode, subjectChosen }) {
  if (isEdit || isDuplicate) return true;
  if (!isFoldingMode(mode)) return true;
  return !!subjectChosen;
}

/*
 * May the card overwrite the name with an auto name right now?
 *
 * The rule is round367's, unchanged, and now shared: only in a folding mode, only
 * when the preference is on, and only when the field is empty or still holds the
 * PREVIOUS auto name (recognised by its trailing date). A name the user typed is
 * never overwritten — that is the whole point of the check.
 */
export function canAutoName({ isEdit, mode, autoNameEnabled, name, lastAutoDate }) {
  if (isEdit) return false;
  if (!isFoldingMode(mode)) return false;
  if (autoNameEnabled !== true) return false;
  const current = String(name ?? '');
  if (!current.trim()) return true;
  return !!lastAutoDate && current.endsWith(lastAutoDate);
}

/*
 * The ONE project a discussion is about.
 *
 * The owner's projects column came back from the live board WITHOUT
 * `allowMultipleItems`, and monday reads an absent flag as MULTI — so the column
 * can hold several projects even though a discussion is about one. The app takes
 * the FIRST linked item rather than trusting the column to be single, so the card
 * and every reader agree on which project that is regardless of how the column is
 * configured. Setting it to single-item in monday is cosmetic on top of this.
 */
export function firstLinkedProject(value) {
  const list = Array.isArray(value?.linkedItems) ? value.linkedItems : [];
  const first = list.find((it) => it && it.id != null);
  if (!first) return null;
  return { id: String(first.id), name: first.name || String(first.id) };
}

// The write shape for projectLinkID: always exactly one id, or an empty list which
// genuinely clears the column (see monday-client's board_relation sanitizer).
export function projectLinkValue(projectId) {
  return { linkedItems: projectId ? [{ id: String(projectId) }] : [] };
}

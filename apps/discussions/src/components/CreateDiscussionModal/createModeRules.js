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
 * Which paths the toggle offers. TEMPLATE and ADHOC always; PROJECT only when the
 * app can actually carry it (preference on AND projectLinkID mapped — see
 * isProjectModeReady). Returned in DISPLAY order, RTL-leading first.
 */
export function availableCreateModes(projectReady) {
  return projectReady
    ? [CREATE_DISCUSSION_MODES.TEMPLATE, CREATE_DISCUSSION_MODES.PROJECT, CREATE_DISCUSSION_MODES.ADHOC]
    : [CREATE_DISCUSSION_MODES.TEMPLATE, CREATE_DISCUSSION_MODES.ADHOC];
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

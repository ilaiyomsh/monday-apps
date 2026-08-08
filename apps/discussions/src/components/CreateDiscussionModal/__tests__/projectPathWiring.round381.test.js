import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * round381 — the project path's WIRING inside the create card.
 *
 * The card is ~1,300 lines behind a monday SDK, a settings provider, a templates
 * provider and @vibe's portals; the decisions worth protecting here are structural,
 * and each assertion below names the bug its removal reintroduces. The path's
 * BEHAVIOUR is covered by createModeRules.round381.test.js, which drives the real
 * functions.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/components/CreateDiscussionModal/CreateDiscussionModal.jsx'),
  'utf-8'
);

describe('the toggle is built from the rule, not hardcoded', () => {
  it('renders one button per available mode', () => {
    /*
     * Hardcoding the buttons is what would show "דיון על פרויקט" to an instance that
     * has it disabled or the column unmapped.
     *
     * round383 amended this: the list is computed ONCE into `createModes` because two
     * things now read it — the buttons, and the test for whether a toggle is worth
     * rendering at all. Calling availableCreateModes twice would let those two drift.
     */
    expect(SRC).toContain('const createModes = availableCreateModes(settings?.preferences, projectReady);');
    expect(SRC).toContain('{createModes.map((mode) => (');
    expect(SRC).toContain('{CREATE_MODE_LABEL[mode]}');
  });

  it('does not render a toggle when there is only one path to choose', () => {
    // round383 — a one-option tablist is decoration, and it implies a choice the
    // owner deliberately removed.
    expect(SRC).toContain('{!isEdit && createModes.length > 1 && (');
  });

  it('opens on a default that is INSIDE the enabled set', () => {
    // Disabling the path that was the default would otherwise open the card on a mode
    // with no button on the toggle — unreachable and unswitchable.
    expect(SRC).toContain('resolveDefaultMode(settings?.preferences, createModes)');
  });

  it('gates the path on the SHARED readiness rule, not on the preference alone', () => {
    // isProjectModeReady = preference on AND projectLinkID mapped. The preference
    // alone would offer a path that writes to a column that does not exist.
    expect(SRC).toContain('const projectReady = isProjectModeReady(');
    expect(SRC).toMatch(/projectMode = !isEdit && projectReady && createMode === CREATE_DISCUSSION_MODES\.PROJECT/);
  });

  it('reads the mapping from the LIVE settings, falling back to the store', () => {
    expect(SRC).toContain("settings?.columns?.discussions || getColumns('discussions')");
  });
});

describe('the project cell', () => {
  it('reuses the card\'s own dropdown markup, not a new one', () => {
    // Owner spec: the project cell should look like the template cell. A second
    // dropdown implementation is how the two would drift.
    const cell = SRC.slice(SRC.indexOf('{projectMode && ('));
    const block = cell.slice(0, cell.indexOf('{/* Row 1'));
    expect(block).toContain('styles.customDropdown');
    expect(block).toContain('styles.dropdownTrigger');
    expect(block).toContain('styles.dropdownMenu');
    expect(block).toContain('styles.dropdownSearch');
  });

  it('renders ONLY in project mode — never in edit or the other paths', () => {
    expect(SRC).toContain('{projectMode && (');
  });

  it('separates "no projects on the board" from "search found none"', () => {
    expect(SRC).toContain("'אין פרויקטים בלוח המקושר'");
    expect(SRC).toContain("'לא נמצאו פרויקטים מתאימים'");
  });

  it('loads candidates through the shared cached reader, only when ready', () => {
    // Passing a null boardKey when the path is off keeps an unconfigured instance
    // from firing the settings + items queries at all.
    expect(SRC).toContain("useRelationItems(projectReady ? 'discussions' : null, projectReady ? 'projectLinkID' : null)");
  });
});

describe('switching away from the project path drops the project', () => {
  /*
   * A project left in state after switching to מתבנית/מזדמן would be WRITTEN by the
   * submit (the payload spreads on `projectId`), linking the discussion to a project
   * the user had switched away from.
   */
  it('clears the id, the name and the open menu', () => {
    const sw = SRC.slice(SRC.indexOf('const switchCreateMode'));
    const body = sw.slice(0, sw.indexOf('\n  };'));
    expect(body).toContain('if (nextMode !== CREATE_DISCUSSION_MODES.PROJECT && projectId) {');
    expect(body).toContain('setProjectId(null)');
    expect(body).toContain("setProjectName('')");
  });
});

describe('the project path hides "דיון קודם"', () => {
  /*
   * round383 (owner spec) — the predecessor of a project discussion is resolved from
   * the project itself, so asking the user to pick one by hand offers a manual answer
   * to a question the app already answers. Exactly why the TEMPLATE path has hidden
   * this cell since round367 — the project path joins the same rule.
   */
  it('adds projectMode to the hide rule', () => {
    const rule = SRC.slice(SRC.indexOf('const hidePreviousDiscussion ='));
    const body = rule.slice(0, rule.indexOf(';') + 1);
    expect(body).toContain('templateMode');
    expect(body).toContain('|| projectMode');
  });
});

describe('the write', () => {
  it('sends projectLinkID ONLY when a project was picked', () => {
    // A board_relation write of an empty list CLEARS the column, so sending the key
    // unconditionally would wipe the link when a project discussion is edited.
    expect(SRC).toContain('...(projectId ? { projectLinkID: projectLinkValue(projectId) } : {}),');
  });

  it('goes through projectLinkValue rather than building the shape inline', () => {
    const submit = SRC.slice(SRC.indexOf('const optimisticShape'));
    expect(submit.slice(0, 900)).not.toMatch(/linkedItems:\s*\[\{\s*id:/);
  });
});

describe('the auto name is the SAME gate as the template path', () => {
  it('routes the project pick through canAutoName', () => {
    const pick = SRC.slice(SRC.indexOf('const pickProject'));
    const body = pick.slice(0, pick.indexOf('\n  };'));
    /*
     * The gate must be the WHOLE condition. Asserting only that canAutoName appears
     * let a mutation through (`if (true || canAutoName({…`) that kept the call and
     * defeated the gate — which would overwrite a name the user typed.
     */
    expect(body).toMatch(/\n\s*if \(canAutoName\(\{\n/);
    expect(body).toContain('buildAutoName(');
    // ...and it stamps the trailing date, or the NEXT pick would read the name it
    // just wrote as user-typed and refuse to update it.
    expect(body).toContain('lastAutoDateRef.current = formatNameDate(date);');
  });

  it('reuses the templateAutoName preference rather than inventing a second one', () => {
    const pick = SRC.slice(SRC.indexOf('const pickProject'));
    expect(pick.slice(0, 1200)).toContain("resolvePreference(settings?.preferences, 'templateAutoName')");
  });
});

describe('the reveal rule is shared, so the two folding paths cannot drift', () => {
  it('computes formRevealed from isFormRevealed with the mode\'s own subject', () => {
    expect(SRC).toContain('const formRevealed = isFormRevealed({');
    expect(SRC).toContain('subjectChosen: projectMode ? projectChosen : typeChosen,');
    // the old hand-rolled boolean must be gone, or one path keeps the old rule
    expect(SRC).not.toContain('isEdit || isDuplicate || !templateMode || typeChosen');
  });
});

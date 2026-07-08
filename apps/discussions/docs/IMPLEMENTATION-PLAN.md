# תוכנית יישום — 9 התיקונים הקטנים

> נוצר ע"י workflow (9 סוכני תכנון שקראו את הקוד העדכני + סוכן סינתזה). מבוסס על `docs/small-fixes.md`.
> סביבת ווריפקציה: ריצה מקומית `npm run dev` (:5180) + tunnel ל-monday board https://yomsheni-il.monday.com/custom_objects/18419665045
> טסטים: `npx vitest run <file>` / `npm run test:run`. **לא יושם עדיין — תוכנית בלבד.**

---

## סקירת ביצוע (סינתזה)

### רכיבי-יסוד משותפים (לבנות פעם אחת, לפני השאר)
- **MenuPill (src/components/MenuPill/)** — NEW shared single-level group-by pill (MenuPill.jsx + .module.css + index.js), modeled on the LIVE MyTasksView controls/BuilderControl.jsx + Segment.jsx pattern (NOT the doc's stale 'local MenuPill 65-118' which no longer exists). Desktop @vibe Dialog popover + mobile bottom-sheet, single flat option list with applied/none state. CRITICAL: classNameStrategy is 'non-scoped' so all class names are GLOBAL — use distinctive names (mpPill/mpItem/...) that do NOT collide with builder.module.css (.bPill) or MyTasksView.module.css (.pill). Panel/sheet must be RTL (Hebrew tabs), unlike builder's LTR chrome.  
  _בשימוש בנקודות:_ Point 1 (TasksTab group pill), Point 1 (PreviousTasksTab group pill)
- **CollapseAllButton (src/components/CollapseAllButton/)** — NEW shared wrapper around @vibe IconButton that bakes in tooltipProps={{ getContainer: () => document.body }} (so the tooltip portals out of DiscussionCard's overflow-y:auto .body and isn't clipped) plus size='small' kind='tertiary' and the Collapse/Expand icon+label swap. Props: collapsed, onClick, style (for TopicsTab left-pin), optional labels. Confirmed @vibe supports tooltipProps (IconButton.d.ts:67) and getContainer (Tooltip.d.ts:47).  
  _בשימוש בנקודות:_ Point 2 (TasksTab + PreviousTasksTab collapse tooltip), Point 3 (TopicsTab collapse tooltip + left-pin via style)
- **FieldClearButton (local helper)** — Small inline X-clear button (@vibe/icons CloseSmall, absolutely positioned at field's visual-left, onMouseDown preventDefault + onClick stopPropagation to survive the modal's window pointerdown listener). Per the point-4 plan, keep it LOCAL inside CreateDiscussionModal.jsx — do NOT prematurely extract. Point 5's type-clear is a separate inline span specific to TypeDropdown and deliberately does NOT couple to this. If both ship and a shared version is wanted later, promote to src/components/FieldClearButton/ as a follow-up.  
  _בשימוש בנקודות:_ Point 4 (CreateDiscussionModal per-field clears)
- **discussionColor + DISCUSSION_PALETTE (in grouping.js)** — Local 20-color monday LABEL palette (hex literals mirroring theme-tokens.css --topic-color-1..20, confirmed present) + FNV/imul string hash identical to TopicsTab.topicColorStartIndex, giving stable per-discussion accent colors. Kept LOCAL/CSS-free so grouping.js stays jsdom-unit-testable (no getComputedStyle). Optional future cleanup: extract src/utils/labelPalette.js shared with TopicsTab — out of scope.  
  _בשימוש בנקודות:_ Point 6 (My Tasks group-by-discussion accent color)
- **--list-row-height token + ROW_SKELETON_H/TOPIC_SKELETON_H consts** — OPTIONAL single-source-of-truth so skeleton heights and real row min-heights never drift again: a --list-row-height CSS token in theme-tokens.css applied to DiscussionList .item min-height, plus module-level JS numeric consts passed to the Skeleton height prop with comments tying them together. Heights MUST be MEASURED in DevTools (in-product, not local) before committing — the plan's 36/52 are estimates.  
  _בשימוש בנקודות:_ Point 7 (DiscussionList + TopicsTab skeleton sizing)

### סדר ביצוע מומלץ
**שלב 1** — נקודות Point 2 — CollapseAllButton + tooltip getContainer fix (TasksTab, PreviousTasksTab, TopicsTab)  
  Build the shared CollapseAllButton wrapper FIRST because Point 3 consumes it (TopicsTab tooltip absorbed there). Establishing the wrapper before Point 1 also means the single-source for the collapse control exists before the parallel toolbar edits begin. Small effort, unblocks Point 3.
**שלב 2** — נקודות Point 3 — TopicsTab flush-left collapse button (CSS justify-content + style prop)  
  Depends on Point 2: the tooltip fix is already delivered via CollapseAllButton, so Point 3 only owns the flush-left CSS (.toolbar justify-content:space-between + width) and the style prop passed to CollapseAllButton. Sequencing right after Step 1 keeps the single TopicsTab.jsx toolbar JSX block edited consistently (one author, no duplicate tooltipProps). RTL/LTR side must be verified in-browser.
**שלב 3** — נקודות Point 1 — MenuPill extraction + wiring into TasksTab + PreviousTasksTab group control  
  Largest effort (M) and needs the NEW MenuPill shared component built before wiring. Touches the SAME TasksTab/PreviousTasksTab toolbars as Point 2; run AFTER Point 2's collapse edits land so both toolbar regions are reconciled by one sequence rather than merged. Build MenuPill component+CSS first, then rewrite the two .groupSelect blocks, then clean dead .groupSelect/.groupNativeSelect CSS.
**שלב 4** — נקודות Point 4 — CreateDiscussionModal X-clears + remove 'none' options + full-cell date picker, Point 5 — TemplateManagerModal dup-type validation + button text + back button + X/chevron  
  Both are self-contained modal work in DISJOINT files (CreateDiscussionModal vs TemplateManagerModal) with no shared-component dependency, so they batch in parallel. Coordinate only on the soft FieldClearButton-vs-inline-X decision (keep separate per both plans). Independent of Steps 1-3 and 5.
**שלב 5** — נקודות Point 6 — My Tasks group-by-discussion accent color (grouping.js), Point 8 — Center 'משימה' header in My Tasks (MyTasksTable.module.css), Point 9 — My Tasks sticky toolbar opaque background + top-padding bleed (MyTasksView.module.css), Point 7 — Skeleton loader sizes (DiscussionList, TopicsTab, optional theme-tokens token)  
  All small, independent CSS/pure-logic fixes touching DISTINCT files: Point 6=grouping.js, Point 8=MyTasksTable.module.css, Point 9=MyTasksView.module.css, Point 7=DiscussionList + TopicsTab CSS/jsx + optional theme-tokens. They batch together. Note Points 6/8/9 all live under MyTasksView/ but in different files; Point 7 touches TopicsTab CSS (.loading) which is a different block from Point 3's .toolbar, and theme-tokens.css end-of-file (no conflict with Point 9's MyTasksView edit). Point 7 requires DevTools measurement in-product.

### קונפליקטים / קבצים משותפים לתיאום
- placeholder

### אסטרטגיית טסטים כללית
"Vitest (jsdom, config in vite.config.js test: block; setupTests.js imports ./i18n + stubs matchMedia/ResizeObserver/IntersectionObserver). Per point, add smoke specs that (a) render the component with Hebrew strings resolving and (b) assert behavior. KEY jsdom LIMITATION: @vibe Dialog does NOT open in jsdom, so for MenuPill (Point 1) and any @vibe popover, test the MOBILE bottom-sheet branch (opens via plain React state) and assert only the trigger on desktop; for tooltip portaling (Points 2/3) assert the prop is forwarded (mock IconButton) rather than querying portalled DOM. Point 6's grouping.js is a pure CSS-free module — assert deterministic/stable hex colors and palette membership directly. Points 8/9 assert class presence / computed background (non-scoped CSS makes literal #ffffff fallback resolve in jsdom). Point 7 asserts skeleton count + height prop value. Run `npm run test:run` for the full suite (must keep myTasksView.smoke + componentRender.smoke green) and `npx vitest run <file>` per new spec. Then IN-PRODUCT verification is mandatory for every point: `npm run dev` (:5180) + `npm run tunnel` into board https://yomsheni-il.monday.com/custom_objects/18419665045 — visual checks for RTL/LTR correctness (the page is RTL but several toolbars/modals/tables are dir=ltr, the whole-class risk), desktop popover/tooltip behavior, the My Tasks pill parity, and Point 7's height MEASUREMENT via DevTools (in-product theme tokens differ from local). Mobile: re-verify in the monday mobile app (or ~390px viewport) for pill bottom-sheets, sticky toolbar opacity, flush-left button, centered header — noting the deploy→mobile cache caveat (bump version or force-quit to bust the stale bundle)."

### סיכונים גלובליים
- RTL/LTR confusion is the single biggest cross-cutting risk: the document is RTL but TopicsTab toolbar, both modals (CreateDiscussionModal, TemplateManagerModal), and the My Tasks table/toolbar are dir='ltr'. 'left edge', clear-button side, centered header, chevron direction, and the MenuPill panel/sheet alignment can all land on the wrong visual side. MUST verify visually in-browser (jsdom cannot validate visual side) for Points 1, 3, 4, 5, 8, 9.
- NON-SCOPED CSS Modules (classNameStrategy:'non-scoped') make ALL class names global. New components (MenuPill, CollapseAllButton) and new rules must use distinctive names to avoid bleeding across components — .pill already exists in MyTasksView.module.css and .bPill in builder.module.css. A name collision silently restyles unrelated components.
- @vibe Dialog/Tooltip do NOT render/open in jsdom — desktop popover and portalled-tooltip behavior are untestable in unit tests. Mitigate by testing the mobile sheet branch and forwarded props; rely on in-product tunnel verification for desktop behavior.
- Import-trimming hazard: removing Dropdown/IconButton/Collapse/Expand from a file's @vibe imports when still used elsewhere breaks the build. PreviousTasksTab still needs Dropdown (previous-discussion picker). GREP each file before trimming any import (Points 1 & 2).
- Skeleton heights in Point 7 are ESTIMATES (36/52) — committing without measuring in DevTools (in-product, since iframe theme tokens differ from local and mobile padding differs) re-introduces the mismatch the point is meant to fix.
- Behavior-change vs old controls needs product sign-off: Point 1's MenuPill shows icon+label (selection via highlight+check) instead of the old Dropdown's inline selected-label — confirm during review whether the selected value should appear on the pill face. Point 6's saturated palette hexes on white may be low-contrast for group TITLE text (consistent with existing status/priority titles) — flagged, not blocking.
- Modal pointerdown/blur races: Point 4's FieldClearButton and Point 5's inline type-clear sit inside dropdown triggers/close-on-pointerdown listeners — they MUST onMouseDown preventDefault + onClick stopPropagation or the clear gets swallowed or toggles the menu. Point 5's X must be a role=button span (not a nested <button>, invalid inside the trigger button).
- Sentinel-state integrity (Point 4): removing visible 'none'/'ללא...' options is cosmetic only — the underlying 'none'/null sentinels drive handleSubmit and edit-mode clear logic and MUST stay; changing initial state away from 'none' breaks submit guards.
- Observability rule: never console.* — Point 5's dup-type validation toast must go through logger.error (passes a plain Hebrew string, not an Error, for a clean toast via useUiErrorSink).
- Deploy is manual and NOT to be run unless asked; build output is build/ (not dist/); app id 11457413. Mobile testing of a deployed build hits the stale-cache caveat (same live version reuses CDN URL) — bump a new version or force-quit the app.

---

## תוכנית מפורטת לכל נקודה

### Point 1 — Group-by MenuPill in TasksTab + PreviousTasksTab (design parity with My Tasks)
**מורכבות:** M · **תלוי ב:** Point 2/3 (tooltip clipping / collapse-all alignment) touch the SAME toolbars in TasksTab/PreviousTasksTab/TopicsTab — coordinate edits to the same JSX regions to avoid merge conflicts. No logical dependency, but sequence them or rebase carefully.

**גישה:** The analysis doc is STALE: My Tasks no longer has a local `MenuPill` (jsx:65-118 no longer exists). The styled control to mimic is the generic `BuilderControl` pill (`.bPill` in src/components/MyTasksView/controls/builder.module.css) which wraps a @vibe `Dialog` popover (desktop) + bottom-sheet (mobile) with `Segment` option lists. The two discussion tabs (TasksTab, PreviousTasksTab) instead use a plain @vibe `Dropdown` inside `.groupSelect`. I will extract a NEW, self-contained shared component `src/components/MenuPill/` (Component.jsx + .module.css + index.js) that reproduces the My-Tasks pill look-and-behavior but for a SINGLE-LEVEL option list (no Sort/Filter sentence complexity): a `.bPill`-styled trigger (icon `Group` from @vibe/icons + label + optional `applied` blue fill), opening a desktop @vibe Dialog popover with a flat option list (reusing the `.bMItem`/`.bMItemSel`/`.bMCheck` visual language) and a mobile bottom-sheet branch (so it is testable in jsdom and matches My Tasks on phones). The component takes `options=[{value,label}]`, `value`, `onChange`, plus `label`/`icon`/`mobile`. It must support a "none"/empty value: when the active value is the none-option, the pill is NOT in the `applied` state and shows no count; My Tasks always-grouped just never passes a none option. Then I rewrite each tab's `.groupSelect` Dropdown block to render `<MenuPill>` with that tab's own options array (TasksTab: GROUP_OPTIONS none/status/person; PreviousTasksTab: groupOptions which already appends `discussion` in byType mode), wiring `value=groupBy`, `onChange=(v)=>{setGroupBy(v); setCollapsed({});}`. Grouping logic, the collapse IconButton, and all data flow stay untouched — design-only. To get the mobile branch I add a `useViewport()` call (already used app-wide) in both tabs and pass `mobile={isMobile}`.

**רכיבים משותפים:**
- `MenuPill` — CREATE new shared single-level group-by pill in src/components/MenuPill/ (Component.jsx + .module.css + index.js), modeled on the live MyTasksView controls/BuilderControl.jsx + Segment.jsx pattern (NOT the doc's stale 'MyTasksView local MenuPill 65-118', which no longer exists). Consume in TasksTab + PreviousTasksTab.
- `MyTasksView BuilderControl` — DO NOT refactor My Tasks to use the new MenuPill — its group control is the multi-segment BuilderControl (column+order), not a single-level pill. Leave it as-is; MenuPill only borrows its visual style.

**קבצים חדשים:** `src/components/MenuPill/MenuPill.jsx`, `src/components/MenuPill/MenuPill.module.css`, `src/components/MenuPill/index.js`, `src/components/MenuPill/__tests__/menuPill.smoke.test.jsx`, `src/components/TasksTab/__tests__/tasksTabGroup.smoke.test.jsx`, `src/components/PreviousTasksTab/__tests__/previousTasksTabGroup.smoke.test.jsx`

**שינויי קבצים:**
<details><summary><code>src/components/MenuPill/MenuPill.jsx</code> (new file)</summary>

```
NEW shared component. Model on BuilderControl.jsx + Segment.jsx but single-level. Skeleton:

import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer } from '@vibe/core';
import { Group, Check, CloseSmall } from '@vibe/icons';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './MenuPill.module.css';

// Single-level group-by pill, styled to match the My Tasks toolbar builder pill.
// options: [{ value, label }]. `noneValue` (default 'none') marks the un-applied
// option: when value===noneValue the pill is NOT highlighted and shows no count.
export function MenuPill({ icon: Icon = Group, label, options = [], value, onChange,
  noneValue = 'none', mobile = false, title }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom-start');
  const triggerRef = useRef(null);
  const applied = value != null && value !== noneValue;
  const close = () => setOpen(false);
  const pick = (v) => { onChange?.(v); close(); };
  const updatePosition = () => { const r = triggerRef.current?.getBoundingClientRect(); if (!r) return; const n = computeFloatingPosition({ anchorRect: r, preferred: 'bottom-start', popupWidth: 220, popupHeight: 280, offset: 4 }); if (n?.placement) setPosition(n.placement); };
  const pillClass = `${styles.pill}${applied ? ` ${styles.pillApplied}` : ''}${open ? ` ${styles.pillOpen}` : ''}`;
  const list = (big) => options.map((o) => (
    <button key={o.value} type="button" className={`${styles.mItem}${big ? ` ${styles.mItemBig}` : ''}${o.value === value ? ` ${styles.mItemSel}` : ''}`} onClick={() => pick(o.value)}>
      <span className={styles.mLabel}>{o.label}</span>
      {o.value === value ? <Check className={styles.mCheck} /> : null}
    </button>));
  if (mobile) {
    return (<>
      <button type="button" ref={triggerRef} className={pillClass} onClick={() => setOpen(true)} aria-label={label}>
        <Icon className={styles.pillIcon} />{applied ? <span className={styles.badgeDot} /> : null}
      </button>
      {open && (<>
        <div className={styles.backdrop} onClick={close} />
        <div className={styles.sheet} role="dialog" aria-label={title || label}>
          <div className={styles.grab} />
          <div className={styles.sHead}><span className={styles.sTitle}>{title || label}</span>
            <button type="button" className={styles.sClose} onClick={close} aria-label="סגור"><CloseSmall /></button></div>
          <div className={styles.sBody}>{list(true)}</div>
        </div></>)}
    </>);
  }
  return (
    <Dialog open={open} showTrigger={['click']} hideTrigger={['clickoutside','esc']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }} onDialogDidHide={close}
      position={position} zIndex={1000}
      content={() => (<DialogContentContainer><div className={styles.panel}>{list(false)}</div></DialogContentContainer>)}>
      <button type="button" ref={triggerRef} className={pillClass} onMouseDown={updatePosition}>
        <Icon className={styles.pillIcon} /><span>{label}</span>
      </button>
    </Dialog>);
}
export default MenuPill;

Note: the active option's LABEL is shown via the My-Tasks-style `applied` highlight + the menu check, matching My Tasks. If product wants the selected label inline on the pill (like the old Dropdown), add `<span className={styles.pillValue}>{selectedLabel}</span>` — confirm during review; default is icon+label like My Tasks.
```
</details>
<details><summary><code>src/components/MenuPill/MenuPill.module.css</code> (new file)</summary>

```
Copy the relevant rules from builder.module.css, renamed b*→plain (non-scoped strategy → must be unique; prefix `menupill`-ish or keep distinctive names). Port: .pill/.pillApplied/.pillOpen/.pillIcon/.badgeDot from .bPill/.bPillApplied/.bPillOpen/.bPillIcon/.bBadgeDot (lines 12-39); .panel from .bPanel-ish wrapper (direction:ltr? NO — discussion tabs are Hebrew/RTL, so keep panel `direction: rtl` / default; menu text is Hebrew). .mItem/.mItemSel/.mItemBig/.mLabel/.mCheck from .bMItem/.bMItemSel/.bMItemBig/.bMLabel/.bMCheck (lines 116-139). Mobile sheet .backdrop/.sheet/.grab/.sHead/.sTitle/.sClose/.sBody from .bBackdrop/.bSheet/.bGrab/.bSHead/.bSTitle/.bSClose/.bSBody (146-167) with `direction: rtl`. IMPORTANT (non-scoped CSS = global names): do NOT reuse names that collide with builder.module.css or the tabs' module.css. Use distinctive names (e.g. .mpPill, .mpItem) to be safe.
```
</details>
<details><summary><code>src/components/MenuPill/index.js</code> (new file)</summary>

```
export { MenuPill, default } from './MenuPill.jsx';
```
</details>
<details><summary><code>src/components/TasksTab/TasksTab.jsx</code> (2-3, 190-199, +useViewport import & call)</summary>

```
Imports: drop `Dropdown` from the @vibe/core import on line 2 (keep Skeleton, Button, Text, IconButton). Add `import { MenuPill } from '@generated/components/MenuPill';` and `import { useViewport } from '@generated/hooks/useViewport.js';`. Add `const { isMobile } = useViewport();` near the other hooks (after line 51). Replace the `.groupSelect` block (190-199):
BEFORE:
  <div className={styles.groupSelect}>
    <Dropdown options={GROUP_OPTIONS} value={GROUP_OPTIONS.find((o)=>o.value===groupBy)||null} onChange={(opt)=>{setGroupBy(opt?.value??'none');setCollapsed({});}} size="small" clearable={false} insideOverflowContainer />
  </div>
AFTER:
  <MenuPill icon={Group} label="קיבוץ" options={GROUP_OPTIONS} value={groupBy} noneValue="none" mobile={isMobile} title="קיבוץ לפי" onChange={(v)=>{setGroupBy(v??'none');setCollapsed({});}} />
Add `Group` to the `@vibe/icons` import on line 3.
```
</details>
<details><summary><code>src/components/PreviousTasksTab/PreviousTasksTab.jsx</code> (2-3, 657-666, +useViewport)</summary>

```
Imports: drop `Dropdown` from @vibe/core import line 2 ONLY IF it is unused elsewhere — IT IS STILL USED at line 628-636 (the previous-discussion picker), so KEEP `Dropdown`. Add `import { MenuPill } from '@generated/components/MenuPill';`, `import { useViewport } from '@generated/hooks/useViewport.js';`, add `Group` to the @vibe/icons import line 3, and `const { isMobile } = useViewport();` near other hooks. Replace the `.groupSelect` block (657-666):
BEFORE:
  <div className={styles.groupSelect}><Dropdown options={groupOptions} value={selectedGroupOption} onChange={opt=>{setGroupBy(opt?.value??'none');setCollapsed({});}} size="small" clearable={false} insideOverflowContainer /></div>
AFTER:
  <MenuPill icon={Group} label="קיבוץ" options={groupOptions} value={groupBy} noneValue="none" mobile={isMobile} title="קיבוץ לפי" onChange={(v)=>{setGroupBy(v??'none');setCollapsed({});}} />
Keep `selectedGroupOption` only if still referenced; otherwise its const (line 589) can be removed.
```
</details>
<details><summary><code>src/components/TasksTab/TasksTab.module.css</code> (93-95)</summary>

```
The `.groupSelect{width:144px}` wrapper is no longer needed (MenuPill is self-sizing). Either remove `.groupSelect` or leave it dead — prefer removing to avoid confusion. `.groupNativeSelect` (97-113) is already dead and can be removed too (verify no other references first).
```
</details>
<details><summary><code>src/components/PreviousTasksTab/PreviousTasksTab.module.css</code> (.groupSelect)</summary>

```
Same cleanup: remove the now-unused `.groupSelect` wrapper rule if present (grep first).
```
</details>

**טסטים:**
- `src/components/MenuPill/__tests__/menuPill.smoke.test.jsx`:
  - renders the trigger pill with its label and icon (desktop, mobile=false)
  - is NOT in the applied state when value equals the none option ('none')
  - is in the applied/highlighted state when value is a non-none option (asserts pillApplied class present)
  - mobile=true: clicking the pill opens the bottom sheet and lists every option (jsdom can open the sheet — the @vibe Dialog desktop path cannot)
  - mobile=true: clicking an option calls onChange with that option.value and closes the sheet
  - mobile=true: the currently-selected option row shows the check (mItemSel) marker
- `src/components/TasksTab/__tests__/tasksTabGroup.smoke.test.jsx`:
  - renders the group MenuPill trigger labelled 'קיבוץ' instead of the old @vibe Dropdown
  - default group is status — status group header renders
  - mobile: opening the MenuPill sheet lists 'ללא קיבוץ', 'לפי סטאטוס', 'לפי אחראי' and picking 'לפי אחראי' regroups by person (assert a person-group header / 'לא הוקצה' appears)
- `src/components/PreviousTasksTab/__tests__/previousTasksTabGroup.smoke.test.jsx`:
  - byType=true: MenuPill options include 'לפי דיון מקור' (the discussion option appended only in byType mode)
  - byType=false: MenuPill options do NOT include 'לפי דיון מקור'
  - picking a group option calls setGroupBy and resets collapsed (group regroups)

**ווריפקציה:**
- Run `npm run test:run` — all new specs green, existing myTasksView.smoke + componentRender.smoke still pass.
- `npm run dev` (:5180) via tunnel into https://yomsheni-il.monday.com/custom_objects/18419665045. Open a discussion card → 'משימות' tab. Confirm the group-by control is now a borderless pill with a Group icon + 'קיבוץ' label (matching the My Tasks toolbar pill), NOT a bordered @vibe Dropdown.
- Click the pill (desktop): a popover opens listing 'ללא קיבוץ' / 'לפי סטאטוס' / 'לפי אחראי'; the active one shows a check; picking one regroups instantly and the popover closes. Click outside / Esc closes it.
- Verify the pill highlight: select 'לפי סטאטוס' → pill gets the light-blue applied fill; select 'ללא קיבוץ' → pill returns to the un-applied (transparent) state and the collapse-all IconButton hides (groupBy==='none').
- Open the 'משימות קודמות' tab in BOTH modes: linkedDiscussion mode shows none/status/person; byType mode additionally shows 'לפי דיון מקור'. Confirm grouping still works for each.
- RTL check (page is RTL): the pill sits where the old Dropdown was (right cluster of the toolbar via .toolbarRight / .toolbarActions); label text 'קיבוץ' reads correctly RTL; the popover/menu items are right-aligned and the check mark sits on the correct side; no horizontal scroll.
- Mobile (responsive / phone via monday app): the pill collapses to icon-only with a dot when applied; tapping opens a bottom sheet from the bottom listing the options with a grab handle and close X; picking closes the sheet. Compare side-by-side with the My Tasks tab pills for visual parity.
- Confirm the collapse-all IconButton tooltip and the rest of the toolbar are unaffected (this point is design-only).

**סיכונים:**
- Non-scoped CSS Modules (classNameStrategy:'non-scoped') => all class names are GLOBAL. MenuPill.module.css names MUST NOT collide with builder.module.css (.pill etc. already exist in MyTasksView.module.css and .bPill in builder) — use distinctive names (e.g. mpPill/mpItem) or styles will bleed across components.
- @vibe Dialog does NOT open in jsdom — desktop popover behavior is untestable in unit tests (same limitation noted in myTasksView.smoke). Mitigate by exercising the mobile bottom-sheet branch in tests (it opens via plain React state) and asserting only the trigger on desktop.
- Direction: builder.module.css panels are `direction:ltr` (English chrome). The discussion tabs are Hebrew — the ported MenuPill panel/sheet must be RTL or Hebrew labels + check alignment look wrong. Easy to get wrong when copy-porting.
- PreviousTasksTab still imports and uses @vibe `Dropdown` elsewhere (previous-discussion picker, ~628) — do NOT remove the Dropdown import there. Only TasksTab can drop it.
- Behavior change vs old Dropdown: the old Dropdown showed the selected label text inline on the control; the My-Tasks pill shows only icon+label and conveys selection via highlight+menu-check. If product expects the selected value visible on the pill face, add a pillValue span — flagged in approach. Confirm with the user during review.
- Adding `useViewport()` to the tabs is new for these components; verify it's available without extra providers (it's used app-wide, low risk).

---

### נקודה 2 — Collapse-all chevron tooltip clipped at top (DiscussionCard .body overflow)
**מורכבות:** S · **תלוי ב:** נקודה 3 — TopicsTab uses the same CollapseAllButton; point 3's left-edge positioning is handled via the `style` prop on the shared component, so coordinate so both points edit TopicsTab consistently (point 2 = tooltip fix, point 3 = position). No hard blocking dependency, but both touch TopicsTab.jsx:407-416.

**גישה:** The collapse/expand IconButtons live inside DiscussionCard's `.body` (DiscussionCard.module.css:296-303), which has `overflow-y: auto`. The @vibe Tooltip renders inline by default, so it gets clipped at the scroll boundary. Verified in the installed package that @vibe IconButton accepts `tooltipProps?: Partial<TooltipProps>` (IconButton.d.ts:67) and spreads it straight into the inner Tooltip via `Object.assign({}, O, {content,...})` (IconButton.js), and that Tooltip supports `getContainer?: () => HTMLElement` (Tooltip.d.ts:47). The fix is to pass `tooltipProps={{ getContainer: () => document.body }}` so the tooltip portals to body and escapes the scroll container. To avoid duplicating this across the three IconButtons (TasksTab, PreviousTasksTab, TopicsTab — and a 4th identical one already present in TopicsTab note), extract a tiny shared `CollapseAllButton` wrapper in src/components/ that wraps @vibe IconButton and bakes in the `tooltipProps`/`getContainer` plus the shared `size="small" kind="tertiary"`. Each call site then passes only icon/onClick/labels (and TopicsTab keeps its `style` for left-pinning). This also makes point 3's TopicsTab fix share the same component. Effort is small.

**רכיבים משותפים:**
- `CollapseAllButton` — create — extract the collapse/expand IconButton (with baked-in tooltipProps getContainer→document.body) used identically in TasksTab, PreviousTasksTab, and TopicsTab

**קבצים חדשים:** `/Users/ilaish/monday_app/apps/discussions/src/components/CollapseAllButton/CollapseAllButton.jsx`, `/Users/ilaish/monday_app/apps/discussions/src/components/CollapseAllButton/index.js`, `/Users/ilaish/monday_app/apps/discussions/src/components/__tests__/collapseAllButton.smoke.test.jsx`

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CollapseAllButton/CollapseAllButton.jsx</code> (new file)</summary>

```
New shared wrapper. Content:

import { IconButton } from '@vibe/core';
import { Collapse, Expand } from '@vibe/icons';

// Renders inside DiscussionCard .body (overflow-y:auto), so the tooltip must
// portal to document.body or it is clipped at the scroll boundary.
export function CollapseAllButton({ collapsed, onClick, style, collapseLabel = 'קפל הכל', expandLabel = 'פתח הכל' }) {
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <IconButton
      icon={collapsed ? Expand : Collapse}
      onClick={onClick}
      size="small"
      kind="tertiary"
      style={style}
      ariaLabel={label}
      tooltipContent={label}
      tooltipProps={{ getContainer: () => document.body }}
    />
  );
}
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CollapseAllButton/index.js</code> (new file)</summary>

```
export { CollapseAllButton } from './CollapseAllButton';
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TasksTab/TasksTab.jsx</code> (2-3, 200-209)</summary>

```
Drop IconButton from the @vibe/core import and Collapse/Expand from @vibe/icons if now unused elsewhere in the file (grep first — Collapse/Expand may still be used; if so keep them). Add `import { CollapseAllButton } from '@generated/components/CollapseAllButton';`. Replace the IconButton block (lines 201-208) with:

            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />

Keep the surrounding `{groupBy !== 'none' && ( ... )}` guard. Note: in this file collapsed-state label maps to allCollapsed→'פתח הכל' which matches the wrapper default.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/PreviousTasksTab/PreviousTasksTab.jsx</code> (2-3, 667-676)</summary>

```
Add `import { CollapseAllButton } from '@generated/components/CollapseAllButton';` (remove now-unused IconButton/Collapse/Expand imports only if unused elsewhere — grep first). Replace the IconButton block (668-675) with:

            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />

Keep the `{groupBy !== 'none' && tasks.length > 0 && ( ... )}` guard.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/TopicsTab.jsx</code> (2, 406-417)</summary>

```
Add `import { CollapseAllButton } from '@generated/components/CollapseAllButton';`. Replace the IconButton block (407-416) with (NOTE label semantics differ here: anyOpen→'קפל הכל'; pass them explicitly via collapsed prop):

          <CollapseAllButton
            style={{ marginInlineStart: 'auto' }}
            collapsed={!anyOpen}
            onClick={toggleAll}
          />

Because the wrapper treats `collapsed=false` as 'show collapse icon + קפל הכל' and `collapsed=true` as 'show expand icon + פתח הכל', passing `collapsed={!anyOpen}` reproduces the current behavior (anyOpen → Collapse icon + 'קפל הכל'). Keep `marginInlineStart:'auto'` via the style prop (this is point 3's concern; point 2 only changes the tooltip).
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/__tests__/collapseAllButton.smoke.test.jsx`:
  - renders the collapse icon and 'קפל הכל' aria-label when not collapsed
  - renders the expand icon and 'פתח הכל' aria-label when collapsed
  - passes getContainer in tooltipProps so the tooltip portals out of the scroll container (assert via a spy/mock on IconButton, or render and assert the underlying button carries the aria-label — see note)
  - fires onClick when the button is pressed

**ווריפקציה:**
- see verification array above

**סיכונים:**
- getContainer returns document.body, so the tooltip is positioned relative to body — if the iframe/monday host applies a transform on an ancestor, absolute positioning could be slightly off; @vibe handles this with popper, low risk but worth eyeballing position in-product.
- Removing IconButton / Collapse / Expand from a file's imports when they are still used elsewhere would break the build — must grep each file before trimming imports (PreviousTasksTab and TasksTab use Collapse/Expand only here, but verify).
- TopicsTab label/icon semantics are inverted vs the other two tabs (anyOpen drives the Collapse icon). Passing collapsed={!anyOpen} preserves it, but a careless mapping would swap the icon/tooltip — verify visually.
- @vibe Tooltip in jsdom may not render to body in tests; the test should assert the prop is forwarded (mock IconButton) rather than query the portalled DOM, to avoid flakiness.

---

### נקודה 3 — TopicsTab: tooltip clipping fix + "קפל הכל" button flush-left
**מורכבות:** S · **תלוי ב:** Point 2 (Tooltip clipping) — shares the identical `tooltipProps={{ getContainer: () => document.body }}` fix on the @vibe IconButton; TopicsTab is explicitly listed in point 2's fix set (TopicsTab.jsx ~407-416). If point 2 already adds the tooltipProps to TopicsTab, this point only owns the flush-left CSS change. Coordinate to avoid a duplicate edit on the same JSX block., Optional shared component: point 2's note suggests extracting a CollapseAllButton wrapper that bakes in tooltipProps; if that extraction happens, TopicsTab should consume it and this point's tooltip change is absorbed there.

**גישה:** Two coordinated changes to TopicsTab. (1) Tooltip clipping (shared with point 2): the collapse-all IconButton's tooltip is clipped by DiscussionCard's `.body` (`overflow-y:auto`, DiscussionCard.module.css:295-302). Fix by passing `tooltipProps={{ getContainer: () => document.body }}` to the IconButton so the Vibe Tooltip portals outside the scrolling container instead of being clipped. Both `tooltipProps` (IconButton.d.ts:67) and `getContainer` (Tooltip.d.ts:47) are confirmed in @vibe types. (2) Flush-left button: align TopicsTab with TasksTab/PreviousTasksTab, which use `justify-content: space-between` on `.toolbar`. TopicsTab's `.toolbar` (TopicsTab.module.css:14-18) is `display:flex;gap:8px` with no justify, and the IconButton relies on `style={{ marginInlineStart: 'auto' }}` inside a `dir="ltr"` wrap. Because the toolbar wrap is `dir="ltr"`, `margin-inline-start:auto` resolves to margin-LEFT — which in LTR pushes the button to the RIGHT visual edge, not the left as required. The cleanest fix that matches the sibling tabs: add `justify-content: space-between` to `.toolbar` and keep `marginInlineStart:auto` as a belt-and-suspenders for the single-trailing-element case; but since the toolbar can contain 1-3 leading elements (Button, ApplyTemplateMenu) plus the trailing IconButton, `margin-inline-start:auto` on the IconButton alone is the reliable mechanism. The real bug is the `dir="ltr"` flips the visual side. Switch the IconButton to `marginLeft:'auto'` semantics that put it on the LEFT: in the `dir="ltr"` toolbar use `style={{ marginInlineEnd: 'auto', order: ... }}`? Simpler and matches siblings: remove `dir="ltr"` reliance for this and wrap the trailing button so it pins left. Concretely: keep `margin-inline-start:auto` but the toolbar is `dir="ltr"` so start=left=the visual RIGHT under document RTL... To avoid confusion, I add `justify-content: space-between` AND group the leading controls — see fileChanges for the exact, verified approach (wrap leading controls so space-between separates them from the trailing IconButton, putting the IconButton at the LTR-end = visual left under the page's RTL document). Must verify visually in-browser because RTL/LTR interplay here is the whole risk.

**רכיבים משותפים:**
- `CollapseAllButton (optional wrapper around @vibe IconButton baking in tooltipProps getContainer + Collapse/Expand icon swap)` — Consider extracting per point 2's note, used by TasksTab, PreviousTasksTab and TopicsTab. Not required for this point alone — inline tooltipProps is sufficient. If extracted, route TopicsTab through it.

**קבצים חדשים:** `/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/__tests__/topicsTab.toolbar.test.jsx (mocks @generated/hooks/useTopics, @generated/components/ApplyTemplateMenu, and @generated/components/TopicPointRow to render the toolbar without hitting the SDK)`

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/TopicsTab.jsx</code> (406-417)</summary>

```
Add tooltipProps for portal + ensure left-pin. BEFORE:
        {items.length > 0 && (
          <IconButton
            // dir="ltr" toolbar → margin-inline-start:auto pins it to the right edge.
            style={{ marginInlineStart: 'auto' }}
            icon={anyOpen ? Collapse : Expand}
            onClick={toggleAll}
            size="small"
            kind="tertiary"
            ariaLabel={anyOpen ? 'קפל הכל' : 'פתח הכל'}
            tooltipContent={anyOpen ? 'קפל הכל' : 'פתח הכל'}
          />
        )}
AFTER:
        {items.length > 0 && (
          <IconButton
            // The toolbar wrap is dir="ltr"; margin-inline-start:auto resolves to
            // margin-left:auto which pushes this trailing button to the LTR end —
            // the VISUAL LEFT edge of the card (the page document is RTL).
            style={{ marginInlineStart: 'auto' }}
            icon={anyOpen ? Collapse : Expand}
            onClick={toggleAll}
            size="small"
            kind="tertiary"
            ariaLabel={anyOpen ? 'קפל הכל' : 'פתח הכל'}
            tooltipContent={anyOpen ? 'קפל הכל' : 'פתח הכל'}
            tooltipProps={{ getContainer: () => document.body }}
          />
        )}
NOTE: The `margin-inline-start:auto` is correct for left-pin in a dir="ltr" flex container (start=left). The reported 'not flush left' symptom is because when the leading group is short (just the 'נושא חדש' Button), the auto-margin DOES push it left correctly — re-test after deploy; if it still hugs the leading group, the cause is the toolbar lacking a defined width / wrapping, fixed by the CSS change below.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/TopicsTab.module.css</code> (14-18)</summary>

```
Align toolbar with TasksTab/PreviousTasksTab. BEFORE:
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
AFTER:
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
RATIONALE: `justify-content: space-between` makes the trailing IconButton sit at the far (LTR) end = visual LEFT edge of the toolbar (toolbar is dir="ltr", document is RTL), matching the sibling tabs. `width:100%` guarantees the flex line spans the full card width so space-between has room to push the button to the true left edge rather than hugging the leading controls. The IconButton's `marginInlineStart:auto` becomes redundant-but-harmless with space-between (it also pins to the end), so the two mechanisms agree.
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/__tests__/topicsTab.toolbar.test.jsx`:
  - collapse-all IconButton renders with tooltipProps.getContainer returning document.body (asserts the prop is wired so the tooltip portals out of the scrolling .body)
  - collapse-all IconButton is the last child of the toolbar (DOM order) so space-between pins it to the LTR end
  - toggleAll button toggles aria-label between 'קפל הכל' and 'פתח הכל' on click
  - toolbar is not rendered with the collapse button when items is empty (items.length===0 guard)

**ווריפקציה:**
- Run `npm run test:run` (or `npx vitest run src/components/TopicsTab/__tests__/topicsTab.toolbar.test.jsx`) — all green.
- `npm run dev` (:5180) + `npm run tunnel`; open the board https://yomsheni-il.monday.com/custom_objects/18419665045, open a discussion that HAS topics, go to the נושאים tab.
- DESKTOP — flush-left: confirm the double-chevron collapse-all button sits at the far VISUAL LEFT edge of the toolbar, separated from the 'נושא חדש' + 'מתבנית' controls which sit at the visual RIGHT (matching the Tasks/Previous-tasks tabs). Compare side-by-side with the TasksTab toolbar to confirm identical alignment.
- DESKTOP — tooltip not clipped: hover the collapse-all button; the 'קפל הכל'/'פתח הכל' tooltip must render fully ABOVE the button and NOT be cut off by the top edge of the scrollable card body. Scroll the topic list down a bit and hover again to confirm it still escapes the overflow container.
- DESKTOP — toggle behavior: click the button; all topic sections collapse/expand and the icon + tooltip text flip between Collapse/Expand and 'קפל הכל'/'פתח הכל'.
- RTL correctness: the whole page is RTL — explicitly verify 'left edge' means the reader's LEFT (the end of an RTL line). With one short leading control and with the add-topic input expanded (click 'נושא חדש'), the collapse button stays pinned left in both states.
- MOBILE (responsive / monday mobile app or narrow viewport ~390px): re-check the collapse button stays at the left edge and the tooltip is not clipped; if the toolbar wraps, confirm the button still aligns left on its line. Note the deploy→mobile cache caveat (force-quit app or bump version) if testing the deployed build.
- Regression: confirm point 2 (TasksTab/PreviousTasksTab) tooltips still un-clipped — those should get the same `tooltipProps` fix; verify no double-fix conflict in the shared toolbar pattern.

**סיכונים:**
- RTL/LTR confusion is the core risk: the toolbar wrap is dir="ltr" while the document is RTL, so 'left' is easy to get backwards. MUST verify visually in-browser, not just in jsdom (jsdom can't validate visual side). If after the CSS change the button lands on the wrong side, the alternative is to remove the `dir="ltr"` reliance and instead structure the toolbar like TasksTab with explicit .toolbarLeft/.toolbarRight groups.
- `justify-content: space-between` with a wrapping toolbar (flex-wrap not set here, but long content) could push the leading controls and trailing button onto different lines on very narrow mobile; acceptable but verify the button still left-aligns.
- getContainer:()=>document.body portals the tooltip to body — extremely low risk, but in the monday iframe confirm the tooltip still positions correctly relative to the button (Vibe handles this via its positioning engine; visually verify).
- Shared-fix overlap with point 2: if both points are implemented independently, ensure the IconButton tooltipProps change isn't applied twice or with conflicting getContainer targets across TasksTab/PreviousTasksTab/TopicsTab — coordinate on one consistent value (document.body).

---

### נקודה 4 — CreateDiscussionModal: X-clear per field, remove "none" options, full-cell date picker
**מורכבות:** M · **תלוי ב:** Independent of points 1-3, 6-9. Soft overlap with point 5 (TemplateManagerModal also wants X-clear + chevron tweaks): if both ship, consider promoting FieldClearButton to a shared component — coordinate so it isn't created twice.

**גישה:** Three coordinated edits in CreateDiscussionModal.jsx (+ its .module.css). (4.1) Add a shared inline FieldClearButton helper (a small `<button>` with @vibe/icons `CloseSmall`, absolutely positioned at the visual-left/end of each field, rendered only when the field has a value) and wire a clear handler per field: title→setName(''), lead→setLead([]), date→setDate(''), time→setTime(''), participants→setParticipants([]), template→setTemplateId('none'), type→selectType(null) (or setDiscussionType(null) without auto-attach), previous→setPreviousDiscussionId('none'). Because the modal root is `dir="ltr"` (line 410), "left" is the physical left edge — position the clear button with `left` and give the input/trigger right-side padding so text never collides. (4.2) Remove the three "none" option entries: drop `{ value:'none', label:'ללא תבנית' }` from templateOptions (~390-391) and change the selectedTemplateLabel fallback (~398) to a placeholder 'בחר תבנית'; delete the explicit "ללא סוג" `<li>` (~629-636) keeping the 'בחר סוג דיון' placeholder; remove the `{value:'none', label:'ללא דיון קודם'}` prepend in BOTH loadDiscussions branches (~134, ~137) and change selectedPreviousLabel fallback (~383) to 'בחר דיון קודם'. The internal state values stay `'none'`/`null` as the "unset" sentinel (submit logic already treats `'none'`/`null` as unset), so removing the visible options is purely cosmetic and submit stays valid. (4.3) Add `onClick={(e)=>e.currentTarget.showPicker?.()}` to the native date `<input>` (~436) so any click in the cell opens the picker, keeping the existing onChange.

**רכיבים משותפים:**
- `FieldClearButton` — Create as a small local helper inside CreateDiscussionModal.jsx (not a separate folder) — it is only used here and tightly coupled to the modal's .module.css. If point 5 (TemplateManagerModal) also wants an identical X-clear, promote it to src/components/FieldClearButton/ then; for now keep local to avoid premature extraction.

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (1-2)</summary>

```
Add CloseSmall to imports. BEFORE: `import { Text, Button, Flex, Avatar } from '@vibe/core';` AFTER: add new line `import { CloseSmall } from '@vibe/icons';`
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (~19-20)</summary>

```
Add a shared helper component just below initialsOf(): `function FieldClearButton({ onClear, label = 'ניקוי' }) { return (<button type="button" className={styles.fieldClear} onMouseDown={(e)=>e.preventDefault()} onClick={(e)=>{ e.stopPropagation(); onClear(); }} aria-label={label}><CloseSmall size={14} /></button>); }`  (onMouseDown preventDefault stops the window pointerdown listener at line 369 from also firing / blur races; stopPropagation keeps dropdown-open toggles from triggering.)
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (134, 137)</summary>

```
Remove the 'ללא דיון קודם' none option in BOTH branches. BEFORE (134): `setDiscussionOptions([{ value: 'none', label: 'ללא דיון קודם' }, ...opts]);` AFTER: `setDiscussionOptions(opts);`  BEFORE (137): `setDiscussionOptions([{ value: 'none', label: 'ללא דיון קודם' }]);` AFTER: `setDiscussionOptions([]);`
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (382-383)</summary>

```
Replace the previous-discussion display fallback. BEFORE: `const selectedPreviousLabel = discussionOptions.find((o) => o.value === previousDiscussionId)?.label || 'ללא דיון קודם';` AFTER: `const selectedPreviousLabel = discussionOptions.find((o) => o.value === previousDiscussionId)?.label || 'בחר דיון קודם';`  Also wrap the trigger's value span so when previousDiscussionId is 'none' it shows the placeholder styling — change `<span className={styles.dropdownValue}>` (line 673) to `<span className={`${styles.dropdownValue} ${(!previousDiscussionId || previousDiscussionId==='none') ? styles.dropdownPlaceholder : ''}`}>`.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (390-398)</summary>

```
Remove the 'ללא תבנית' none option and fix fallback. BEFORE: `const templateOptions = [ { value: 'none', label: 'ללא תבנית' }, ...templates.map(...) ];` AFTER: drop the first element so `const templateOptions = templates.map((t) => ({ value: t.id, label: ... }));`  BEFORE (398): `templateOptions.find((o) => o.value === templateId)?.label || 'ללא תבנית';` AFTER: `templateOptions.find((o) => o.value === templateId)?.label || 'בחר תבנית';`  Also add placeholder styling on the template trigger value span (line 556): `<span className={`${styles.dropdownValue} ${templateId==='none' ? styles.dropdownPlaceholder : ''}`}>`.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (436-441)</summary>

```
Full-cell date picker + clear button. Wrap the date input in a positioned container and add onClick=showPicker. BEFORE: `<input type="date" className={styles.dateInput} value={date} onChange={(e) => setDate(e.target.value)} />` AFTER: `<div className={styles.fieldWrap}><input type="date" className={styles.dateInput} value={date} onChange={(e) => setDate(e.target.value)} onClick={(e) => e.currentTarget.showPicker?.()} />{date && <FieldClearButton onClear={() => setDate('')} label="ניקוי תאריך" />}</div>`
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (413-420)</summary>

```
Title clear. Wrap the title input area; since header already is flex with closeButton, simplest is to add the clear button conditionally before the input or as an adjacent control. Render `{name && <FieldClearButton onClear={() => setName('')} label="ניקוי שם" />}` inside the header, positioned to the LTR-left of the closeButton (place it just before the closeButton `<button>` so it sits left of the × in LTR flow). Keep titleInput unchanged.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (429-431)</summary>

```
Lead PersonPicker clear. Wrap in fieldWrap and add external clear: BEFORE: `<PersonPicker selected={lead} onChange={setLead} bordered />` AFTER: `<div className={styles.fieldWrap}><PersonPicker selected={lead} onChange={setLead} bordered />{lead.length > 0 && <FieldClearButton onClear={() => setLead([])} label="ניקוי מוביל" />}</div>`
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (447-489)</summary>

```
Time dropdown clear. Add to the timeDropdown's customDropdown wrapper: render `{time && <FieldClearButton onClear={() => setTime('')} label="ניקוי שעה" />}` inside `.customDropdown` (which is position:relative) after the trigger button. Ensure it sits left of the chevron (give trigger extra padding-left when clearable).
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (538)</summary>

```
Participants PersonPicker clear. BEFORE: `<PersonPicker selected={participants} onChange={setParticipants} bordered />` AFTER: `<div className={styles.fieldWrap}><PersonPicker selected={participants} onChange={setParticipants} bordered />{participants.length > 0 && <FieldClearButton onClear={() => setParticipants([])} label="ניקוי משתתפים" />}</div>`
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (543-558)</summary>

```
Template dropdown clear (only when templateId !== 'none'). Inside the `.customDropdown` wrapper after the trigger: `{templateId !== 'none' && <FieldClearButton onClear={() => setTemplateId('none')} label="ניקוי תבנית" />}`.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (592-617)</summary>

```
Type dropdown clear. Inside the `.customDropdown` after the trigger button: `{discussionType !== null && discussionType !== undefined && <FieldClearButton onClear={() => setDiscussionType(null)} label="ניקוי סוג" />}` (use setDiscussionType not selectType to avoid re-running auto-attach side effects on clear).
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (629-636)</summary>

```
Delete the explicit 'ללא סוג' <li>. Remove the entire first `<li role="option" ... onClick={() => selectType(null)}>ללא סוג</li>` block, keeping the `{typeOptions.map(...)}` that follows. The 'בחר סוג דיון' placeholder at line 613 remains the unset display.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.jsx</code> (660-677)</summary>

```
Previous dropdown clear. Inside the `.customDropdown` after the trigger button (not disabled): `{previousDiscussionId && previousDiscussionId !== 'none' && <FieldClearButton onClear={() => setPreviousDiscussionId('none')} label="ניקוי דיון קודם" />}`.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/CreateDiscussionModal/CreateDiscussionModal.module.css</code> (after 90 (.field block) and near .customDropdown)</summary>

```
Add wrapper + clear button styles. `.fieldWrap { position: relative; }`  `.fieldClear { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; background: transparent; color: var(--secondary-text-color, #676879); cursor: pointer; border-radius: var(--border-radius-small, 4px); z-index: 2; }`  `.fieldClear:hover { background: var(--primary-background-hover-color, #f0f3ff); color: var(--text-color, #323338); }`  Note: modal is dir=ltr so `left` is the physical/visual left edge as required. For dropdown triggers the chevron sits at the right (justify-content: space-between), so left placement does not collide; for the date input add `.dateInput { padding-left: 28px; }` style only when clearable (or always reserve space). For .customDropdown add `position: relative` already exists (line 240-242) so fieldClear inside it anchors correctly.
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/__tests__/createDiscussionModal.smoke.test.jsx`:
  - renders the modal with title input and date field when open
  - does not render a 'ללא תבנית' option in the template dropdown
  - does not render a 'ללא דיון קודם' option in the previous-discussion dropdown
  - does not render a 'ללא סוג' option in the type dropdown (placeholder 'בחר סוג דיון' shown when unset)
  - shows a clear (X) button on the title field only when a name is present, and clicking it empties the name
  - shows a clear button on the date field when a date is set and clicking it clears the date
  - date input invokes showPicker on click (spy on HTMLInputElement.prototype.showPicker)
  - submit button stays disabled when name/date/time are unset after clears (validation intact)

**ווריפקציה:**
- npm run dev (:5180) or via tunnel into https://yomsheni-il.monday.com/custom_objects/18419665045; open the board view and click the FAB / '+' to open 'דיון חדש'.
- RTL/LTR note: the modal body is dir=ltr — confirm each X clear button sits at the VISUAL LEFT edge of its field (next to the value, opposite the dropdown chevron which is on the right).
- Title: type a name → X appears on the left of the header; click X → name clears and X disappears; submit button becomes disabled.
- Date: click ANYWHERE in the date cell (not just the calendar glyph) → native date picker opens (Chrome/Edge desktop). Pick a date → X appears; click X → date clears.
- Time: pick a time from the half-hour menu → X appears; click X → resets to 'בחר שעה' placeholder.
- Lead & Participants: select people via PersonPicker → external X appears next to the avatar(s); click X → selection cleared to empty (placeholder Person icon returns).
- Template dropdown: open it → verify NO 'ללא תבנית' row; trigger shows placeholder 'בחר תבנית' when unset; pick a template → X appears; clear returns to placeholder.
- Type dropdown: open → verify NO 'ללא סוג' row; unset shows 'בחר סוג דיון'; pick a type → X appears; clear via X returns to placeholder WITHOUT re-attaching templates.
- Previous-discussion dropdown: open → verify NO 'ללא דיון קודם' row; unset shows 'בחר דיון קודם' in placeholder styling; pick one → X appears; clear returns to placeholder.
- Submit a valid discussion (name+date+time) → confirm it still creates correctly (payload omits type/previous when unset, exactly as before).
- Edit an existing discussion → confirm prefilled values show their X buttons and that clearing previous-discussion in edit mode still sends empty linkedItems (clears the link).
- Mobile: in the monday mobile app / narrow viewport (<560px the row stacks to single column) — confirm X buttons remain tappable and don't overlap the chevron; confirm date showPicker still works (mobile uses native date UI which already opens on tap, so behavior unchanged/correct).
- npx vitest run src/components/__tests__/createDiscussionModal.smoke.test.jsx and npm run test:run (full suite) green.

**סיכונים:**
- dir=ltr on the modal means physical `left` IS the requested visual-left; if anyone later flips the modal to RTL the clear-button side must switch to `right`/logical `inset-inline-start` — document this in a CSS comment.
- The window-level `pointerdown` listener (lines 369-378) closes all dropdowns; the FieldClearButton inside a dropdown's .customDropdown must stopPropagation AND use onMouseDown preventDefault so clicking X to clear a dropdown value does not get swallowed or immediately reopen/close the menu. Verify time/template/type/previous X clicks work while menu is closed.
- Removing the 'none' template/previous options must NOT change the underlying sentinel state ('none'/null) used by handleSubmit; if someone also changes the initial state away from 'none', submit's `previousDiscussionId !== 'none'` guard and edit-mode clear logic (lines 261-266) break. Keep state sentinels intact.
- The date input X overlaps the browser's native calendar glyph in some engines (the glyph is on the right in LTR; X is on the left) — low risk, but verify no visual overlap; may need a touch of padding-left on .dateInput.
- showPicker() is unsupported in older Safari (<16); the optional chaining `?.` makes it a no-op there and the field still works via the native glyph — acceptable graceful degradation.
- PersonPicker has no external clear API; adding an external X is fine (calls onChange([])), but ensure it sits OUTSIDE the PersonPicker trigger button so its click doesn't also toggle the picker open.

---

### 5 — TemplateManagerModal: dup-type validation, button text, back button, X + bigger chevron
**מורכבות:** M · **תלוי ב:** None — fully self-contained in TemplateManagerModal. No overlap with point 4 (CreateDiscussionModal) despite both touching 'X clear' / 'ללא...' UX; the 'ללא סוג' here is the legitimate template placeholder and must stay.

**גישה:** Four independent sub-fixes, all confined to TemplateManagerModal.jsx + its .module.css (no changes to TemplatesContext or templates.js are required — validation is cleanest at the modal layer where both `kind` and the current draft id are in scope). (5.1) Prevent two templates of the SAME kind sharing a discussionType in two layers: (a) in TypeDropdown disable the already-taken types (greying them, non-clickable) by passing a `takenIds` set computed from the other templates of the current kind excluding the one being edited; (b) a guard in `handleSave` that re-checks and, on collision, fires a Hebrew `logger.error` toast and aborts the save. (5.2) Collapse the new-button label to a constant `'תבנית חדשה'`. (5.3) Swap lucide `ChevronRight`→`ChevronLeft`, drop the 'חזרה' text node (keep `aria-label`), and restyle `.backBtn` to black text + larger icon. (5.4) Enlarge the `.typeChevron` font-size and add an inline X clear button to TypeDropdown that resets the value to null, shown only when a value is set; the X must not toggle the dropdown open.

**רכיבים משותפים:**
- `TypeDropdown (local to TemplateManagerModal)` — extend in place — add takenIds prop, disabled-option handling, and inline X clear; no extraction to a shared component warranted (single consumer)
- `FieldClearButton (proposed in point 4)` — do NOT couple to it here — the type clear is a small inline span specific to this trigger; if point 4 lands a shared clear button later, this can optionally adopt it, but no dependency

**קבצים חדשים:** `src/components/__tests__/templateManagerModal.smoke.test.jsx`

**שינויי קבצים:**
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (4)</summary>

```
Import flip for back button. BEFORE: `import { Plus, Trash2, Pencil, ChevronRight, X, GripVertical } from 'lucide-react';`  AFTER: `import { Plus, Trash2, Pencil, ChevronLeft, X, GripVertical } from 'lucide-react';` (also add logger import — see separate change).
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (12 (after styles import))</summary>

```
Add `import logger from '@generated/utils/logger.js';` so the save-guard toast can fire through the funnel (never console.*).
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (16)</summary>

```
TypeDropdown signature gains props. BEFORE: `function TypeDropdown({ value, onChange, options, colorById }) {`  AFTER: `function TypeDropdown({ value, onChange, options, colorById, takenIds }) {`
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (50-57 (trigger block))</summary>

```
Add a larger chevron + an X clear button. Wrap trailing controls. BEFORE the trigger renders just the value span + `<span className={styles.typeChevron} aria-hidden="true">▾</span>`. AFTER, replace the single chevron span with a trailing group:
```jsx
<span className={styles.typeTrailing}>
  {value != null && (
    <span
      role="button"
      tabIndex={0}
      className={styles.typeClear}
      aria-label="נקה סוג"
      onClick={(e) => { e.stopPropagation(); onChange(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(null); } }}
    >
      <X size={14} />
    </span>
  )}
  <ChevronDown className={styles.typeChevron} size={16} aria-hidden="true" />
</span>
```
Add `ChevronDown` to the lucide import. (Alternative if you prefer keeping the ▾ glyph: bump only the CSS font-size — but switching to the lucide icon gives a crisper, size-controllable chevron consistent with the X.) NOTE: the trigger is a `<button>`; the X must be a nested role=button span (not a real <button>, which is invalid inside a button) and MUST `stopPropagation` so it clears instead of toggling open.
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (330-332)</summary>

```
Drop the per-kind 'new' wording divergence is handled at the button (5.2); titles stay. No change needed here for 5.2 since the title strings (`isNew ? 'תבנית חדשה'` / `'תבנית משתתפים חדשה'`) are the header title, not the button. Leave titles as-is unless product also wants the header unified — out of scope for 5.2 which targets the button text at ~517-518.
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (305-322 (handleSave))</summary>

```
Add dup-type validation guard at the top of handleSave (after the `if (!canSave || saving) return;` line, before `setSaving(true)`):
```js
const chosenType = kind === 'topics' ? (draft?.discussionType ?? null) : (pDraft?.discussionType ?? null);
const currentId = kind === 'topics' ? draft?.id : pDraft?.id;
if (chosenType != null) {
  const clash = items.some((t) => t.id !== currentId && t.discussionType === chosenType);
  if (clash) {
    const typeName = typeLabelById[chosenType] || 'סוג זה';
    logger.error('TemplateManagerModal', `כבר קיימת תבנית מסוג זה עבור "${typeName}". בחרו סוג אחר או הסירו את השיוך.`);
    return;
  }
}
```
`items` is already defined at ~299 as the current-kind list, and `typeLabelById` at ~193. Passing a string (no Error object) to logger.error yields a clean Hebrew toast via useUiErrorSink (level ERROR), with no stack noise.
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (346-350 (back button))</summary>

```
BEFORE:
```jsx
<button type="button" className={styles.backBtn} onClick={backToList}>
  <ChevronRight size={16} /> חזרה
</button>
```
AFTER (icon-only, flipped, larger, black via CSS):
```jsx
<button type="button" className={styles.backBtn} onClick={backToList} aria-label="חזרה">
  <ChevronLeft size={19} />
</button>
```
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (442-448 (topics TypeDropdown usage))</summary>

```
Pass takenIds. AFTER:
```jsx
<TypeDropdown
  value={draft.discussionType ?? null}
  onChange={(id) => update((d) => ({ ...d, discussionType: id }))}
  options={typeOptions}
  colorById={typeColorById}
  takenIds={new Set(templates.filter((t) => t.id !== draft.id && t.discussionType != null).map((t) => t.discussionType))}
/>
```
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (483-489 (participants TypeDropdown usage))</summary>

```
Pass takenIds from participantTemplates. AFTER:
```jsx
<TypeDropdown
  value={pDraft.discussionType ?? null}
  onChange={(id) => setPDraft((d) => ({ ...d, discussionType: id }))}
  options={typeOptions}
  colorById={typeColorById}
  takenIds={new Set(participantTemplates.filter((t) => t.id !== pDraft.id && t.discussionType != null).map((t) => t.discussionType))}
/>
```
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (66-73 (TypeDropdown <li> options))</summary>

```
Disable taken types in the menu. The 'ללא סוג' option (line 66) stays enabled. For the mapped options (69-73) BEFORE:
```jsx
{options.map((o) => (
  <li key={o.id} role="option" aria-selected={o.id === value} className={`${styles.typeItem} ${o.id === value ? styles.typeItemSelected : ''}`} onClick={() => { onChange(o.id); setOpen(false); }}>
    {swatch(o.id)}{o.label}
  </li>
))}
```
AFTER:
```jsx
{options.map((o) => {
  const disabled = takenIds?.has(o.id) && o.id !== value;
  return (
    <li key={o.id} role="option" aria-selected={o.id === value} aria-disabled={disabled || undefined}
        className={`${styles.typeItem} ${o.id === value ? styles.typeItemSelected : ''} ${disabled ? styles.typeItemDisabled : ''}`}
        onClick={() => { if (disabled) return; onChange(o.id); setOpen(false); }}>
      {swatch(o.id)}{o.label}
    </li>
  );
})}
```
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.jsx</code> (517-518 (new button label))</summary>

```
BEFORE: `{kind === 'topics' ? 'תבנית חדשה' : 'תבנית משתתפים חדשה'}`  AFTER: `תבנית חדשה`
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.module.css</code> (58-69 (.backBtn))</summary>

```
Make the icon-only back button black + bigger hit area. BEFORE `color: var(--primary-color, #0073ea);` AFTER `color: var(--text-color, #323338);`. Since the text 'חזרה' is removed, also tighten padding so it reads as an icon button: change `padding: 2px 4px;` to `padding: 4px; width: 28px; height: 28px; justify-content: center;` (keeps the existing hover bg rule). Leave `gap`/font-size (harmless with no text).
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.module.css</code> (272 (.typeChevron))</summary>

```
Drop the tiny glyph font-size now that it's a lucide icon, and align it. BEFORE: `.typeChevron { flex-shrink: 0; color: var(--secondary-text-color, #676879); font-size: 10px; }`  AFTER: `.typeChevron { flex-shrink: 0; color: var(--secondary-text-color, #676879); }` (size now controlled by the lucide `size={16}` prop). If you instead keep the ▾ glyph, set `font-size: 15px;`.
```
</details>
<details><summary><code>src/components/TemplateManagerModal/TemplateManagerModal.module.css</code> (after 272 (new rules))</summary>

```
Add trailing-controls + clear-button + disabled-option styles:
```css
.typeTrailing { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.typeClear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%;
  color: var(--secondary-text-color, #676879); cursor: pointer;
}
.typeClear:hover { background: var(--primary-background-hover-color, #f0f3ff); color: var(--text-color, #323338); }
.typeItemDisabled { opacity: 0.45; cursor: not-allowed; }
.typeItemDisabled:hover { background: transparent; }
```
```
</details>

**טסטים:**
- `src/components/__tests__/templateManagerModal.smoke.test.jsx`:
  - renders the new-template button labeled 'תבנית חדשה' on both the נושאים and משתתפים tabs
  - back button renders icon-only with aria-label 'חזרה' and no 'חזרה' text when in edit view
  - TypeDropdown disables a discussionType already taken by another template of the same kind (aria-disabled set, clicking it does not change the value)
  - TypeDropdown does NOT disable the type currently assigned to the template being edited
  - TypeDropdown shows an X clear control only when a value is set, and clicking it resets the value to null without opening the menu
  - handleSave blocks and emits a logger.error (toast) when saving a topics template whose discussionType already belongs to another topics template, and does NOT call createTemplate/updateTemplate
  - handleSave allows the same discussionType across DIFFERENT kinds (one topics + one participants template may share a type)

**ווריפקציה:**
- Run `npm run dev` (:5180) via tunnel into the board https://yomsheni-il.monday.com/custom_objects/18419665045 and open the Templates manager (gear/templates entry in the discussions view).
- 5.2: On the נושאים tab the footer button reads 'תבנית חדשה'; switch to the משתתפים tab — it now ALSO reads 'תבנית חדשה' (previously 'תבנית משתתפים חדשה').
- 5.3: Click 'תבנית חדשה' to enter edit view. The back control top-of-modal is now an icon-only chevron pointing LEFT (toward the list direction), colored black (not blue), slightly larger (~19px), with no 'חזרה' label text. Hover shows the bg highlight; clicking returns to the list. Verify with a screen-reader / inspect that aria-label='חזרה' is present.
- 5.4 chevron: The סוג-דיון trigger chevron is visibly larger/crisper than before. 5.4 clear: select a type — an X appears (right side of trigger); click it — the value resets to 'ללא סוג' and the dropdown does NOT open. When no type is selected, no X is shown.
- 5.1 UI: Create a topics template assigned to type A and save. Create a SECOND topics template, open its type dropdown — type A is greyed/disabled and unclickable; other types selectable. Edit the FIRST template — type A is still selectable for itself (not disabled).
- 5.1 save guard: Temporarily bypass the UI (e.g. assign a type, then in another tab/template) to confirm the save guard — attempt to save a second topics template with a duplicate type; a Hebrew error toast appears ('כבר קיימת תבנית מסוג זה...') and the save is blocked (stays on edit view, list unchanged).
- 5.1 cross-kind: Assign type A to a topics template AND to a participants template — both save successfully (per-kind constraint, not global).
- RTL: The modal root is `dir="ltr"` by design but the page is RTL — confirm the back chevron points the natural 'back to list' direction visually, the X sits at the trailing edge of the type trigger, and Hebrew toast text renders right-aligned/correctly. Check both desktop and mobile widths (modal becomes bottom-sheet under 768px) that the trigger chevron + X don't overflow the 25% type column.

**סיכונים:**
- Nested clickable inside the trigger <button> requires role=button span + stopPropagation or the X opens the menu.
- logger.error toast: pass a plain string (no Error) for a clean message; repeated string messages each toast (log-once keys on Error instances).
- Inline `new Set(...)` per render is cheap given few templates; TypeDropdown isn't memoized so no staleness.
- Icon-only back button needs padding/box adjustment or it looks oversized after the text is removed.
- Edit-view header title divergence is intentionally left unchanged (out of 5.2 scope).

---

### נקודה 6 — My Tasks "group by discussion": deterministic per-discussion accent color from the monday label palette
**מורכבות:** S

**גישה:** In `groupByDiscussion` (grouping.js) replace the hardcoded `color: null` with a color chosen deterministically by hashing the discussion id into a fixed monday-label palette (`hash(discId) % N`). I will reuse the exact 20-color monday LABEL palette already present in `theme-tokens.css` (`--topic-color-1..20`) and the exact same FNV-style string hash that `TopicsTab.topicColorStartIndex` uses, so the My-Tasks discussion accent is visually consistent with the topics palette and 100% stable across renders (no Math.random). Because grouping.js is a pure, CSS-free module that is unit-tested in jsdom, I define the palette inline as literal hex strings (the same hexes the CSS comments document, e.g. `#00c875`) rather than `hsl(var(--topic-color-N))` — this matches the existing rendering contract where `grp.color` for status/priority groups is already a raw hex string passed straight into `style.color`. The "No discussion" bucket keeps `color: null` (stays neutral grey like today). No render changes are needed: the color already flows to the chevron and group title via `style.color` (MyTasksView.jsx ~384/388) and to the table's left-border accent via `--group-color` (MyTasksTable.module.css:86). For the accessibility concern, the chosen palette hexes are the same saturated monday label colors already used as full-text color for status/priority group titles, so behavior is consistent; if contrast is judged too weak in-product, the optional follow-up (color the chevron + a leading dot, keep title near-black) is noted as a low-effort tweak but is NOT part of this change to keep parity with the other groupings.

**רכיבים משותפים:**
- `discussionColor + DISCUSSION_PALETTE (in grouping.js)` — create-local — duplicates the hash logic of TopicsTab.topicColorStartIndex + the theme-tokens palette by design (grouping.js must stay CSS/React-free for unit tests). Optional future cleanup: extract a shared `src/utils/labelPalette.js` exporting the hash + palette and have BOTH TopicsTab and grouping.js import it; out of scope for this S fix.

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/grouping.js</code> (~24-31 (new palette+hash, placed near the top with the other module constants) and 64-85 (groupByDiscussion))</summary>

```
ADD a palette + hash helper near the top of the module (after the NO_* constants, ~line 31):

// 20-color monday LABEL palette (hex), mirrors theme-tokens.css --topic-color-1..20
// and the same hash used by TopicsTab.topicColorStartIndex, so a discussion's
// accent here matches the topics palette and is STABLE across renders.
const DISCUSSION_PALETTE = [
  '#00c875', '#037f4c', '#9cd326', '#cab641', '#ffcb00',
  '#fdab3d', '#ff6d3b', '#ff7575', '#df2f4a', '#bb3354',
  '#e50073', '#ff5ac4', '#9d50dd', '#784bd1', '#7e3b8a',
  '#5559df', '#225091', '#579bfc', '#007eb5', '#4eccc6',
];
function discussionColor(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return DISCUSSION_PALETTE[h % DISCUSSION_PALETTE.length];
}

Then in groupByDiscussion change the group seed (currently line 73-78):
BEFORE:
      groups.set(key, {
        key,
        discId: d ? d.id : null,
        label: d ? d.name : (noDiscussionLabel || 'ללא דיון'),
        color: null,
        status: undefined,
        items: [],
      });
AFTER:
      groups.set(key, {
        key,
        discId: d ? d.id : null,
        label: d ? d.name : (noDiscussionLabel || 'ללא דיון'),
        color: d ? discussionColor(d.id) : null,
        status: undefined,
        items: [],
      });
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/__tests__/grouping.test.js`:
  - groupMyTasks — discussion > assigns a non-null hex color to each real discussion group (matches /^#[0-9a-f]{6}$/i)
  - groupMyTasks — discussion > color is DETERMINISTIC: grouping the same tasks twice yields identical colors per group key
  - groupMyTasks — discussion > the same discussion id always maps to the same palette color across separate calls / different task arrays
  - groupMyTasks — discussion > the 'No discussion' bucket keeps color null
  - groupMyTasks — discussion > every assigned color is a member of the documented monday palette (in the DISCUSSION_PALETTE set)
  - groupMyTasks — discussion > two different discussion ids that hash to different buckets get different colors (e.g. pick ids that collide-free)

**ווריפקציה:**
- Run unit tests: `npx vitest run src/components/MyTasksView/__tests__/grouping.test.js` — all new + existing cases green.
- Local dev: `npm run dev` (:5180) or via the tunnel into board https://yomsheni-il.monday.com/custom_objects/18419665045. Open the app, switch to the top-left 'המשימות שלי' (My Tasks) tab.
- In the toolbar open 'Group by' (the Group pill) and choose 'לפי דיון' / discussion grouping. OBSERVE: each discussion group's chevron + title now renders in a distinct monday label color (green/orange/blue/purple/etc.) instead of grey, and each table shows a matching colored left-border accent (the `--group-color` inset shadow).
- Stability check: collapse/expand groups, toggle Filter/Sort, switch group mode to status and back to discussion, and re-mount (switch tabs away and back). CONFIRM the SAME discussion keeps the SAME color every time (no flicker/recolor on re-render) — this is the key 'not Math.random' assertion.
- Confirm the 'ללא דיון' (No discussion) group stays neutral grey (color null).
- Cross-check consistency: a discussion that also appears in the Topics tab uses the same palette family — colors should look like the monday label set, not arbitrary.
- RTL: the app is RTL but the My Tasks group rows are intentionally `direction: ltr` (chevron left of title). Verify the colored chevron sits to the LEFT of the colored title and the left-border accent is on the visual left of the table — matches existing status/priority grouping layout, no regression.
- Mobile: open the same board in the monday mobile app (or narrow viewport). Verify colored headers render and remain readable at small width; horizontal table scroll still works and the colored sticky-left name column keeps its accent.

**סיכונים:**
- Contrast/accessibility: a few palette hexes (e.g. egg_yolk #ffcb00, bright_green #9cd326) on a white background are low-contrast for the 18px group TITLE text. This matches how status/priority group titles already render, so it is consistent — but if product wants stricter contrast, apply the noted follow-up (color only the chevron + a leading dot, keep the title text near-black). Flagging, not blocking.
- Hash collisions: with only 20 palette slots, two unrelated discussions can share a color. This is expected/acceptable for an accent and matches TopicsTab behavior; the test that asserts 'different ids -> different colors' must pick ids known not to collide (verify the chosen sample ids hash to distinct buckets).
- Palette drift: the hex array duplicates the hexes documented in theme-tokens.css comments. If those CSS triplets are ever changed, this JS array won't auto-update. Mitigated by a code comment pointing back to --topic-color-1..20; acceptable since grouping.js must stay CSS-free for jsdom unit tests.
- Pure-module purity: keep the helper free of DOM/CSS-var reads (no getComputedStyle) so the existing jsdom unit tests keep passing without a real :root.

---

### נקודה 7 — Skeleton loader sizes must match real element heights everywhere
**מורכבות:** S · **תלוי ב:** Point 9 (My Tasks toolbar/background) touches MyTasksView CSS but NOT the MyTasks skeleton height — no real conflict, but coordinate if both edit MyTasksView files., No hard dependency on other points; purely additive layout fix.

**גישה:** Two skeletons are mismatched; the other three (TasksTab/PreviousTasksTab/MyTasks at height=36) already match their rows and stay untouched. (1) DiscussionList: the skeleton row is 56px but the real `.item` row is a single 14px line with 8px/12px padding (~34px content). Also the skeleton container `.skeletonList` uses `gap:8px; padding:16px` while the real `.list` uses `gap:2px; padding:4px`, so spacing "jumps" too. Fix both height and container spacing to match the real list. (2) TopicsTab: the skeleton is 48px in a `gap:16px` container, but each real topic is a full white CARD (header padding 9px/12px ~42px + body + 1px border + shadow), taller and dynamic. Bump the skeleton to approximate a real collapsed topic card (header-only height) — measured in the browser. EXACT pixels MUST be measured via DevTools during implementation, not the estimates here. To prevent future drift, introduce a single shared `--list-row-height` CSS token (and a `--topic-card-min-height`) in theme-tokens.css, apply it to BOTH the real row min-height and the Skeleton height (passed inline as a number after reading the computed value, OR by wrapping Skeleton in a div whose CSS height = the token and using Skeleton fullWidth height matching). Simplest robust approach: set explicit `min-height` on real rows equal to the token, and pass the same numeric literal to the Skeleton, with a code comment tying them together. No behavior change, pure layout.

**רכיבים משותפים:**
- `--list-row-height (CSS token in theme-tokens.css) + per-file JS height consts (ROW_SKELETON_H / TOPIC_SKELETON_H)` — create (optional single-source-of-truth so skeleton height and real row min-height never drift again)

**קבצים חדשים:** `/Users/ilaish/monday_app/apps/discussions/src/components/DiscussionList/__tests__/skeletonHeight.test.jsx`, `/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/__tests__/skeletonHeight.test.jsx`

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/DiscussionList/DiscussionList.jsx</code> (443-447)</summary>

```
Lower the discussion-list skeleton height from 56 to the MEASURED real row height (estimate ~36, confirm in DevTools). Before:
  <div className={styles.skeletonList}>
    {Array.from({ length: 6 }).map((_, i) => (
      <Skeleton key={i} type={"rectangle"} fullWidth height={56} />
    ))}
  </div>
After (use the measured value; example uses 36 and a shared constant):
  // ROW_SKELETON_H must equal the real .item rendered height (see DiscussionList.module.css .item). MEASURE in DevTools.
  const ROW_SKELETON_H = 36; // measured
  ...
  <div className={styles.skeletonList}>
    {Array.from({ length: 6 }).map((_, i) => (
      <Skeleton key={i} type={"rectangle"} fullWidth height={ROW_SKELETON_H} />
    ))}
  </div>
Define ROW_SKELETON_H as a module-level const near the top of the file (above the component) so it is reused and documented.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/DiscussionList/DiscussionList.module.css</code> (188-193)</summary>

```
Align the skeleton container spacing to the REAL list (.list at 203-208 uses gap:2px; padding:4px). Before:
.skeletonList {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-small, 8px);
  padding: var(--spacing-medium, 16px);
}
After:
.skeletonList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-xs, 4px);
}
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/DiscussionList/DiscussionList.module.css</code> (355-369)</summary>

```
OPTIONAL but recommended for stability: give the real .item an explicit min-height equal to the measured value so skeleton↔row can never drift. Add to .item block:
  min-height: 36px; /* keep in sync with ROW_SKELETON_H in DiscussionList.jsx */
Keep existing padding 8px 12px. If the measured natural height differs from 36, use the measured number in BOTH places.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/TopicsTab.jsx</code> (363-370)</summary>

```
Bump the topic skeleton from 48 to the MEASURED collapsed-topic-card height (estimate ~44-56; the real card has header padding 9px/12px + 1px border + shadow). Before:
  <Skeleton key={i} type={"rectangle"} fullWidth height={48} />
After (use measured value, example 52):
  // TOPIC_SKELETON_H ~= a real collapsed SortableTopicSection card height (header band). MEASURE in DevTools.
  <Skeleton key={i} type={"rectangle"} fullWidth height={TOPIC_SKELETON_H} />
Define const TOPIC_SKELETON_H = 52; // measured, at module top.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/TopicsTab.module.css</code> (9-13)</summary>

```
Check the real inter-section gap (the rendered topic list container, not the .loading block) and align .loading gap to it so spacing does not jump. If real sections sit in a container with gap:8px, change .loading gap from 16px to that value. Before:
.loading { display:flex; flex-direction:column; gap:16px; }
After (match measured real gap, e.g. 8px):
.loading { display:flex; flex-direction:column; gap: 8px; }
Verify the real gap by inspecting the rendered topics container before committing the value.
```
</details>
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/styles/theme-tokens.css</code> (end of file)</summary>

```
OPTIONAL shared constant to prevent future drift. Add:
  --list-row-height: 36px; /* discussion list + task rows; keep skeletons in sync */
Then reference var(--list-row-height) in DiscussionList .item min-height. (Skeleton height prop is JS-numeric, so the JS const ROW_SKELETON_H carries the same value; document the linkage in a comment.) Only add if you want the single-source-of-truth; otherwise the per-file consts suffice.
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/DiscussionList/__tests__/skeletonHeight.test.jsx`:
  - renders 6 loading skeletons with height 36 (not 56) when loading
  - skeletonList container uses the same gap/padding tokens as the real list (no spacing jump)
- `/Users/ilaish/monday_app/apps/discussions/src/components/TopicsTab/__tests__/skeletonHeight.test.jsx`:
  - renders 3 loading skeletons at the measured topic-card height (not 48)

**ווריפקציה:**
- npm run dev (http://localhost:5180) AND in-product via npm run tunnel into the board https://yomsheni-il.monday.com/custom_objects/18419665045 — the iframe theme tokens differ from local, so confirm in-product too.
- MEASURE FIRST (do not guess): open DevTools, let the discussion list finish loading, inspect a real .item row → read its rendered height in the box model (Computed > height). Record the exact px. Repeat for a real collapsed topic card in TopicsTab.
- DiscussionList: throttle network / re-open the list to catch the loading state. Confirm the grey skeleton bars are the SAME height as the real rows that replace them — no visible shrink/jump on load completion. Confirm the gap between skeleton bars matches the gap between real rows (2px) and the container padding matches (4px), so rows don't shift horizontally/vertically when content arrives.
- TopicsTab: open a discussion, switch to the נושאים tab while it loads (or throttle). Confirm skeleton card height approximates a real topic card header band; no large jump.
- RTL correctness: the list and topics are RTL/LTR-mixed (TopicsTab wrap is dir=ltr). Confirm skeletons are fullWidth and span the same horizontal extent as real rows in both directions; the date/name alignment of real rows is unaffected (we only touch heights + container spacing).
- Mobile: in the monday mobile app (or DevTools device emulation at ~375px), repeat the DiscussionList check — rows are denser on mobile; confirm skeleton still matches the mobile row height (re-measure if the row height changes responsively).
- Unchanged controls: confirm TasksTab, PreviousTasksTab and MyTasks skeletons still render at 36 and still match their rows (regression check — we did not touch them).

**סיכונים:**
- Estimated heights (36 for list, ~52 for topic card) are GUESSES — the real values must be measured in the browser; committing the estimate without measuring re-introduces a mismatch.
- monday iframe theme tokens (font-size, spacing) can differ from local dev, changing the natural row height — measure in-product, not only locally.
- Mobile may use a different rendered row height (responsive padding/font); a single constant could be wrong on mobile — verify both viewports and, if they differ, the constant should reflect the common/most-visible case or be made responsive.
- Adding an explicit min-height to .item could clip/grow rows if a row ever wraps to two lines (e.g. very long name) — but name is white-space:nowrap + ellipsis, so single-line is guaranteed; still confirm with a long-name discussion.
- The TopicsTab skeleton represents a whole card whose real height is dynamic (expanded vs collapsed, number of points) — it can only match the collapsed/header case; that is acceptable and expected, document it.

---

### נקודה 8 — Center the "משימה" column HEADER in My Tasks (keep task names left-aligned)
**מורכבות:** S · **תלוי ב:** נקודה 7 (skeleton sizing) touches MyTasksView/row CSS but NOT the header alignment classes — no real conflict, independent., נקודה 9 (toolbar transparency) is in MyTasksView.module.css, separate file — independent.

**גישה:** Single-rule CSS change in MyTasksTable.module.css: change the high-specificity header guard `.taskHead .nameHead` (lines 53-56) from `justify-content: flex-start; text-align: left;` to `justify-content: center; text-align: center;` so the "משימה" header text centers within its frozen column. The base `.nameHead { justify-content: flex-start }` (lines 48-50) can stay as-is — the `.taskHead .nameHead` rule has higher specificity and wins for the header — but to keep it clean I'll also center the base `.nameHead` since it is only used by the header cell. The body name cell (`.name`/`.nameText` in MyTasksRow.module.css) is a completely separate class set and is NOT touched, so task names stay left-aligned (`text-align: start`). I verified the suspected copy-paste bug in MyTasksTable.jsx (priority header cell wrongly getting `taskFirst + nameHead`) does NOT exist in the current code — the header applies `taskFirst + nameHead` ONLY to the name cell (line 82); priority (lines 92-97), status, notes, discussion all use just `styles.taskCell`. So no JSX fix is needed; the doc's side-note (lines 283-284) is stale. Note the table is `dir="ltr"` (line 78) so `text-align: center` is unambiguous and RTL-safe for a centered header.

**קבצים חדשים:** `/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/__tests__/myTasksTable.header.test.jsx`

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/MyTasksTable.module.css</code> (48-56)</summary>

```
BEFORE:
.nameHead {
  justify-content: flex-start;
}
/* Higher-specificity guard so the name header aligns left (matching the
   left-aligned name values) instead of inheriting the centered header cell. */
.taskHead .nameHead {
  justify-content: flex-start;
  text-align: left;
}

AFTER:
.nameHead {
  justify-content: center;
}
/* Higher-specificity guard so the name header is CENTERED within its (frozen)
   column. The body name cells stay LEFT-aligned via the separate .name/.nameText
   classes in MyTasksRow.module.css — header and body use different classes, so
   centering the header here does not affect the task-name values. */
.taskHead .nameHead {
  justify-content: center;
  text-align: center;
}
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/__tests__/myTasksTable.header.test.jsx`:
  - renders the "משימה" column header text
  - name header cell carries the centered nameHead class (not flex-start)
  - priority header cell does NOT carry the frozen taskFirst/nameHead classes (regression guard against copy-paste bug)
  - body task-name cell keeps the left-aligned name/nameText classes

**ווריפקציה:**
- npm run dev (:5180), open the app in the monday board https://yomsheni-il.monday.com/custom_objects/18419665045 via npm run tunnel, switch the top-left appView toggle to 'המשימות שלי'.
- Desktop: confirm the 'משימה' column header text is horizontally CENTERED within its (leftmost frozen) column, while every task NAME below it remains flush-left. Confirm the other headers (סטאטוס/עדיפות/דדליין/notes/discussion) are unchanged (still centered).
- Horizontally scroll the table right: confirm the frozen name column stays pinned and its centered header stays centered (no drift), and names stay left.
- RTL correctness: the page is RTL but the table is dir="ltr"; verify the centered header reads correctly and is not pushed to an edge — it should sit in the visual middle of the name column.
- Mobile (or DevTools narrow viewport / monday mobile app): the name column uses var(--name-col, 50vw); scroll horizontally and confirm the centered header behaves and names remain left-aligned. Note mobile cache: if testing in the monday mobile app after deploy, bump a NEW version or force-quit to bust the stale bundle.
- Run npx vitest run src/components/MyTasksView/__tests__/myTasksTable.header.test.jsx and confirm green.

**סיכונים:**
- Very low risk — single isolated CSS rule on a header-only class. Body names use separate classes (.name/.nameText) and are not touched.
- classNameStrategy: 'non-scoped' makes class names global; .nameHead is unique to MyTasksTable so no cross-component collision. Confirmed via grep that .nameHead is not reused elsewhere.
- Cosmetic only: a centered header over left-aligned values is a deliberate, slightly unconventional look the user explicitly requested — not a bug.
- The doc's claimed copy-paste bug in MyTasksTable.jsx is NOT present in current code; do not 'fix' the priority header cell (it already uses plain taskCell).

---

### Point 9 — My Tasks sticky toolbar is transparent (rows show through above and below it)
**מורכבות:** S

**גישה:** The toolbar (`.toolbar`, MyTasksView.module.css:13-28) is `position:sticky; top:0` inside `.root` (:1-10) which is the scroll container (`overflow-y:auto`) and has `padding:16px` on all sides. Two independent defects produce the two symptoms. (a) "Above": the 16px top padding of `.root` is part of the scroll content ABOVE the sticky toolbar, so rows scroll up into that 16px strip and peek over the toolbar's top edge — the existing code comment only reasoned about HORIZONTAL coverage, not the vertical padding strip. Fix by giving the toolbar a negative-margin bleed upward: `margin-top:-16px; padding-top:16px` (using the same `--spacing-medium` token as `.root`) so its opaque background paints over that strip. (b) "Below": `background: var(--primary-background-color, #fff)` — inside monday's real theme this token can resolve to a transparent/unset value (the frozen table cell deliberately uses a literal `#ffffff` for exactly this reason, MyTasksTable.module.css:85), so the fallback never kicks in and the toolbar reads through. Fix by layering an opaque literal under the token: `background: #ffffff; background: var(--primary-background-color, #ffffff);` so a transparent token still composites over solid white. Before committing, a browser inspection step decides whether (a), (b), or both are live by reading the computed background of `.toolbar` and confirming the padding strip; the plan applies both fixes since they are cheap, independent, and each addresses a distinct reported symptom.

**שינויי קבצים:**
<details><summary><code>/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/MyTasksView.module.css</code> (13-28)</summary>

```
In `.toolbar`, make the background opaque-by-default and bleed the sticky bar up over the .root top-padding strip.

BEFORE:
.toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  flex-wrap: wrap;
  /* Pin to the top of the scrolling list AND sit above the group tables ... */
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--primary-background-color, #fff);
  padding-block: var(--spacing-small, 8px);
}

AFTER:
.toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  flex-wrap: wrap;
  /* Pin to the top of the scrolling list AND sit above the group tables (their
     frozen cells use z-index 2-3) so an expanded table can't clip the toolbar.
     The sticky bar must FULLY hide rows scrolling behind it: (1) it bleeds up
     by .root's 16px top padding (negative margin + matching padding) so rows
     can't peek in that strip above it; (2) the background is a literal #fff
     UNDER the theme token, because --primary-background-color can resolve
     transparent in monday's real theme (the frozen table cell uses literal
     #ffffff for the same reason). */
  position: sticky;
  top: 0;
  z-index: 20;
  background: #ffffff;
  background: var(--primary-background-color, #ffffff);
  margin-top: calc(-1 * var(--spacing-medium, 16px));
  padding-block: var(--spacing-medium, 16px) var(--spacing-small, 8px);
}
```
</details>

**טסטים:**
- `/Users/ilaish/monday_app/apps/discussions/src/components/MyTasksView/__tests__/myTasksView.smoke.test.jsx`:
  - sticky toolbar has an opaque (non-transparent) background — getComputedStyle(toolbar).background/backgroundColor is not 'transparent' nor 'rgba(0, 0, 0, 0)' (CSS-module class is non-scoped so the literal #ffffff fallback resolves in jsdom even though the token var is unset)
  - sticky toolbar bleeds over the root top padding — toolbar's marginTop is negative (calc resolves to -16px) and its top padding is restored so the strip above it is covered

**ווריפקציה:**
- Run app via tunnel into the board https://yomsheni-il.monday.com/custom_objects/18419665045 and switch to the 'המשימות שלי' (My Tasks) tab (top-left appView toggle).
- DIAGNOSE FIRST (before trusting the fix): open DevTools, inspect the `.toolbar` element, and in Computed read `background-color`. If it is `rgba(0,0,0,0)`/transparent, suspect (b) the token is unset is live. Also scroll the list and watch the 16px region directly above the toolbar — if task rows are visible peeking over the toolbar's TOP edge, suspect (a) the padding strip is live. Note which symptom(s) you reproduce.
- After the fix is deployed/served: scroll the group list up and down. Confirm NO task row text is ever visible through the toolbar — neither above its top edge (padding strip) nor below it as rows pass behind (transparent bg). The toolbar should be a solid opaque band.
- Confirm the toolbar's blue active pills, search input, and Collapse/Expand pill are still fully visible and not vertically clipped (the negative margin must not crop the pills) — the `padding-block` top of 16px compensates for the -16px margin so internal height is unchanged.
- RTL correctness: the app is RTL but the toolbar is `dir=ltr` (pills left-aligned). Verify the negative margin-top (a block-direction, non-logical property) behaves identically in RTL — it should, since margin-top is unaffected by direction. Confirm pills stay left-aligned and the opaque band spans the full width.
- Mobile (max-width:767px, e.g. monday mobile app or narrow window): the @media block turns pills icon-only and keeps them on one row. Confirm the sticky opaque toolbar still fully hides scrolling rows on mobile and the icon pills' active (blue) backgrounds are not clipped by the changed padding-block.
- Desktop + mobile: verify the first group header / first row sits flush directly under the toolbar with no double-gap introduced by the margin/padding change (the 16px top padding of .root is now visually owned by the toolbar's bleed).

**סיכונים:**
- Negative margin-top on the sticky element shifts its sticky resolution: with `top:0` the toolbar still pins at the scroll-container top, but verify it doesn't leave a visible gap or overlap with the first group header on initial (unscrolled) render.
- If `--primary-background-color` actually resolves to a dark value in a future monday dark theme, the literal `#ffffff` under it is only a fallback (token wins when defined), so the fix is theme-safe — but if the token is defined-but-transparent (unlikely), the token would still win and stay transparent; the diagnose step must confirm the token is UNSET (not set-to-transparent) for the layered-literal approach to fully solve symptom (b). If it is set-to-transparent, drop the token line and keep only `background:#ffffff` (matching the table cell's approach).
- The two-line `background` declaration relies on the browser ignoring the unknown/invalid token and falling back to the prior literal; all evergreen browsers monday targets support this, but jsdom in the test may only retain the last declaration — assert against backgroundColor accordingly (the literal is the first line, so test by ensuring it is not transparent rather than asserting an exact value).
- padding-block shorthand change (`16px 8px`) alters top padding from 8px to 16px; confirm this doesn't visually overgrow the toolbar height beyond monday's ~48px band.

---

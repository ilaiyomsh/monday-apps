Here's my QA report on the Tracker app. I found **a lot** of issues — I'd hold off on pushing to production. Below they're grouped by severity.

## 🚨 Critical / Blocker

1. **Stuck / unresponsive edit modal.** Right after page load I opened an existing event ("test - פרויקט פנימי לדוגמא" on Sunday 10). I switched to "External projects" tab (which showed "No projects found"), then tried to click Routine, Cancel, the X close button and even pressed Escape — **the modal swallowed every interaction**. I had to reload the iframe to recover. This is reproducible.

2. **Save race condition.** Triple-clicking Save when creating a new Routine entry produced:
   - One created event ✔
   - **Two stacked "You can't log hours for future time" toasts** (handler fired multiple times)
   - **Two confetti animations / "first report of the day" celebrations** at once
   - Future server-side dedupe is masking this — if the network is slow, you'll get duplicate rows. The Save button must be disabled / debounced on click.

3. **API request storm.** While the page sat idle / I clicked around normally, I counted **118 backend requests** to monday.com endpoints (`board_data`, `board_init`, `board_data_extended`, `count-active`, `get_overview_section_by_type`, `recipes/static`, `automations`, …). The same set of 7 requests re-fires on practically every interaction (rapid date nav fired them ~8× back-to-back). This will hammer your servers in production and will get worse with more users.

4. **"Unsaved changes" warning when nothing changed.** Open any existing event → click Cancel immediately → you get the "You have unsaved changes. Do you want to leave?" dialog even though nothing was touched. The form is being marked dirty on mount.

## 🐞 High

5. **Wrong "future time" validation.** I saved a Routine Study event on Tuesday May 12 14:45–15:15. Today is Wednesday May 13 (so May 12 is the past) — yet the app showed *"You can't log hours for future time"*. The validator is misclassifying past times, and it shows the warning but **does not block the save**, which is the worst of both worlds.

6. **Filter "People" list contains an event name, not a person.** Under Filter → People, the only entry is "אירוע בדיקה" — that is the title of one of the calendar events, not a person. The filter is reading from the wrong column.

7. **Project filter doesn't highlight matches — it fades the matching event too.** Checking "פרויקט חיצוני לדוגמא" dims that same red event along with everything else. Either the filter logic is inverted or the styling for "matched" is the same as "non-matched".

8. **External projects modal shows "No projects found".** Even though there's clearly an active external project on the calendar (the red Monday event), the External projects tab in the Time Report modal shows "No projects found" both for new and existing entries. Project list isn't loading into the modal.

9. **Stacked modals.** Clicking inside the calendar area while the Time report modal was open opened a second "Report type for this day - 5/12/2026" modal on top of the first — the original modal stayed mounted behind. The user can interact with the calendar through a modal that's supposed to be blocking.

10. **Click-through of toasts to calendar.** The "You can't log hours for future time" toast's close (×) target either has a tiny hitbox or doesn't capture the click — clicking the × actually clicked through to the empty calendar cell behind it and opened a *new* "Report type for this day" modal.

## 🐛 Medium

11. **Misspelling visible to end users: "Vocation" instead of "Vacation"** in the Report type chooser (Sick / Vocation / Multiple reports). This is going to production.

12. **"Show planned" toggle has no effect.** Toggled it off — none of the existing entries disappeared or changed. Either the feature isn't wired up or there are simply no "planned" entries in this dataset (in which case the toggle shouldn't be visible/enabled).

13. **Event color instability.** The "Study" event I created appeared blue/teal initially, then turned purple/magenta after I opened the filter panel. Color seems to re-roll on re-render rather than be assigned per type.

14. **Settings panel renders behind the calendar.** Clicking the ⚙ next to "Work week" opens "Reporting settings", but the modal is *under* the calendar header — I only saw a sliver of the title until I scrolled. Suggests z-index or portal-mount issue depending on viewport height.

15. **Orphan clock icon overlay.** After applying a filter, a black clock glyph appeared centered on Tuesday around 12:00 with no clear meaning. Could be a leftover "empty state" indicator from the filter.

16. **Focus styling on close (×).** The X icon on the Time Report modal renders with a thick blue rectangle around it (looks like the default Chromium `focus-visible` outline on a non-styled SVG button). Just a polish issue.

17. **Confetti runs every time the dialog thinks it's the first report of the day.** Combined with the race condition above, you can produce a confetti storm.

## 🔒 Security note (good news, with caveat)

I tried typing `<script>alert('xss')</script>` into the Notes field and saved. After re-opening the event the notes were empty — so the input is at least being sanitized/dropped, **but silently**. Ideally show the user the cleaned value or reject the input visibly so they don't think their notes were saved when they weren't.

## Console / Network observations

- Console error logged: `"While trying to send BigBrain track event, caught error"` — telemetry failure, not user-facing but noisy.
- No 4xx/5xx network responses observed during my run; all the broken-feeling behavior is client-side state, not API failures.

## Two leftover artifacts I created during testing

- One Routine "Study" event on Tuesday May 12, 14:45–15:15.
- The progress bar moved from 19% → 20%.

I left them in place so you can inspect them in the dev DB; delete at your convenience.

**My recommendation:** items 1–4 are release-blockers — the stuck modal alone will produce user-reported "the app froze" tickets immediately. I'd fix those plus the "Vocation" typo (#11) and the False-positive future-time warning (#5) before shipping.

---

# Code verification (static analysis vs. QA report)

Verdicts: **REAL** = code confirms users will hit this. **FALSE** = QA misread; code does not support the behavior. **UNCLEAR** = can't tell from static analysis, needs runtime repro.

Tally: **REAL: 2, 6, 14, 16** (and partial 17). **FALSE: 1, 4, 7, 10, 11, 12, 13**. **UNCLEAR: 3, 5, 8, 9, 15, 18**.

### 1. Edit modal unresponsive after External tab — FALSE
`src/components/EventModal/EventModal.jsx:622-664` — the three mode buttons (External/Internal/Routine) are simple toggles. No state flag disables Routine/Cancel/X after switching. `closeBtn` (line 583) always calls `handleCloseAttempt`. Only lock-out in code is a 500ms re-open guard at line 359, which doesn't match the described symptom.

### 2. Save not debounced — REAL (minor)
`src/components/EventModal/EventModal.jsx:899-911` — Save is only disabled via `!formIsValid || isLoadingEventData`. No `isSubmitting` flag. `handleCreate` (line 369) calls `onCreate` then `onClose` synchronously. Triple-click on the same render frame can fire `onCreate` multiple times. Confetti is guarded (`useCelebration.js:99` clears the ref), but `showSuccess` toast in `MondayCalendar.jsx:918` fires per call. Add an in-flight guard.

### 3. ~118 API requests on idle — UNCLEAR
`useFilterOptions.js:48-56,218-221` has dedup via `lastFetchParams`. `useMondayEvents.js:595` uses `settingsRef` to stabilize deps. Other hooks (`useProjects`, `useTasks`, `useStageOptions`, `useNonBillableOptions`) and the `filterRules` object identity feeding `useMondayEvents` weren't fully audited. Recommend a network-tab profile.

### 4. "Unsaved changes" on Cancel with no edits — FALSE
`src/components/EventModal/EventModal.jsx:319-349` — `hasUnsavedChanges()` compares current state to `eventToEdit` (edit mode) or to empties (create mode). No "dirty on mount" flag. Possible race in the edit-hydration effect (lines 191-220) but the function reads state post-effect.

### 5. "Future time" warning shows for past times and doesn't block — UNCLEAR
`src/MondayCalendar.jsx:823-829` — `if (start > now) { showWarning(...); return; }`. It **does** block (early return), and the comparison is correct local-time. Real only if the user's machine clock was off.

### 6. People filter shows event titles instead of people — REAL (conditional)
`src/hooks/useFilterOptions.js:103-119` — when `filterEmployeesBoardId`/`filterEmployeesColumnId` are unset, it falls back to the reports board with `reporterColumnId`. The dropdown's display uses `item.name` of that board, which is the report's title (e.g. "אירוע בדיקה"). Triggers whenever the employees board isn't configured.

### 7. Project filter dims matching event — FALSE
`src/MondayCalendar.jsx:1208-1212` — filter rules go to the server via `rulesToGraphQL` and non-matching events are excluded from the response, not dimmed. No "filtered" class in `events.css`. The 0.7-opacity rule at `events.css:469` is in a media query (loading state).

### 8. External projects tab empty — UNCLEAR
`src/components/EventModal/EventModal.jsx:762-773` filters by `p.projectType === 'internal' ? 'internal' : 'external'`. Anything without `projectType` set is bucketed external, so it should not be empty unless every project resolves as internal. Likely a settings/data issue (`enableProjectTypeDistinction`, `projectTypeColumnId` mapping), not a UI bug.

### 9. Stacked modals — UNCLEAR
EventModal overlay handles `e.target === e.currentTarget` (line 561-564), so inner clicks won't bubble. Modal renders in-tree (not a portal). RBC `onSelectSlot` shouldn't fire through the overlay if z-index is correct. Needs runtime repro.

### 10. Toast close click-through — FALSE
`src/components/Toast/Toast.module.css:13-23` — container is `pointer-events: none`, toast is `pointer-events: auto`. The close `<button>` absorbs the click; it won't pass through to the cell behind.

### 11. "Vocation" typo — FALSE
Repo-wide grep finds zero occurrences of "Vocation". All strings use "Vacation" / "חופשה" correctly (`SettingsWizard/useBoardBuilder.js`, `AllDayEventModal.jsx:69`, i18n locale files).

### 12. "Show planned" toggle does nothing — FALSE
`src/MondayCalendar.jsx:361-362` declares the state; line 1305-1306 filters `regularEvents.filter(ev => !ev.isTemporary)` when off; line 1176 wires it to `FilterBar`. The toggle is wired — likely there were no temporary events in the dataset.

### 13. Event color re-rolls on re-render — FALSE
`src/utils/colorUtils.js:189-205` — `stringToColor(projectId)` is a deterministic string-hash → palette index. `getEventColor` keys off `eventType`/`projectId`. Stable across renders.

### 14. Settings panel renders behind toolbar — REAL
`src/components/SettingsDialog/SettingsDialog.module.css:5` uses `z-index: 1000`. Toolbar popovers in `src/styles/calendar/components/toolbar.css:139, 459, 482, 507` use 1000–1100. The settings overlay can be visually overlapped by toolbar popovers.

### 15. Orphan clock glyph on Tuesday ~12:00 after filtering — UNCLEAR
`src/styles/calendar/components/time-indicator.css:16-67` defines `.rbc-current-time-indicator::before/::after` pseudo-elements (the clock icon). Should render only on the current day. Can't confirm leak without runtime repro.

### 16. Default Chromium focus outline on X — REAL
`src/components/EventModal/EventModal.module.css:69-81` `.closeBtn` has no `:focus-visible` rule and no `outline` override. Same in `src/components/Toast/Toast.module.css:88-106`. Browser default focus ring will show.

### 17. Confetti without throttle — PARTIAL REAL
`src/hooks/useCelebration.js` fires on threshold crossings (e.g. `before.count === 0 && after.count > 0`). Clearing `beforeStateRef.current` after firing prevents repeat on the same create. There is **no daily persistence** — delete the first event and re-create and "first-of-day" fires again. The "every report" claim is overstated, but the throttle is incomplete.

### 18. `<script>` in Notes silently stripped — UNCLEAR
`src/hooks/useMondayEvents.js:522-524` sends notes **raw** to the Monday API with no client-side sanitization. Read path (line 436) uses `notesColumn?.text`. If stripping happened it was Monday-side. React's JSX auto-escapes on display regardless. Worth verifying Monday's text-column behavior, but it's not a client bug.

### Recommended fixes (in priority order)

1. **Bug 6** — set `filterEmployeesBoardId`/`filterEmployeesColumnId` (or guard the fallback) so the People filter never reads report titles.
2. **Bug 14** — raise SettingsDialog z-index above the toolbar (≥1200) or lower the toolbar popovers.
3. **Bug 2** — add an `isSubmitting` guard on Save in `EventModal.jsx` (and mirror in `AllDayEventModal.jsx`).
4. **Bug 16** — add `:focus-visible` styles to `.closeBtn` in both EventModal and Toast.
5. **Bug 17** — persist "celebrated today" to `monday.storage.instance` keyed by date.
6. **Bugs 1, 3, 5, 8, 9, 15, 18** — reproduce in the browser before changing code; static evidence doesn't support them.
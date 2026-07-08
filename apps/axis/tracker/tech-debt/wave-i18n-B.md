# Wave i18n.B — Select dropdowns family

**Branch:** `tech-debt/wave-i18n-B`
**Target:** ~5 component files + 1 shared utility. Rows tagged `W6.B` in `docs/i18n-locale-audit-findings.md`.
**Theme:** five dropdown components share the same pathology — hardcoded Hebrew strings + dropdown anchor pinned to physical `left`/`right`. Fix once via a shared utility.

## Scope (rows from audit-findings.md)

### Shared utility (create first)
- New helper `src/utils/dropdownAnchor.js` that computes dropdown inset based on `useLocale().dir` and a trigger `getBoundingClientRect()`. Single source of truth so the 5 components stop duplicating physical-property code. Returns `{ top, insetInlineStart }` (or whatever the layout actually needs — let the sub-agent decide based on inspecting current usages).

### Component fixes
Each component below:
- Migrate hardcoded Hebrew literals to `t()` via `useStableT`. Add keys under `common.*` (re-use across components where the string is identical, e.g. "טוען..." → `common.loading`).
- Replace inline `left:` / `right:` positioning with the new `dropdownAnchor` utility.
- Replace inline `marginLeft`/`marginRight` with `marginInline*` logical properties (or move to CSS module).

Files:
- `components/SettingsDialog/SearchableSelect.jsx` — `טוען...`, `חפש ברשימה...`, `לא נמצאו תוצאות`, `אין אפשרויות זמינות` + `left: rect.left` anchor.
- `components/SettingsDialog/MultiSelect.jsx` — same string set + `${count} נבחרו` pluralization + anchor + `marginLeft/Right`.
- `components/DatePickerInput/DatePickerInput.jsx` — `בחר תאריך`, `היום` + `right:` anchor (always right-pinned, wrong in LTR).
- `components/TimeSelect/TimeSelect.jsx` — `בחר שעה...`, `טוען...`, `אין זמנים זמינים` + `left:` anchor.
- `components/TaskSelect/TaskSelect.jsx` — 8 Hebrew literals + `left:` anchor.

## Out of scope

- All other rows in audit-findings.md — Wave A or C.
- DO NOT touch CSS modules unless absolutely required to wire the anchor utility.

## Acceptance criteria

Same 4 automated checks as Wave A:

1. `pnpm test:run` — full suite green.
2. `pnpm run build` — Vite production build.
3. ESLint warnings ≤ baseline.
4. i18n keySymmetry test passes.

Additional smoke: after edits, manually run `grep -rn 'left:\|right:' src/components/{SearchableSelect,MultiSelect,DatePickerInput,TimeSelect,TaskSelect}` and confirm no physical-side anchoring remains in inline styles (should all go through the utility).

## Implementation notes

- Reuse string keys aggressively. `common.loading` ("טוען..." / "Loading...") is referenced from all 5 components — define once.
- Pluralization for MultiSelect's `${count} נבחרו` uses i18next `count` interpolation. Keys: `common.multiselect.selectedCount_one` / `_other` (he uses single+plural forms; en uses one+other).
- The shared `dropdownAnchor` utility goes in `src/utils/` not `src/hooks/` — it's a pure function over a DOMRect + dir, no React state.
- If a component already uses `useLocale()`, just consume `dir` from it. If not, add the import.

## After sub-agent finishes

Same as Wave A: commit, push, PR, ~150-word summary.
PR title: `tech-debt(i18n): Wave B — select dropdowns family (shared anchor + i18n)`.

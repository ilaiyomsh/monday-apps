# MOBILE-PLAN.md — Dedicated mobile experience for Day-off

> Execution ledger for adding a **dedicated mobile experience** to the whole Day-off app (all 4 views + Settings + every modal), for the monday **mobile app webview** (~360–430px, RTL Hebrew primary).
> Produced from a multi-agent research+design pass (11 subsystem readers → 4 design proposals → synthesis). Each phase is **independently shippable**: commit on a branch → `pnpm run deploy` (gh-pages → live in monday automatically) → test live in the mobile app at `https://yomsheni-il.monday.com/custom_objects/18416948121`.

---

## Global decisions

| Decision | Choice |
|---|---|
| **Navigation** | **Bottom tab bar for managers** (reuses `TABS.manager` + `activeTab` + `pendingCount` verbatim); **no nav band for employees** (single `mine` tab — header `<h1>` carries context); **FAB** for "new request" on the `mine` tab. Top `.tabs` kept but `display:none` on mobile. |
| **Breakpoint** | **One phone breakpoint: `@media (max-width: 600px)`** (de-facto already used by app-core's settings sheet; sits below the 760/980/1000 desktop queries; superset that refines, never contradicts, the existing 560 rules). Plus `@media (hover:none),(pointer:coarse)` for hover-only affordances. No new ad-hoc breakpoints. |
| **Detection** | **CSS-first, JS-thin.** ~90% via pure `@media`. A `useIsMobile()` hook (`matchMedia('(max-width:600px)')`, synchronous initial state + `change` listener) **OR**'d with app-core's `useMondayContext().isMobile`, used **only** for DOM-structure swaps (bottom nav, FAB, modal variant). Root `.app` gets an `is-mobile` class so JS- and CSS-detected mobile unify on one selector. **matchMedia is authoritative** — the SDK `mode==='mobile'` flag is undocumented, absent from the typed context, and gated behind a 5000ms watchdog that resolves `false` on timeout, so it can only be an OR-ed enhancement. |
| **CSS organization** | **One appended, bannered `/* ===== MOBILE LAYER (<=600px) ===== */` section at the END of `app.css`** (loads last → wins the cascade at equal specificity without `!important`; physically separated from the in-flight desktop WIP; revertible per sub-block). Sub-headers per subsystem. New sizing tokens go in `tokens.css :root` (theme-safe). |
| **RTL** | he is primary. Every mobile rule uses logical properties (`inset-inline-*`, `margin-inline-*`) + `.rtl-flip`; popovers clamp `max-width:calc(100vw - 32px)`; test he first, en second. |

**Confirmed product decisions (2026-06-18):**
- **Scope:** all 9 phases, in sequence (Phase 0 → 6).
- **TeamView on mobile:** a **per-day view with a horizontal day carousel** (pick/swipe a day → see who's off that day) — not a long vertical agenda.
- **Dashboard time-chart on mobile:** rendered **vertically** — one row per month/bucket with horizontal bars (all 12 months, no horizontal scroll).

---

## Phases (each = one commit → deploy → test on device)

### Phase 0 — Foundation (invisible, safe)
**Goal:** all infra so later phases are pure additive CSS/markup; no visible change.
- `index.html`: viewport → add `viewport-fit=cover` (prereq for `env(safe-area-inset-*)`).
- `tokens.css :root`: add `--safe-top/--safe-bottom: env(safe-area-inset-*, 0px)`, `--mobile-nav-height:56px`, `--touch-target-sm:40px`, `--mobile-gutter`, `--z-bottom-nav:1400`; wire the existing dead `--touch-target:44px`.
- New `src/hooks/useIsMobile.ts` (`MOBILE_BREAKPOINT=600`).
- `DayOffView.tsx`: `isMobile=useIsMobile()`; root `className={isMobile?'app is-mobile':'app'}` (both configured + notConfigured returns).
- `app.css`: append empty bannered MOBILE LAYER skeleton with per-subsystem sub-headers.
- Reconcile/delete dead `src/types/index.ts` `MondayContextValue` (omits `mode`, unused — grep first).
- **Test:** identical behavior; root gains/drops `is-mobile` at 600px; `pnpm test` + `test:tz` + lint pass; deploys & loads.

### Phase 1 — Shell & navigation (the core "dedicated mobile" move)
**Goal:** bottom tab bar (managers), FAB, compact header, safe-area. App fully usable on phone after this.
- `DayOffView.tsx`: `{isMobile && isManager && <nav className="tab-bar">…}` (badge → corner dot on approvals); `{isMobile && activeTab==='mine' && <button className="fab" onClick={()=>setModal({kind:'request'})}>}`.
- `app.css` MOBILE LAYER: `.app{height:100dvh}`; compact `.app-header` (hide `.brand-sub`, smaller mark, `padding-top:safe-top`); `.settings-btn` 44×44; `.tabs{display:none}`; `.tab-bar` fixed bottom icon-over-label min-height 48px, `padding-bottom:safe-bottom`, `z-index:var(--z-bottom-nav)`; `.app-main` bottom padding clears the bar; `.fab` fixed bottom-inline-end; hide EmployeeView inline `.btn-primary` on mobile; lift `.toast-wrap` above the bar.
- i18n: add `views.mine.newRequestA11y` (he+en).
- **Test:** manager bottom bar in RTL order with active highlight + pending corner dot; employee no bar; FAB opens request modal & clears home indicator; compact header; content clears the bar; no h-overflow.
- ⚠ Z-index (toast 1800 > overlay 1500 > bar 1400); hiding EmployeeView's inline button is the one touch into the WIP region — scope strictly under mobile selector; **do not delete `.persona-*`** (still used on unconfigured screen).

### Phase 2 — Modals: bottom-sheet + full-screen variant
**Goal:** all 7 modals → mobile patterns via the single `Modal.tsx` chokepoint.
- `Modal.tsx`: optional `variant?: 'sheet'|'fullscreen'` (default sheet) → className modifier; body scroll-lock effect; busy/Escape/backdrop unchanged.
- `RequestModal`/`CompanyDayModal`/`RequestDetailModal`/`DrillModal` → `variant='fullscreen'`; Approve/Reject stay sheet.
- `app.css`: `.overlay{align-items:flex-end}`; `.modal` 100% width, `max-height:90dvh`, top-rounded, slide-from-bottom; `.modal--fullscreen{height:100dvh;border-radius:0}`; `.modal-foot` sticky with `padding-bottom:calc(gutter+safe-bottom)`, footer `.btn{flex:1;min-height:touch-target}`, 3-button CompanyDay footer wraps delete to its own row; `.modal-close` 44×44; RequestModal form (`.type-picker` 2-up, `.type-opt` 48px wrap, stacked summary, `.fc-remove` 40×40, `.file-drop` 44px); RequestDetail `.detail-row` column; `.notes-block` 1-col.
- `ErrorDetailsModal.tsx`: replace hardcoded inline insets with class styling (mobile: inset-inline 8px, bottom above toast/safe-area).
- **Test:** Approve/Reject rise as sheets; Request/CompanyDay/Detail full-screen with sticky action bar; native date pickers, no zoom-on-focus, keyboard doesn't hide Submit; scroll restored on close.
- ⚠ Soft keyboard over sticky footer (iOS) — on-device; use 100dvh not 100vh; 16px inputs scoped to ≤600 only.

### Phase 3 — Shared primitives (touch targets, 16px inputs, hover guard, dropdown clamps)
**Goal:** harden every shared control once so all views inherit it.
- `app.css` (@media 600): wire `--touch-target` into `.btn/.btn-icon/.settings-btn/.input/.textarea/.select/.tab/.yr-opt/.seg-btn`; inputs/selects font-size 16px (no iOS zoom).
- `@media (hover:none),(pointer:coarse)`: kill sticky `:hover` backgrounds (keep `.active/.selected` as the touch cue).
- Clamp dropdowns (`.yr-menu`, EmpFilter menu, settings select menu, color popover, `.ppicker-pop`) to `calc(100vw - 32px)`; Seg `max-width:100%;overflow-x:auto`.
- CalToolbar `.nav-btn/.today-btn` ≥44px.
- **Test:** all controls ≥44px; no zoom on focus; no stuck hover; dropdowns don't overflow in RTL; Seg scrolls; active states visible.

### Phase 4 — EmployeeView (primary employee screen) reflow
**Goal:** make "My absences" the best phone screen.
- `app.css` (@media 600): `order:` the 4 slots so list + stat cards sit above the heavy calendar; stat cards keep 3-up but labels wrap (no clip); request rows `flex-wrap:wrap`, ≥48px tap; reveal add-day on touch (corner-positioned); enlarge toolbar (today/nav/year) ≥44px.
- **Test:** list/cards above calendar; labels don't clip (he+en @360px); rows tappable; add-day works; verify focus/reading order after `order:` reflow.
- ⚠ RequestRow/`.list-row` shared with Approvals/Team — scope under `.emp-side` + @media 600. EmployeeView.tsx is in the WIP — additive CSS only.

### Phase 5a — ApprovalsView mobile cards (highest-priority view fix)
**Goal:** turn the 760px-min horizontal-scroll table into stacked tappable cards.
- `app.css` (@media 600): override the load-bearing `display:contents` on `.approvals-row` → bordered card; `.approvals-grid` 1-col; hide table chrome/head; actions → full-width 2-button row (`flex:1`, ≥44px); decided-row badge top.
- Optional (`ApprovalsView.tsx`, **class variant not markup fork**): collapse 7 per-cell targets to one card open-target + 2 action buttons; keep Enter/openKey.
- **Test:** no h-scroll; each pending request a card with full-width approve/reject; decided rows show badge; "approve all" reachable; desktop unchanged.
- ⚠ `display:contents` override MUST be fully inside @media 600 or desktop table breaks; approve/reject irreversible → reduce mis-taps.

### Phase 5b — Calendar, TeamView Gantt, Dashboard charts (the 3 hardest views)
**Goal:** each gets the strategy that fits its purpose.
- **Calendar (keep grid + touch fixes):** single-line bar labels; one-row toolbar; tappable holiday chips (replace lost hover title). **Do NOT change LANE_H/HEADER_H/MIN_CELL_H or `.cal-week-events` geometry** (dual source of truth — bars would detach).
- **TeamView (per-day view + day carousel — CONFIRMED):** `useIsMobile()` branch renders a single-day view with a horizontal **day carousel** at the top (scroll/swipe to pick a day within the month; today centered by default, RTL-aware via `scrollIntoView`). The selected day shows the list of who is off that day = Avatar + name + colored type text + pending marker, each tappable → `onOpenRequest` (reuse the **same `teamRuns`**, not a parallel computation); empty day → empty state. `display:none .team-grid` on mobile; gate the desktop `ResizeObserver`/auto-scroll when the grid isn't rendered. No horizontal Gantt scroll.
- **Dashboard (vertical time-chart — CONFIRMED):** on mobile, render the by-time chart **vertically** — one row per bucket (all 12 months, **no horizontal scroll**): label at inline-start + a horizontal bar growing inline-end, keeping the same data / segments / colors / drill-on-tap. Needs a mobile chart variant (desktop bars grow in height; mobile bars grow in width — verify the paired-bar/segment model maps cleanly). Stack `.dash-filters-main` full-width; `.kpi-value` 36→28px.
- i18n: `views.team.carouselEmpty` / day-label keys (+ reuse existing status/holiday/days) he+en.
- **Test:** calendar bars single-line + tappable + attached to cells; team has a day carousel (no h-scroll), selected day lists who's off, tappable, empty day shows empty state, today centered; dashboard time-chart is a vertical list of horizontal bars (all 12 months, no scroll, RTL-correct, drill-on-tap works); desktop unchanged.
- ⚠ TeamView mobile is a **separate render branch** (`useIsMobile()`) → the desktop grid is `display:none`'d (no CSS-var lift needed), but it's still a TSX change in a WIP file — keep it additive (new branch + new component), don't rewrite the desktop grid. The day view must re-derive from `teamRuns`, not a parallel computation. Dashboard: `.dash-head-filters` (app.css:1418) is DEAD — target `.dash-filters-main/.dash-filters-side`; the vertical chart is a new mobile-only render path, leave the desktop bar-pair markup intact.

### Phase 5c — Settings dialog (CSS-only overrides of the app-core shell)
**Goal:** full-screen, usable Settings; fix the in-repo 85vw override that defeats the shell's own mobile sheet.
- `app.css`: guard the 85vw override (app.css:467-469) behind `@media (min-width:601px)` (or `min(85vw,100%)`).
- MOBILE LAYER: `.axsd-tabs{overflow-x:auto}` (4 Hebrew tabs overflow 430px); reduce `.axsd-content` padding to 16px.
- Company-days table → stacked cards at ≤600 (CSS table→block, or alternate card list in `CompanyDaysTab.tsx`); fallback `overflow-x:auto`.
- Clamp `.ppicker-pop` + SearchableSelect menu; widen swatch/trash/select targets ≥44px.
- **Test:** Settings full-screen (not 85vw on company-days tab); all 4 tabs reachable; grids 1-col; dropdowns don't overflow; company-days a tappable card list; PeoplePicker full width; desktop unchanged.
- ⚠ Shell is external (`@axis/app-core`) — **only CSS overrides via `.axsd-*` classes** in-repo. SearchableSelect shared by ~16 dropdowns. CompanyDaysTab is in the WIP.

### Phase 6 — Polish, on-device hardening, docs
**Goal:** cross-device verification + final hardening + documentation.
- On-device pass (real iOS + Android in the monday app): safe-area, dvh stability, keyboard-over-footer, no sticky hover, RTL order (bar/footers/popovers), z-index stacking.
- 360px before/after screenshots per view.
- Full `pnpm test` + `test:tz` + lint; confirm zero desktop regression.
- Update `ARCHITECTURE.md` (mobile layer + 600px convention + `useIsMobile` model); log phases via change-tracker.

---

## Cross-cutting risks (apply to every phase)
1. **Detection must be matchMedia-primary** — SDK `mode` is undocumented + watchdog-gated; never the sole gate.
2. **Cascade / no `!important` war** — appended section wins by source order at equal specificity; match specificity for `.emp-side .list-row` etc.; mobile-guard the existing 85vw `!important`.
3. **Large uncommitted desktop WIP** in app.css + TeamView/DashboardView/EmployeeView/RequestDetailModal/CompanyDaysTab — every mobile rule **additive + @media-scoped**; never rewrite the desktop grid/markup.
4. **dvh + safe-area can't be reproduced in devtools** — real-device test each phase; `viewport-fit=cover` (Phase 0) is a hard prereq.
5. **Soft keyboard over sticky footers** (iOS RequestModal) — on-device verify; fallback scroll-into-view.
6. **MonthCalendar dual source of truth** (CSS + JS lane constants) — avoid touching lane geometry.
7. **`display:contents` (Approvals) + inlined Team grid template** are load-bearing — overrides fully inside @media 600 / via CSS-var lift.
8. **RTL primary** — logical properties everywhere; test he first; TeamView today-scroll stays `scrollIntoView`.
9. **ESLint bans Hebrew literals** — all new copy as t() keys in he+en.
10. **Z-index stack**: bottom nav 1400 < overlay 1500 < toast 1800 < Vibe tooltip 2200 < settings menu 2300.
11. **No CI + auto-live deploy** — bad deploy is immediately live; mitigated by additive @media scoping (revertible per sub-block) + pre-deploy test/lint gate.

---

## Open product questions (to confirm before/while building)
- ✅ **Scope:** all 9 phases in sequence. — _decided._
- ✅ **TeamView:** per-day view + day carousel. — _decided._
- ✅ **Dashboard time-chart:** vertical (row per month, horizontal bars, no scroll). — _decided._
- **Desktop WIP / commits:** the working tree has large uncommitted desktop-UI WIP intermixed in the same files mobile touches (app.css, DayOffView, EmployeeView, TeamView, DashboardView, RequestDetailModal, CompanyDaysTab). Resolve before per-phase commits: commit the WIP first as its own commit, then mobile on top? (blocks clean per-phase history)
- **Calendar role @360px:** month-shape glance (keep grid — recommended; list already in EmployeeView) vs. primary agenda surface (larger).
- **Modal-open nav:** hide bottom bar + FAB while a modal is open (recommended) vs. keep visible under overlay.
- **FAB for managers** on `mine` (current) vs. suppress. Board-owner-not-manager → employee (no-bar) treatment (recommended).
- **CompanyDay 3-button footer:** wrap Delete to its own row vs. move Delete to a header trash icon.
- **Settings 85vw override:** OK to mobile-guard now (Phase 5c depends on it)?
- **Test target devices/OS:** which iOS + Android monday-app versions are the on-device gate?

---

## Progress log
- ✅ **WIP committed** (`9c8edc7`) — desktop UI polish snapshotted as its own commit so mobile phases land clean.
- ✅ **Phase 0 — Foundation** (`1f75669`) — tokens, `viewport-fit=cover`, `useIsMobile`, `is-mobile` root class, MOBILE LAYER skeleton. Gates green; **deployed live**.
- ✅ **Phase 1 — Shell & navigation** — bottom tab bar (managers), `new request` FAB (mine tab), compact header, safe-area, top-tabs hidden on mobile, toast lifted. Decision: dedicated mobile layer is gated on `.is-mobile` (toggled by `useIsMobile` at 600px), not raw `@media`, so CSS always matches the JS-rendered structure. **Verified on device** (nav + FAB + compact header confirmed via screenshots, light+dark, RTL).
- ✅ **Phase 5a — ApprovalsView cards** (user-reprioritized) — mobile reflow of the 760px-min approvals grid into stacked rows (status accent + name + meta + full-width touch action row); no horizontal scroll. CSS-only under `.is-mobile`. Gates green; **deployed live**.
- ✅ **Phase 5b (filter slice) — Dashboard filter** (user-reprioritized) — the wrapping filter bar becomes ONE horizontally-scrollable row on mobile. CSS-only. Gates green; **deployed live**. _Remaining 5b: calendar touch fixes, TeamView day-carousel, vertical time-chart._
- ✅ **Phase 2 — Modals** — all modals become bottom sheets on mobile (full-width, rounded top, slide-up, full-width 44px footer buttons, RequestDetail rows stacked). CSS-only via the shared Modal. **Deployed.**
- ✅ **Phase 3 — Touch primitives** — 40/44px touch targets, 16px inputs (no iOS zoom), viewport-clamped dropdowns/popovers, scrollable Seg, touch hover-guard. CSS-only. **Deployed.**
- ✅ **Phase 4 — EmployeeView** — FAB removed + inline "new request" restored; stat-card labels wrap; request rows comfortable tap height. **Deployed.**
- ✅ **Phase 5b — Calendar / TeamView / Dashboard** — calendar colour-only bars + legend; TeamView day carousel + per-day "who's off" list (replaces the Gantt grid); dashboard by-time chart as a vertical normalised bar list. **Deployed.**
- ✅ **Phase 5c — Settings** — full-width on mobile (85vw widener neutralised; tab strip scrolls). CSS-only, width-gated (shell may portal). **Deployed.**
- ✅ **Phase 6 — Docs** — ARCHITECTURE.md §8 (mobile layer, 600px convention, useIsMobile model) + this ledger.

**All phases implemented and deployed live.** Remaining = the user's on-device verification pass (iOS + Android, light/dark, RTL) per phase; report any device-specific issues (safe-area, dvh, keyboard-over-sheet-footer) for follow-up.

_Branch: `mobile-experience` (local; deploys publish `dist/` → gh-pages → live in monday). Source: workflow `mobile-research-plan` (run `wf_ac72f58e-fc9`)._

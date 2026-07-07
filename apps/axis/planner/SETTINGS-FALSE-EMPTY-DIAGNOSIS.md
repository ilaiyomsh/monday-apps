# Settings load — "false-empty" wrongly onboards a configured instance (OPEN)

**Status:** Diagnosed · fix proposed · **NOT implemented**. A temporary diagnostic probe is **LIVE in production** (must be removed when the fix lands — see below).
**Date:** 2026-06-22 · **Investigated by:** Claude Code session.
**Pick this up next session.** This file is self-contained — you should not need the original chat.

---

## Symptom

A user opening a **configured** Planner instance occasionally gets, across consecutive page loads:

1. **Load 1** — "no data" + a **"Refresh page"** error screen (the `network` variant: *"Something went wrong … refreshing should fix it"*).
2. **Load 2** — the **welcome / settings dialog** opens, as if the instance were brand-new and unconfigured.
3. **Load 3** — the app loads correctly.

The user's (correct) expectation: there should be only **two** outcomes — either settings load (app comes up) or the read fails (ask to refresh). The settings dialog opening on a *configured* instance is the bug.

## Root cause (app side)

`src/hooks/useMondaySettings.ts` → `loadSettings` has **three** terminal outcomes, not two:

| `monday.storage.instance.getItem` returns | Code path | Treated as |
|---|---|---|
| throw / timeout / `success:false` | retried 4× w/ backoff, then silent-reload or error screen | transient → handled ✅ |
| `success:true` **with** `value` | parse → settings | configured ✅ |
| `success:true` **with empty** `value` | **DEFAULT_SETTINGS → `isConfigured=false`**, no retry | "new/unconfigured instance" ❌ |

The third branch (`useMondaySettings.ts:226`, log `"Empty value (success) — new/unconfigured instance"`) is **trusted unconditionally**. `attemptGetItem` returns `{ ok: true }` for *any* response with a `data` field where `success !== false` — **it never checks whether `value` is present** (`useMondaySettings.ts:127`). So an empty-but-successful read breaks the retry loop on the first attempt and is taken as ground truth.

`isConfigured` is then `false` (`useMondaySettings.ts:90` — derived purely from `allocationsBoardId && employeesBoardId`), which makes `App.tsx` render the welcome screen and auto-open the settings dialog (`App.tsx:93-98`).

**The asymmetry is the bug:** hard-failure shapes are retried and treated with suspicion; `success:true + empty value` is not, even though monday returns it transiently for instances that *are* configured.

## Why monday returns a "false-empty"

Cold-start flakiness of the iframe's instance-storage channel (postMessage / session-token propagation). On a cold load the channel can return a fast-but-wrong response. We **captured this live** (see Evidence): one load's first attempt returned `success:false` and the retry recovered. The same flakiness can surface as `success:true` with no `value` — and that variant is **not** retried.

Precedent: `BUGS.md` → 2026-05-12 — monday returned `success` with **0 items** instead of a 500 on the allocations path. Same class: success-with-empty-payload masquerading as a valid empty result.

## Evidence

**Commits that fought earlier variants of this exact bug:**
- `f527267` — *"retry settings load on transient SDK failures instead of falling back to onboarding"* — covered `success:false` (cold-load `{success:false, error:{}}`).
- `ef5b80f` — *"differentiate network errors from empty-instance state"* — added `errorKind: 'network' | 'unknown'`; covered throw/timeout/`success:false`. **Did not cover `success:true + empty value`.**

**Test that documents the current behavior as intentional** (so this is a design gap, not a code slip): `src/hooks/__tests__/useMondaySettings.cases.test.ts` → *"Case 2: storage success but value is null — new/unconfigured instance"* asserts `isConfigured=false`. It assumes `success+null` only happens for an absent key — which the loader cannot verify.

**Live captures from production (build `index-D2BVhmQ_.js`, via the probe):**

```
Configured instance, value present:   success=true   value present   version="0bd55"
Cold-load failure (retried, healed):  success=false  value absent    version=undefined
Genuinely new/unconfigured instance:  success=true   value absent    version=undefined
```

## The detection problem — and the conclusion

> "If an empty value came back even though settings ARE saved, how do we detect it?"

**From the empty response alone — you can't.** A genuinely-new instance and a false-empty are byte-identical (`success=true, value=null`). Retrying does **not** discriminate: a new instance returns empty on every retry too.

**`version` is NOT a viable discriminator.** The three captures above show `version` is present **only** when `value` is present (it travels with the record). A new instance and a failed read both give `version=undefined`. A false-empty has no value → it will almost certainly also be `version=undefined` → indistinguishable from a new instance. (The probe is still live to catch a real false-empty for 100% confirmation, but this does not change the decision.)

Detection therefore **requires an out-of-band signal** that does not share storage's failure mode.

## Proposed fix — `localStorage` "configured" breadcrumb

Independent of `version`; correct regardless of what a false-empty returns.

1. **Per-instance key** — `planner_configured_<instanceId>` (instanceId from monday context — `MondayContext.instanceId`). **Must be per-instance:** `localStorage` is shared across all placements on one browser origin, so a global flag would block onboarding of a genuinely-new instance opened in the same browser. `useMondaySettings` currently has no context; pass `instanceId` in (e.g. `useMondaySettings(instanceId)` from `SettingsProvider`, which sits inside `MondayContextProvider`).
2. **Arm it** on every successful load **with value** (`useMondaySettings.ts:205` branch) and on `saveSettings` success — so any configured instance that loads/saves once is armed.
3. **Use it** in the empty-success branch (`useMondaySettings.ts:226`):
   - breadcrumb **present** → false-empty → **do not** set DEFAULT_SETTINGS. Set `error` + `errorKind='network'` so `App.tsx` shows the **Refresh page** screen (mirror the existing network path).
   - breadcrumb **absent** → genuinely new → onboard as today.
4. **Safe degradation** — wrap all `localStorage` access in try/catch (like the existing `safeGet/SetSession` in this file). If blocked in the iframe → breadcrumb reads absent → behaves exactly like today (no regression).
5. *(Optional)* before declaring false-empty, retry the read 1–2× — cheap, may auto-recover; the refresh screen + user reload also recovers (observed).

**Known residual:** first-ever load of a configured instance on a *new* browser that hits a false-empty on that very first load → no breadcrumb yet → onboards. Narrowest possible window; closes after one successful load.

**Edge to handle:** if a user legitimately clears settings (un-configures), a stale breadcrumb would trap them on the refresh screen. Mitigation: reuse a one-reload guard (like `SILENT_RELOAD_FLAG`, `useMondaySettings.ts:11`) — if empty persists across a guarded reload, fall back to onboarding; or clear the breadcrumb on an explicit reset.

## Data-loss corollary (fix this too)

If a configured instance reaches the welcome screen via a false-empty and the admin clicks **Save**, `saveSettings` writes with **no** `previous_version` (it was nulled in the empty branch — `useMondaySettings.ts:247`, used at `:270`) → it **silently overwrites the real saved settings**. The breadcrumb fix prevents reaching the welcome screen in a false-empty, so it also prevents this. Consider additionally keeping `version` on writes as a guard so a stale write is rejected by optimistic concurrency.

## Current state of the code (what's deployed now)

Already shipped (build `index-D2BVhmQ_.js`, app id `10787117`, force-pushed live 2026-06-22):

- **TEMPORARY** `[VERSION_PROBE]` diagnostic — `useMondaySettings.ts:191-203`. Logs `hasValue` / `version` / `versionPresent`; empty-value reads log at **ERROR** (prod default level is ERROR) so a real false-empty is captured in the wild. **REMOVE this block when the fix lands.**
- **Keep** (good cleanups, not part of the probe): the compact per-attempt summary that replaced the full-response dump (`useMondaySettings.ts` in `attemptGetItem`), and the `[LOAD_FLOW]` logs moved from render bodies into effects so they fire once (`App.tsx:102-116` and the context-trace effect in `AppContent`; previously they triplicated on re-render).

Log control for testing: `window.AppLogger.setLevel('DEBUG'|'ERROR')`, `.disable()`, `.getConfig()` (run in the **app iframe** console context, not the top frame; persists per-browser in `localStorage`).

## Next steps / acceptance criteria

- [ ] Implement the breadcrumb fix (steps above).
- [ ] Remove the `[VERSION_PROBE]` block.
- [ ] Tests: configured + simulated empty read (breadcrumb present) → refresh screen, **not** welcome dialog; new instance (no breadcrumb) → welcome as today; `localStorage` blocked → no regression.
- [ ] Verify save can never overwrite real settings from a false-empty state.
- [ ] Write a `BUGS.md` postmortem; delete this file (or mark RESOLVED) and remove the `CLAUDE.md` pointer.

## Key code references

- `src/hooks/useMondaySettings.ts` — `loadSettings`, `attemptGetItem` (`:127` ok-without-value), `isConfigured` (`:90`), empty-success branch (`:226`), `setVersion(null)` (`:247`), `previous_version` (`:270`), probe (`:191`).
- `src/App.tsx` — auto-open effect (`:93`), `[LOAD_FLOW]` trace effect (`:102`), welcome screen / settings dialog render.
- `src/hooks/__tests__/useMondaySettings.cases.test.ts` — Case 2 (empty success) documents current behavior.
- Memory: `settings-false-empty-onboarding-bug` (Claude auto-memory for this project).

# Findings Summary

טבלה אחת מסודרת לפי סדר ביצוע מתוך `tech-debt/ROADMAP.md`.

| סדר | סעיף ב-ROADMAP | מספר | שם | תיאור קצר | סטטוס | קומיט רלוונטי |
|---|---|---|---|---|---|---|
| 1 | 1.1, 1.2 | F015 | README is Monday boilerplate | Not opened, trusting audit. | נסגר | — |
| 2 | 1.1 | F034 | Stale API mapping docs | Not opened. | נסגר | — |
| 3 | 1.3 | F029 | 20 components don't import `useTranslation` | Trusting audit. | נסגר | — |
| 4 | 1.4 | F033 | CI doesn't run lint or audit | Split into A1/A2/A3 + B (171 baseline problems). A1 + A2 merged; A3 + B pending. | בתהליך | 81e0390 (A1), 5ff1c64 (A2) |
| 5 | 2.1 | F026 | No tests on the 6 largest files | Not exhaustively, but matches my read of the test directory layout. | פתוח | — |
| 6 | 3.1 | F013 | Two API wrappers, inconsistent retry | Both wrappers exist as described. **53 external `safeApi` callers + 27 `wrapMondayApiCall` callers** (audit s… | פתוח | — |
| 7 | 3.1 | F014 | Documented 429 issue, unfixed for `safeApi` callers | `docs/api-concurrency-issue.md` exists (not opened in my verification). | פתוח | — |
| 8 | 4.1 | F005 | `MondayCalendar.jsx` (1,910 LOC) is a god component | `wc -l` reports 1,910. CLAUDE.md cites 993; ARCHITECTURE.md cites 1,551. The 30–60% drift the audit highlight… | פתוח | — |
| 9 | 4.2 | F007 | `mondayApi.js` (1,420 LOC, 33+ exports) | 1,420 LOC. 53 external call sites use `safeApi`; 27 internal sites use `wrapMondayApiCall` (audit said 19 — u… | פתוח | — |
| 10 | 4.3 | F006 | `MappingTab.jsx` (1,535 LOC) | 1,535 LOC. Imports 4 fetch* helpers + many hooks. | פתוח | — |
| 11 | 4.4 | F008 | `AllDayEventModal.jsx` (1,212 LOC) | 1,212 LOC. | פתוח | — |
| 12 | 4.4 | F010 | `EventModal.jsx` (871 LOC, +60% since CLAUDE.md) | 871 LOC; CLAUDE.md cites 552. | פתוח | — |
| 13 | 4.5 | F009 | `useMondayEvents.js` (929 LOC) | 929 LOC. The audit's "6 `eslint-disable react-hooks/exhaustive-deps`" note is consistent with what I'd expect… | פתוח | — |
| 14 | 5.1 | F004 | 70 npm vulnerabilities | Not re-run; trusting audit's `pnpm audit` output. | פתוח | — |
| 15 | 5.2 | F011 | `AdditionalTab.jsx` (786 LOC, undocumented) | 786 LOC. Not in CLAUDE.md's "Key Files by Size" table. | פתוח | — |
| 16 | 5.3 | F012 | `useBoardBuilder.js` (762 LOC) | 762 LOC. `settings_str` confirmed at lines 211, 220 (comment), 224. | פתוח | — |
| 17 | 5.3 | F027 | `settings_str` in `useBoardBuilder.js` | 3 occurrences (lines 211, 220, 224). Comment at 220 says the typed `settings` field "isn't [available]" right… | פתוח | — |
| 18 | 5.4 | F023 | 13 unused exports in `mondayApi.js` | Trusting knip. | פתוח | — |
| 19 | 5.5 | F025 | No PropTypes, partial JSDoc (475 tags ≈ 20% coverage) | Not measured. | פתוח | — |
| 20 | 5.6 | F030 | Settings migration code accumulating | Not opened. | פתוח | — |
| 21 | 5.7 | F031 | Large CSS modules (1,465 + 1,148 LOC) | Not opened. | פתוח | — |
| 22 | 5.7 | F032 | 3× repeated "log critical and rethrow" pattern | Not opened. | פתוח | — |
| 23 | 5.7 | F035 | Dual storage (instance + global) | Not opened. | פתוח | — |
| 24 | — | F001 | `.env` committed | `git ls-files` includes `.env`. `.gitignore` lists `code.tar.gz` but not `.env`. First appears in `ed70f51 In… | נסגר | 9131c6d |
| 25 | — | F002 | `build.zip` (970KB) tracked | `git ls-files` includes `build.zip`. `.gitignore` doesn't list it. Currently shows as `M` (modified) in worki… | נסגר | 9131c6d |
| 26 | — | F003 | `@mondaycom/apps-sdk` declared but unused | Declared at `package.json:25`. `grep -rn "@mondaycom/apps-sdk" src/` returns zero hits. Confirmed: only `mond… | נסגר | 9131c6d |
| 27 | — | F019 | Silent `.catch(() => {})` at `MappingTab.jsx:191` | Exact code is `}).catch(() => {});` after a project-board-ID extraction. Confirmed user-facing impact: if ext… | נסגר | 9131c6d |
| 28 | — | F020 | `console.error('DEBUG_MIRROR_SETTINGS', ...)` at `mondayApi.js:1253` | Exact code present. The eslint-disable directly above confirms it was knowingly left in. The structured `logg… | נסגר | 9131c6d |
| 29 | — | F021 | `window.__monday = monday` in `App.jsx:25` | Exact code present, comment says "DEBUG: temporary expose for console diagnostics." | נסגר | 9131c6d |
| 30 | — | F022 | 12 unused files | Knip's confidence depends on its config. Before mass deletion, **check `knip.json` for any path/ignore patter… | נסגר | 9131c6d |
| 31 | — | F024 | 18 dead `default` exports paired with named exports | Pattern is consistent with project style (didn't audit each). | נסגר | 9131c6d |
| 32 | — | F028 | Hardcoded Hebrew strings in `MondayCalendar.jsx` | Lines 1248 (`${result.failed} דיווחים נכשלו באישור`) and 1274 (same string). Two more spots than audit cited… | נסגר | 9131c6d |

> הערה: עמודת קומיט נשענת על hash שמופיע בסקשן של ה־Finding; ואם חסר שם hash, נעשה ניסיון מיפוי מתוך `ROADMAP.md`. אם עדיין חסר יוצג `—`. הטבלה ממוינת לפי סעיפי ROADMAP (`1.1`, `1.2`, `2.1`, ...).

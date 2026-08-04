# Security scan report — `apps/discussions`

**Prepared for:** external security consultant review
**Prepared by:** automated tool-driven scan (Claude Code), local machine, unrestricted egress
**Date:** 2026-08-04

---

## 1. Scope and commit

| Item | Value |
|---|---|
| **Primary target** | `apps/discussions` (monday.com client-side board view) |
| **Commit scanned** | `b35e233c248bffe693b2b163895450d3000295b8` |
| **Branch** | `claude/code-scan-security-wx0cgv` (based on `develop`) |
| **Repository** | `ilaiyomsh/monday-apps` (**public**) |
| **Source size** | 585 files tracked by git under `apps/discussions`, of which 488 JS/JSX |
| **Scan date** | 2026-08-04 |

Gitleaks and OSV-Scanner are inherently repo-wide (git history is not per-directory;
the lockfile is a single workspace file). Where those tools return results outside
`apps/discussions`, the results are **attributed to their owning path** and reported
separately from the in-scope verdict. Per owner instruction (2026-08-04), the other
workspace apps are **not** the subject of this report; one out-of-scope item that
requires action regardless is recorded in Appendix A.

Raw tool output is committed under [`security/`](../security/) for reproducibility:

| File | Contents |
|---|---|
| `TOOL-VERSIONS.txt` | tool versions + commit, machine-generated |
| `codeql-discussions.sarif` | full CodeQL results (SARIF 2.1.0), 105-query security-extended suite |
| `codeql-run-log.txt` | CodeQL evaluation log — every query, with timings |
| `semgrep-discussions.sarif` / `.json` | full Semgrep results (SARIF 2.1.0 + JSON) |
| `semgrep-readable.txt` | human-readable Semgrep pass |
| `gitleaks.json` | full-history secret scan, redacted |
| `gitleaks-discussions-bundle.json` | secret scan of the **built** browser bundle |
| `osv.json` / `osv-readable.txt` | OSV-Scanner SCA results |
| `pnpm-audit.json` | independent SCA cross-check with per-workspace attribution |
| `discussions-dep-closure.json` | computed prod/dev dependency closure of `apps/discussions` |
| `codeql-discussions-postfix.sarif` | CodeQL re-run **after** remediation (§10.5) |
| `xss-corpus-results.txt` | adversarial XSS corpus run output (§9) |

**Scan commit vs remediation commit.** Everything in §4–§9 was measured at `b35e233`. The
findings were then **fixed on this same branch**, and both SAST tools were **re-run against
the fixed code** — recorded in §10, with the post-fix CodeQL SARIF committed alongside the
original. The §4–§9 baseline deliberately stays at `b35e233` so the two are not conflated.

---

## 2. Tools and versions

| Tool | Version | Class | Rulesets / mode |
|---|---|---|---|
| **CodeQL** | **2.26.1** | SAST — interprocedural taint analysis | `javascript-security-extended.qls` — **105 queries**, 103 rules. Packs: `codeql/javascript-queries` 2.4.2, `codeql/javascript-all` 2.8.2, `codeql/threat-models` 1.0.54 |
| **Semgrep OSS** | **1.170.0** | SAST — pattern/dataflow | `p/javascript`, `p/react`, `p/owasp-top-ten`, `p/xss`, `p/secrets` |
| **Gitleaks** | **8.30.1** | secret detection | `detect` — full git history (816 commits, 41.38 MB), `--redact` |
| **OSV-Scanner** | **2.4.0** (osv-scalibr 0.4.5) | SCA | `--lockfile=pnpm-lock.yaml` against the OSV database |
| **pnpm audit** | pnpm **10.28.0** | SCA cross-check | GitHub Advisory DB, per-importer attribution |
| **XSS payload corpus** | in-repo, 55 payloads | dynamic (adversarial) | live payloads through the real sanitiser — see §9 |

Toolchain: **Node 20.20.2**, **pnpm 10.28.0** (matches the CI pin).

**CodeQL is the headline result**, because it is the one tool here that performs true
interprocedural taint tracking with path enumeration — the class of analysis manual review
cannot guarantee, and the one a consultant asking "at what level?" is really asking about.
It is what GitHub Advanced Security runs, and it is free for public repositories.

Semgrep coverage detail: 598 rules were loaded from the five registry rulesets;
**112** were applicable to the languages present and actually executed across 585
files, at ~100% parse rate. Registry reachability (`semgrep.dev`) was verified before
starting — HTTP 200 — because a previous attempt in a cloud VM was blocked by egress
policy and produced no SAST coverage at all.

CodeQL coverage detail: the database was built from `apps/discussions` as source root and
extracted **486 `.js`/`.jsx` source files** plus `vite.config.js` and `eslint.config.js` —
i.e. the whole app including tests. `node_modules` is excluded by the extractor. The
database also contains CodeQL's own bundled ECMAScript externs (type stubs under
`/opt/homebrew/Caskroom/codeql`), which is normal extractor behaviour and produced no
results. **A first database build accidentally ingested the app's own `build/` output;
it was discarded and rebuilt clean.** No result in the final run originates outside
`apps/discussions/src` — verified programmatically against the SARIF.

---

## 3. Architecture and threat model

`apps/discussions` is a **client-side React 19 single-page app that runs inside an
iframe on monday.com**. Three structural facts determine which vulnerability classes
can exist:

1. **No server, no database, no app-owned authentication or authorisation.** There is
   no backend in this app to attack.
2. **All API traffic uses monday's "seamless" `monday.api()`.** The SDK forwards each
   call over `postMessage` to the parent monday window, which executes it under the
   already-logged-in user's session. **No API token, client secret, or credential is
   present in the browser bundle** — verified empirically in §5 and §7.
3. **AuthN/AuthZ are entirely the monday platform's responsibility.** The app cannot
   grant itself data it could not already read as that user.

### Classes that are out of scope, and why

| Class | Why it cannot apply here |
|---|---|
| SQL / NoSQL injection | no database, no query layer owned by this app |
| SSRF | no server to originate requests |
| Broken access control, IDOR | authorisation is enforced server-side by monday, not by this app; the app runs with exactly the calling user's permissions |
| Session fixation / hijacking | the app issues no session; monday owns the session |
| Insecure deserialisation (server) | no server-side deserialisation |
| Path traversal / file inclusion | no filesystem access from a browser sandbox |
| CSRF | no app-owned state-changing endpoint; monday's API requires its own auth |

### Classes that genuinely apply, and were the focus

- **XSS / DOM injection** — the app builds HTML for the summary export.
- **GraphQL document injection** — query text is assembled client-side.
- **Secrets in the bundle or in git history** — the repo is public.
- **Supply chain** — 27 direct production dependencies, 527 in the transitive closure.
- **Data leakage through telemetry** — an Axiom error sink ships records off-platform.

These five are exactly what the findings, false positives, and dependency sections below cover.

---

## 4. Findings

**Two findings, both low or below. No high or critical finding in scope.**
Ordered most severe first. **All three (including 2b) have since been fixed — see §10.**

CodeQL's 105-query security-extended suite, with full interprocedural taint analysis,
returned **4 results, all one rule (`js/incomplete-multi-character-sanitization`), all
false positives** (§5.4). Critically, it found **zero** taint-reachable XSS, zero
injection, zero open redirect, zero prototype pollution, zero SSRF, and zero cleartext
logging. It did **not** flag the F-1 GraphQL interpolation either — a gap discussed in §8.

---

### Finding 1 — GraphQL document injection surface (LOW) — ✅ FIXED

*Corresponds to the previously known **F-1**. Confirmed, and narrowed.*

**Location:** `apps/discussions/src/utils/mondayApi/fileUpload.js:47`

```js
const ADD_FILE_MUTATION = (itemId, columnId) =>
  `mutation ($file: File!) {
     add_file_to_column (item_id: ${Number(itemId)}, column_id: "${columnId}", file: $file) { id name url }
   }`;
```

`itemId` is coerced with `Number()` and is safe. **`columnId` is interpolated into the
GraphQL *document text* unescaped** — the only place in the app where a string value
reaches query text rather than a typed variable.

**Data flow, traced end to end:**

```
provisionBoards.js:158   app provisions the column  →  monday generates the column id
   or SettingsModal.jsx:622  user maps an existing board column (summaryFileID)
        ↓ persisted to monday storage via SettingsContext
board-config-store.js:19-33   setActiveConfig(cfg) → active.columns
        ↓
docxExport.js:1250       fileColumnId = getColumns('discussions')?.summaryFileID?.id
        ↓
docxExport.js:1265       uploadFileToColumnSeamless({ itemId, columnId: fileColumnId, file })
        ↓
fileUpload.js:60         api(ADD_FILE_MUTATION(itemId, columnId), { file }, …)
        ↓
fileUpload.js:47         ← interpolation sink
```

**Reachability:** **not reachable by an end user.** The value is a monday-generated
column identifier, obtained either from the app's own board provisioning
(`{ alias: 'summaryFileID', type: 'file' }`) or from a Settings-modal mapping of
columns that already exist on the board. It is never free-form text typed by a
participant. Exploiting it requires an actor who can already write arbitrary strings
into the app's persisted settings — i.e. someone who already holds privileged access
to the board configuration, and who (per §3) already acts with their own monday
permissions on the API call anyway.

**Severity justification — LOW, downgraded from the "GraphQL injection" default:** the
pattern is real and the sink is real, but the input is machine-generated
configuration, an end user cannot influence it, and a successful injection grants the
attacker nothing they do not already have (the call executes under their own session).
It is reported rather than dismissed because it is a genuine unescaped-interpolation
sink that would become dangerous if the configuration source ever became user-writable.

**Refinement of the prior manual review.** The earlier review listed **two** sites,
lines 47 and 97, as equivalent. That is not accurate:

- **line 47** — reachable in production (traced above).
- **line 97**, inside `uploadFileToColumn()` — **dead code in production.** Its only
  references are in `src/utils/__tests__/fileUpload.test.js`. No production module
  imports it (`docxExport.js:44` imports only `uploadFileToColumnSeamless` and
  `clearFileColumn`). It is also the only function in the app that takes a `token`
  parameter, and no production call site supplies one — which is consistent with the
  no-credential threat model in §3.

**Recommendation.** Promote `columnId` to a typed GraphQL variable (`$col: String!`),
exactly as `clearFileColumn` in the same file already does (`fileUpload.js:38-42`).

**✅ Fixed** (see §10.1). Both `item_id` and `column_id` are now typed variables, so the
mutation document is a constant with no interpolation at all; the legacy multipart path
gained a column-id format guard. Locked by 3 tests and 2 killed mutations.

---

### Finding 2 — Unredacted GraphQL query and variables retained in client-side error state (INFORMATIONAL)

*Corresponds to the previously known **F-2**. The pattern is confirmed; the stated
impact is **refuted**. Both corrections matter, in opposite directions.*

**Location:** `apps/discussions/src/utils/mondayApi/client.js:279`, `:321`, `:330`
(and a fourth site not previously recorded: `:247`)

All four attach the full GraphQL document **and its `variables`** to log records or
error objects with no redaction:

```js
247:  logger.api(callerName, query, options.variables || null);           // success path, DEBUG
279:  logger.apiError(callerName, softError, { query, variables: … });    // GraphQL soft error
321:  logger.apiError(callerName, error,     { query, variables: … });    // transport catch
330:  apiRequest: { query, variables: …, operationName: … }               // MondayApiError wrapper
```

Those `variables` do carry user-authored business content — discussion names, topic
names, column values.

**Correction 1 — the telemetry gate is OPEN, not dormant.** The prior review recorded
this as inert because "no token is configured". That is no longer true:

- `src/index.jsx:47-51` gates the sink on
  `import.meta.env.PROD === true && Boolean(AXIOM_DATASET) && Boolean(AXIOM_TOKEN) && Boolean(AXIOM_APP)`.
- Both `deploy-draft-discussions.yml:52-54` and `deploy-live-discussions.yml:63-65`
  inject all three, with `VITE_AXIOM_TOKEN: ${{ secrets.AXIOM_INGEST_TOKEN }}`.
- The GitHub secret **`AXIOM_INGEST_TOKEN` exists, created 2026-07-22**.
- Live deploys of `discussions` have run repeatedly since, most recently
  **2026-08-04T07:54Z** (run 30889678617).

So every draft and live build produced since 2026-07-22 ships with the Axiom sink
**active**. `docs/ERROR-AXIOM-STANDARD.md` §"Activation status" still states this
secret is outstanding — that document is stale (see Finding 2b below).

**Correction 2 — the variables nevertheless never leave the browser.** Having
established that the sink is live, the payload was traced. `@mapps/error-kit`'s
`mapRecordToEvent()` (`packages/error-kit/dist/browser/axiomSink.js:161-219`) is a
strict **allowlist** mapper. Its own contract states it maps
*"EXACTLY the allowlisted fields — never `record.data` or `record.context`
query/response"*, and the implementation matches: from `record.context` it reads only
`duration`, `totalMs`, `step`, and `componentStack`. The shipped event is limited to
`level, tag, message, kind, corr, err_name, err_code, stack1, stack, err_msg, ms,
total_ms, step, component_stack`. `err_msg`, `stack`, and `component_stack` are passed
through a `redact()` scrubber (email → `[email]`, token-shaped → `[redacted]`, digit
runs → `[num]`).

The transport adds only identity enrichment (`app, env, ver, sess`, and
`acc/usr/obj/board`) — `axiomTransport.js:184` assembles `{ ...context, ...ev, … }`
where `context` is that identity map, not the logger's `record.context`.

`logger.api` at `:247` is level `DEBUG`; `shouldShip()` drops everything below
WARN/ERROR unless a record is flagged `alwaysShip` (usage/health). So it does not ship
under the default policy.

**Net residual risk:** the unredacted query and variables exist only
(a) in the client-side ring buffer, (b) on the in-memory error object, and (c) in the
`ErrorDetailsModal` UI — all visible solely to the logged-in user, who already owns
that data. **No business content egresses to Axiom.** Hence **informational**, not
low/medium.

**Recommendation.** No urgent action. Two defensive notes: the allowlist in
`mapRecordToEvent()` is the *only* thing preventing egress, so it should be treated as
a security boundary and covered by a regression test asserting that `context.query`
and `context.variables` never appear in a mapped event. Second, the `remoteLevel`
incident override (read from `localStorage`) can lower the shipping threshold to
DEBUG; that increases record *volume* but, because of the same allowlist, still does
not ship variables.

**✅ Mitigated** (see §10.2). The allowlist is now pinned by 4 regression tests in
`packages/error-kit/test/axiomSink.test.ts`, proven by 2 killed mutations. Widening the
mapper now breaks the build.

---

### Finding 2b — Stale activation documentation (INFORMATIONAL, process)

`docs/ERROR-AXIOM-STANDARD.md` §"Activation status" (last verified 2026-07-28) lists
`AXIOM_INGEST_TOKEN` as still required, with the consequence "every client build bakes
an empty token; the gate stays inert". The secret was created **2026-07-22**, six days
*before* that verification date, and live builds have shipped an active sink since.

This is not a code vulnerability, but it is a security-relevant accuracy defect: it
caused the prior manual review to classify a live telemetry path as dormant, and it
would mislead the next reviewer the same way. **Recommendation:** update that section
to reflect actual secret state, and treat "is the sink live?" as a checked fact rather
than a documented assumption.

**✅ Fixed** (see §10.3). That section now records the secret as set on 2026-07-22 with the
gate open, carries the commands to re-verify from the source of truth, and warns against
trusting it without re-checking.

---

## 5. False positives and expected-flags that did not materialise

### 5.1 The `summaryHtml.js` sanitiser — expected to be flagged, and was **not**

The brief predicted every SAST tool would flag the `innerHTML` writes in
`apps/discussions/src/utils/summaryHtml.js` and instructed that they be dismissed as
sanitiser machinery. **Semgrep 1.170.0 with all five rulesets produced 0 findings**,
so there was nothing to dismiss.

That result was not taken at face value — a zero-finding SAST run is as likely to mean
"misconfigured scan" as "clean code". Two controls were run:

1. The file is tracked by git and inside the scanned set (`git ls-files` confirms;
   Semgrep reports "scan was limited to files tracked by git", 585 files).
2. **Positive control:** `semgrep -e '$X.innerHTML = $Y' -l js` over the same path
   returned **5 matches**, two of them at `summaryHtml.js:134` and `:152`. The scan
   pipeline demonstrably reaches and parses that file.

**Conclusion:** the absence of findings is a genuine property of the registry
rulesets, not a broken scan. Semgrep's OSS XSS rules for React key on
`dangerouslySetInnerHTML` and on taint from recognised sources; a raw `element.innerHTML =`
write in plain JS, with the taint source inside the same module, is not covered by
`p/xss`, `p/react`, `p/javascript`, or `p/owasp-top-ten`. This is a **known coverage
gap of the tool**, recorded in §8, not evidence that the code is safe.

For the record, the sanitiser was read directly. It is an allowlist design on the
editor → monday save boundary: a closed tag allowlist that drops whole subtrees for
`script/style/head/title/meta/link/iframe/object/embed`; every attribute stripped and
then restored from a small per-tag allowlist; `href` restricted to
`https?:|mailto:|tel:` with `rel="noopener noreferrer"` added; and `url(`,
`expression`, `javascript:` rejected inside style declarations. The `innerHTML` writes
at `:134` and `:152` operate on an already-scrubbed `DOMParser` document. **Assessed as
correct; not a finding.**

### 5.2 `innerHTML` writes in test files — not a vulnerability

The positive control's other 3 matches were in test files, which are deliberately in
scope (`--exclude` covered only `build`, `dist`, `node_modules`):

- `src/components/SettingsModal/__tests__/exportPreviewRtl.test.js:7`
- `src/components/SettingsModal/__tests__/previewPagination.test.js:57`, `:78`

All three assign **hardcoded literal HTML fixtures** to build DOM for assertions. No
user input, no production path. **Dismissed.**

*Incidental correction:* the prior review recorded `innerHTML` as "7 occurrences, all
inside one sanitiser module". Production `innerHTML` writes are indeed confined to
`summaryHtml.js`, but the claim is imprecise — test files write it too. No security
consequence; noted so the next reviewer's baseline is accurate.

### 5.3 Gitleaks — 9 history hits, 0 in `apps/discussions`, 5 false positives

None of the 9 hits are in `apps/discussions`. For completeness, the five that are
**false positives** (all outside scope):

| # | Location | Why dismissed |
|---|---|---|
| 1, 2 | `apps/deadline-confirm/tests/secret.test.js:66` | synthetic 43-char string in a unit test asserting `maskSecret()` returns `****` + last 4 chars. High entropy **by construction** — that is the test's purpose. Not a credential. |
| 3 | `apps/deadline-confirm/tests/admin-api.test.js:105` | fixture in a test asserting `401 invalid_session_token` for unauthenticated requests. Not a credential. |
| 8 | `apps/axis/tracker/CHANGELOG.md:20` | prose in a changelog entry ("keyed by type label ID, …"). Documentation text matched by a generic high-entropy rule. |
| 9 | `.../sync-calender/public/admin/assets/index-CuCvWlmE.js:3033` | minified build artifact; the match is minified identifier soup (`O.anchor.key,…`). The file no longer exists at HEAD — a superseded build hash, present only in history. |

The remaining 4 hits are **true positives** and are escalated in Appendix A.

### 5.4 CodeQL — 4 results, all `js/incomplete-multi-character-sanitization`, all false positives

This was CodeQL's **only** rule to fire across 105 security queries. Rule metadata:
CWE-020/080/116, security-severity **7.8**, description *"A sanitizer that removes a
sequence of characters may reintroduce the dangerous sequence."*

The concern is legitimate in general: a single-pass `String.replace` that strips tag-like
sequences can reassemble a dangerous one (`<scr<x>ipt>` → `<script>`). All four hits are
that pattern. All four are false positives for the same structural reason: **the stripped
string is never used as HTML.**

| # | Location | Traced verdict |
|---|---|---|
| 1 | `src/utils/summaryHtml.js:183` | Inside `isSummaryHtmlEmpty()`. The chain `html.replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ')…trim()` feeds exactly one expression: `return text.length === 0`. The stripped text is a local, measured for length, then discarded — it is an **emptiness heuristic, not a sanitiser**. Its three callers (`docxExport.js:883`, `:892`, `:901`) use only the returned boolean, to decide whether to insert a placeholder paragraph ("אין סיכום."). No HTML sink exists on this path. |
| 2 | `src/utils/__tests__/participantsExportLines.test.js:21` | Test helper extracting text from generated Word XML (`<w:t>` elements) for assertions. |
| 3 | `src/utils/__tests__/peopleFormatShared.test.js:39` | Same helper shape: `decode(t.replace(/<[^>]+>/g,''))` over `word/document.xml`, to read paragraph text. |
| 4 | `src/utils/__tests__/peopleMetaExport.test.js:33` | Same helper shape. |

**Dismissed** — no HTML sink on any of the four paths, and (2)–(4) are test-only. Worth
noting what CodeQL got *right*: it did **not** flag the real sanitiser
(`sanitizeSummaryHtml`), whose DOMParser + allowlist design it correctly did not treat as
a naive string-replace sanitiser. That is a meaningful signal from a taint-aware tool.

### 5.5 OSV — 4 packages in the `discussions` production closure that do **not** ship

Resolved in §6. Summarised here because each would otherwise read as a finding:
`brace-expansion@1.1.15`, `fast-uri@3.1.3`, `postcss@8.4.31`/`8.5.16`, and
`esbuild@0.28.1` all appear in the *declared* production closure of `apps/discussions`,
yet none reach the browser. **Dismissed** on traced-path plus empirical-bundle grounds.

---

## 6. Dependencies (SCA)

### Headline numbers, and the attribution caveat

OSV-Scanner reports, for the **workspace lockfile as a whole**:

> Total **17 packages** affected by **38 known vulnerabilities**
> (1 Critical, 20 High, 15 Medium, 2 Low) from 1 ecosystem — across 1,777 packages.

**These are not `apps/discussions` vulnerabilities.** OSV-Scanner reads
`pnpm-lock.yaml` as a flat package list and cannot attribute a package to a workspace
project. The monorepo contains ten apps, including two server-side apps with a very
different risk profile. Presenting 38 as this app's exposure would be wrong.

### Independent attribution cross-check

`pnpm audit` performs per-importer attribution. It reports **34 advisories**
(1 critical, 18 high, 17 moderate, 2 low) and attributes their dependency paths as:

| Advisory paths | Rooted in |
|---|---|
| 16 | `apps/axis/day-off` |
| 6 | `apps/deadline-confirm` |
| 5 | `apps/team-people-column` |
| 5 | repo root (ESLint devDependencies) |
| 2 | `apps/axis/sync-calender` |
| 2 | `apps/axis/planner` |
| 1 | `apps/twyst-your-status/server` |
| 1 | `apps/axis/tracker` |
| **0** | **`apps/discussions`** |

**Reconciliation of 38 vs 34:** the two tools count differently — OSV emits one row per
(package-version, advisory) pair, including multiple advisories against the same
package version and multiple co-installed versions of the same package;
`pnpm audit` deduplicates per advisory. Both agree on the material point, from
independent databases: **no advisory is attributable to `apps/discussions`.**

### Shipped to the browser vs build/dev tooling only

A conservative check was run rather than relying on `pnpm audit`'s attribution alone:
the full production and dev dependency closures of `apps/discussions` were computed
directly from `pnpm-lock.yaml` (527 prod / 436 dev packages; see
`security/discussions-dep-closure.json`). That stricter walk surfaced four
OSV-flagged packages inside the **declared production** closure. Each was then traced
to its parent chain:

| Package | Version | Path into the prod closure | Verdict |
|---|---|---|---|
| `brace-expansion` | 1.1.15 | `@vibe/core` → `@vibe/style` → **stylelint** → file-entry-cache → flat-cache → rimraf → glob → minimatch | CSS-linter tooling, Node-only |
| `fast-uri` | 3.1.3 | `@vibe/core` → `@vibe/style` → **stylelint** → table → ajv | stylelint config validation, Node-only |
| `postcss` | 8.4.31, 8.5.16 | `@vibe/core` → `@vibe/style` (and → **stylelint**) | build-time CSS processor, Node-only |
| `esbuild` | **0.28.1** | `@vibe/core` → `@vibe/shared` → **vitest** → vite → esbuild | test-runner toolchain — **and 0.28.1 is not in the affected range** (GHSA-67mh-4wv8-2f99 is fixed in 0.25.0) |

**Root cause of the false alarm:** `@vibe/core` — monday's design system, a genuine
runtime dependency of this app — declares `@vibe/style` and `@vibe/shared` as
*runtime* dependencies, and those in turn declare `stylelint` and `vitest` as runtime
rather than dev dependencies. That upstream packaging mistake drags an entire Node dev
toolchain into the nominal "production" closure. It inflates SCA noise; it does not put
any of that code in a browser.

**Empirical confirmation.** The app was built (`vite build`, 9 JS chunks, ~3.2 MB
un-gzipped) and the emitted bundles were searched directly:

| Signature | Occurrences in shipped JS |
|---|---|
| `postcss` | 0 |
| `brace-expansion` / `braceExpand` | 0 |
| `fast-uri` | 0 |
| `ajv` | 0 |
| `esbuild` | 0 |
| `vitest` | 0 |
| `stylelint` | 1 file — **comments only** (57 × `stylelint-disable`, 48 × `stylelint-enable`, 5 × `stylelint-disable-line`) inside `@vibe`'s CSS strings; the library itself is absent |

### Verdict

**Shipped to the browser from `apps/discussions`: 0 known vulnerabilities.**
Every OSV/GHSA advisory in this workspace resolves to build tooling, test tooling, dev
dependencies, or another app entirely. This confirms the prior manual finding, now with
tool evidence from two independent advisory databases plus a bundle-level check.

---

## 7. Known accepted exposures

These are deliberate, understood trade-offs, disclosed rather than buried.

### 7.1 `VITE_AXIOM_TOKEN` is baked into a publicly readable bundle

Client builds inject `VITE_AXIOM_TOKEN` from the GitHub secret
`AXIOM_INGEST_TOKEN` (`deploy-{draft,live}-discussions.yml`). Vite inlines
`import.meta.env` values at build time, so the token is **present in plaintext in the
shipped JavaScript**, readable by anyone who loads the app.

This is inherent to client-side telemetry and cannot be fixed by obfuscation.
Compensating controls: the token is **ingest-only** (write-only — it cannot read or
query) and **scoped to the single `app-errors` dataset**. Worst case is dataset
pollution by a third party, not data disclosure. Accepted posture.

*Note:* the local build performed for this scan contained no token (no secret present
locally), which is why the bundle secret scan in §7.3 came back clean. A CI-produced
bundle **will** contain the ingest token by design.

### 7.2 The repository is public

`ilaiyomsh/monday-apps` is public. Consequences accepted: all source is readable;
any secret ever committed must be treated as compromised from the moment of the push
(this is what makes Appendix A urgent); and sourcemap hygiene matters — the CDN
workflows use `sourcemap: 'hidden'`, archive maps as a 90-day artifact, and hard-delete
them from the publish directory with a check that fails the run if any `.map` survives.

### 7.3 No secrets in the shipped bundle

Gitleaks was run against the freshly built output (`--no-git`, 16.29 MB scanned):
**no leaks found**. Combined with the no-token architecture in §3, this supports the
claim that the app ships no credentials of its own.

---

## 8. Limitations — what this scan does **not** establish

Stated plainly, because the value of the report depends on it.

1. **Semgrep OSS is pattern and dataflow matching, not exhaustive interprocedural
   taint analysis.** It does not enumerate all paths between all sources and sinks.
   §5.1 is a concrete, measured instance: Semgrep's OSS rules did **not** flag a raw
   `element.innerHTML =` write that a human reviewer does consider security-relevant.
   **A 0-finding Semgrep run is not proof of absence of XSS.**
2. **Even CodeQL is not a proof of absence — and this scan measured that too.** CodeQL
   did not flag F-1, the one real finding in this report. The reason is instructive: its
   taint analysis needs a recognised *source*, and F-1's input arrives from the app's own
   persisted settings, which no default threat model treats as attacker-controlled. So the
   two SAST tools missed the finding that manual review found, and manual review got F-2's
   impact backwards where tracing the code corrected it. **No single method here was
   sufficient; the agreement between them is what carries weight.**
3. **No true DAST — and very little surface for it.** DAST attacks a running HTTP
   endpoint. This app owns none: no server, no API, no database (§3). Scanning the Vite
   dev server would characterise *Vite's* headers, not this app's, and production is served
   from monday's CDN. What was done instead is the honest substitute: live adversarial
   payload testing against the one real attack surface, the sanitiser (§9). **What that
   does not cover:** the app was never driven end-to-end inside a real monday iframe, so
   no runtime interaction with the monday platform, the `postMessage` bridge, or CSP-in-situ
   was exercised.
4. **No penetration test.** No human adversarial engagement, and specifically **no probing
   of the monday.com platform**, which is where this app's real authN/authZ boundary lives
   (§3). Testing it would mean attacking a third party's production system, which requires
   monday's own written authorisation — not the app owner's. A pentest of the authorisation
   boundary is therefore a procurement decision with a signed scope, and is the main
   assurance gap that remains. The sanitiser *was* fuzzed (§9); nothing else was attacked.
5. **Gitleaks is regex + entropy based.** It reliably finds high-entropy and
   well-known-format secrets. A low-entropy secret (a short password, a human-memorable
   passphrase) can pass undetected. "0 secrets in `apps/discussions` history" means
   "none that Gitleaks 8.30.1's rules detect".
6. **SCA sees only declared, lockfile-resolved dependencies.** Vendored code,
   code copied inline, CDN-loaded scripts, and monday's own platform SDK as served at
   runtime are outside OSV's view. It also reports *known* advisories — a
   vulnerability not yet in OSV or GHSA is invisible.
7. **Reachability was determined by dependency-path tracing plus a bundle string
   search, not by a formal proof of tree-shaking.** The evidence in §6 is strong and
   mutually corroborating, but "signature absent from the bundle" is not the same as a
   verified module graph.
8. **Semgrep's registry rulesets are a moving target.** 598 rules were loaded on
   2026-08-04 and 112 executed; the same command on a later date may load different
   rules and produce different results. The pinned commit and tool versions in §1–2 are
   what make this run reproducible.
9. **Environment deviation.** The npm registry (`registry.npmjs.org`) was
   intermittently unreachable from the scanning machine (TLS connection reset after
   Client Hello, SNI-level). The first `pnpm install` aborted with 1,706 of 1,709
   packages resolved; a later retry completed successfully, and the build and all scans
   above ran against a complete install. `semgrep.dev` was reachable throughout (HTTP
   200), so SAST coverage was never degraded.
10. **Node version.** The machine had no Node 20; Node 20.20.2 was installed via nvm to
    match the CI pin before any scan or build was run.

### Recommended next steps, in priority order

1. **Rotate the credentials in Appendix A** — the only item requiring urgent action, and
   the only one still outstanding. Owner-only; agents cannot do it.
2. **Add CodeQL as a standing CI gate** (`.github/workflows/codeql.yml`). It has now been
   run once, locally, at a known commit — that is a point-in-time result, not a gate. Free
   for public repos.
3. **Add `eslint-plugin-no-unsanitized`** (Mozilla) and **`eslint-plugin-security`** to
   `apps/discussions/eslint.config.js` — cheap, and directly covers the raw-`innerHTML`
   class Semgrep's OSS rules miss.
4. Consider deleting the unreachable `uploadFileToColumn()` and its `token` parameter, or
   marking it explicitly test-only. It is now injection-guarded, but dead code with a
   credential parameter is a liability. Deliberately **not** removed here — deletion is a
   product decision, not a security fix.
5. If the consultant wants assurance on the authorisation boundary, scope a **penetration
   test with monday.com's authorisation** (limitation 4).

Items 4–6 of the original list — the F-1 fix, the F-2 allowlist regression test, and the
stale activation docs — are **done**; see §10.

---

## 9. Dynamic testing — adversarial XSS corpus against the sanitiser

Classic DAST was not applicable (limitation 3). The substitute performed here is real
dynamic testing of the one component that genuinely processes untrusted input.

**What was done.** A corpus of **55 XSS payloads** — OWASP XSS Filter Evasion Cheat Sheet
and PortSwigger classes, plus mutation-XSS and parser-confusion shapes — is executed
through **both** public entry points on the editor → monday save boundary
(`sanitizeSummaryHtml` and `toMondayHtml`) in a real DOM, and the output is checked against
**17 executable-residue detectors** (script/iframe/object/embed/link/meta/style/base/form
tags, `on*` handlers, `javascript:`/`vbscript:`/`data:text/html` URLs, CSS `expression()`
and `url()`, `srcdoc`, `formaction`).

Payload classes covered: direct and obfuscated script tags (`<scr<script>ipt>`,
`<script/xss>`), event handlers on allowlisted tags including case and whitespace evasion
(`OnClIcK`, `on\tclick`), image/media `onerror`, entity-encoded and tab-split protocol
evasion (`java&#09;script:`, `&#106;avascript:`, leading-space `" javascript:"`), style-based
`url()`/`expression()`/`behavior:`, frames and `srcdoc`, document-level `meta refresh` and
`base`, form/interactive autofocus payloads, mutation-XSS via
`noscript`/`template`/`math`/`xmp`, comment and CDATA smuggling, and attribute smuggling
alongside a legitimate `href`.

**Result: 0 survivors.** Every payload was neutralised by both entry points.

**The result is only meaningful because the harness can fail.** Two things establish that:

1. A **positive control** asserts the detectors fire on raw unsanitised HTML — without it,
   a broken detector set would make all 55 cases pass vacuously.
2. **Two deliberate mutations of the sanitiser were both killed** by this corpus:
   disabling the strip-all-attributes pass in `scrubAttributes` (caught by 5 payloads), and
   adding `javascript:` to the anchor `href` allowlist (caught by 5 payloads). The sanitiser
   source was restored byte-identical afterwards, verified by an empty `git diff`.

This corpus is committed as a **permanent CI gate**, not a one-off script:
`apps/discussions/src/utils/__tests__/summaryHtml.xssCorpus.test.js`. It runs in the normal
suite, so a future weakening of the sanitiser fails the build. Reproduce with:

```bash
cd apps/discussions && npx vitest run src/utils/__tests__/summaryHtml.xssCorpus.test.js
```

**Scope limit, stated plainly:** this tests the sanitiser as a unit, in jsdom. It is not a
browser test, not a test of monday's rendering of the saved HTML, and not a test of the
`.docx` export path. It establishes that the save-boundary sanitiser resists a recognised
payload corpus — nothing broader.

---

## 10. Remediation — what was changed after the scan

All three findings were fixed on branch `claude/code-scan-security-wx0cgv` after the scan
baseline was recorded. **No application behaviour changed** beyond the security fix itself,
and no lint rule, test, or repo hook was weakened or disabled to obtain a clean run.

### 10.1 Finding 1 (F-1) — GraphQL interpolation removed

`apps/discussions/src/utils/mondayApi/fileUpload.js`

- `ADD_FILE_MUTATION` is now a **constant document** with typed variables:
  `mutation ($item: ID!, $col: String!, $file: File!)`, and
  `add_file_to_column (item_id: $item, column_id: $col, file: $file)`. Both interpolation
  sinks are gone — not just the unescaped `columnId`, but the `Number(itemId)` one too.
- Validated against the **live monday schema** via the repo's sanctioned API wrapper before
  the change: `add_file_to_column(column_id: String!, file: File!, item_id: ID!)`. The
  variable types match the schema exactly.
- The legacy multipart path (`uploadFileToColumn`, test-only) cannot use a GraphQL variable
  because it inlines the mutation into a form field, so it gained `assertColumnId()` — a
  format guard (`/^[A-Za-z0-9_]+$/`) that rejects anything that is not a monday column id
  before any request is made.

**Verification:** 3 new tests, driven red→green (the red run is recorded, listing the exact
failing assertions). One test asserts the typed-variable form; one fires a GraphQL break-out
payload (`files", file: $file) { id } evil: create_item (…`) and asserts the document is
unchanged while the payload travels as a *value*; one asserts the multipart guard rejects a
malformed id without calling `fetch`. Then **2 mutations, both killed**: reintroducing the
literal interpolation, and disabling the format guard.

### 10.2 Finding 2 (F-2) — the telemetry egress boundary is now pinned

`packages/error-kit/test/axiomSink.test.ts`

4 regression tests lock `mapRecordToEvent()`'s allowlist: `context.query` /
`context.variables` / `context.rawResponse` are dropped while an allowlisted sibling on the
same object (`duration`) still maps (proving the context was read, not ignored); no business
substring appears anywhere in the serialised event; `record.data` is ignored wholesale; and
the emitted key set is diffed against the known 14-key allowlist so **any new key fails the
test and forces a review**.

**Verification: 2 mutations, both killed** — leaking `context.variables` (caught by 4 tests)
and leaking `context.query` (caught by 3). Source restored, empty diff, suite green.

*Note:* this file is in `packages/error-kit`, whose workflow path triggers redeploy the five
apps that import it. This is a test-only change — no runtime code was touched — so those are
rebuilds of unchanged source.

### 10.3 Finding 2b — activation documentation corrected

`docs/ERROR-AXIOM-STANDARD.md` §"Activation status" now records `AXIOM_INGEST_TOKEN` as
**set on 2026-07-22** with the client gate **open**, carries the two commands to re-verify
from the source of truth (`gh secret list`, `gh run list`), and explicitly warns against
trusting the section without re-checking — since that drift is what caused a live telemetry
path to be reviewed as dormant. It also names the allowlist as the security boundary and
points at the tests from §10.2.

### 10.4 Knowledge capture

`.claude/skills/error-guard/references/telemetry-egress-boundary.md` records the egress
contract, the level-policy subtlety (`emit()` dispatches to sinks at *every* level; the
filtering lives in the sink, so a sink written without its own level check receives
everything), and the "verify the secret, don't trust the doc" rule.

### 10.5 Post-fix verification

Both SAST tools were **re-run against the fixed code** to confirm the remediation introduced
nothing new (raw output: `security/codeql-discussions-postfix.sarif`):

| Post-fix scan | Result |
|---|---|
| CodeQL 2.26.1, security-extended (105 queries) | **4 results — byte-identical to the pre-fix set**: the same 4 known false positives (§5.4), no new finding, nothing at the changed lines. 291 files scanned (+1: the new corpus test). |
| Semgrep 1.170.0, same 5 rulesets | **0 findings**, 112 rules over 586 files (+1: the new corpus test). |

| Check | Result |
|---|---|
| `apps/discussions` full suite | **230 files, 1864 tests, all pass** |
| `packages/error-kit` suite | **189 tests, all pass** |
| `packages/error-kit` type-check | clean |
| ESLint on every changed file | clean, no rule suppressed |
| `apps/discussions` production build | succeeds |
| test-guard verdict, `fileUpload.test.js` | **DONE (TDD path)** — red recorded, green gate passed, 2/2 mutations killed |
| test-guard verdict, `summaryHtml.xssCorpus.test.js` | **DONE (retrofit path)** — 2/2 mutations killed |

Nothing in the remediation changed the tool findings: F-1's sink no longer exists, and the
other two were process/assurance items.

---

## 11. OWASP Top 10 (2021) coverage matrix

Added at the owner's request. Two tools contribute rule coverage here: Semgrep's
`p/owasp-top-ten` ruleset (0 findings) and CodeQL's `javascript-security-extended` suite,
whose 105 queries are CWE-tagged and map across the Top 10 (4 findings, all false
positives — §5.4). Automated rule coverage alone is not an answer, so each category is also
assessed against this app's actual architecture.

| # | Category | Applicability | Result |
|---|---|---|---|
| **A01** | Broken Access Control | **Out of scope by architecture.** The app enforces no authorisation; monday executes every API call under the logged-in user's own session and permissions (§3). The app cannot obtain data the user could not already read. | No finding. Not assessable in this app — belongs to a monday platform review. |
| **A02** | Cryptographic Failures | **Limited.** The app performs no cryptography and stores no secrets. All transport is HTTPS (monday API, Axiom ingest). `localStorage`/`sessionStorage` hold UI preferences and a view cache only — no sensitive data. | No finding. Related disclosure: the ingest token is public by design (§7.1). |
| **A03** | Injection | **Applies — primary focus.** **XSS:** 0 `eval` / `new Function` / `document.write` / `dangerouslySetInnerHTML`; all production `innerHTML` writes confined to the allowlist sanitiser (§5.1); CodeQL's taint analysis found **0** reachable XSS (`js/xss`, `js/xss-through-dom`, `js/unsafe-jquery-plugin`, `js/exception-xss` all clean); and the sanitiser survived **55 live payloads × 2 entry points with 0 survivors** (§9). **GraphQL injection:** one unescaped interpolation sink found by manual trace — missed by both SAST tools (§8.2). | **Finding 1 (Low), now fixed (§10.1).** SQL/NoSQL/command/LDAP injection have no surface (no server, no shell, no database). |
| **A04** | Insecure Design | **Partially applies.** The seamless-API design is a deliberate security *strength*: no token in the client, no app-owned auth to get wrong. Weak point identified: the telemetry allowlist is a single undefended boundary (§Finding 2). | No finding. One hardening recommendation (regression-test the allowlist). |
| **A05** | Security Misconfiguration | **Applies to the pipeline, not the app.** Sourcemaps are `hidden`, archived, and hard-deleted from the publish directory with a failing check. Deploys run only on GitHub Actions runners. Gap found: documentation drift on activation state. | **Finding 2b (Informational).** Also §7.1 (token in bundle, accepted). |
| **A06** | Vulnerable and Outdated Components | **Applies — assessed in depth (§6).** 38 OSV advisories workspace-wide; 0 attributable to `apps/discussions` by `pnpm audit`; 0 present in the shipped bundle by direct inspection. | No finding for this app. Advisories in other workspace apps are out of scope per owner instruction. |
| **A07** | Identification and Authentication Failures | **Out of scope by architecture.** The app issues no session, stores no credential, and implements no login, password, or MFA logic. monday owns identity end to end (§3). | No finding. Not assessable in this app. |
| **A08** | Software and Data Integrity Failures | **Partially applies.** Dependencies are pinned by a committed `pnpm-lock.yaml`, installed with `--frozen-lockfile` in CI. No auto-update, no unsigned plugin loading, no deserialisation of untrusted data. Note: `@vibe`'s mis-declared runtime dependencies (§6) are a supply-chain *hygiene* issue, not an integrity failure. | No finding. |
| **A09** | Security Logging and Monitoring Failures | **Applies — and is a relative strength.** Errors funnel through one logger to an Axiom `app-errors` dataset with correlation ids, version + build SHA, and log-once dedup. The inverse risk — logging *too much* — was the subject of Finding 2 and is contained by the allowlist. | No finding. Note the confirmed drift between documented and actual activation state (Finding 2b). |
| **A10** | Server-Side Request Forgery (SSRF) | **Out of scope by architecture.** No server exists to originate requests. Client-side: 0 open-redirect sinks (`window.open`, `location =`); `location.href` is read-only, used for error context. | No finding. |

**Summary:** of the ten categories, **four (A01, A07, A10, and the server half of A03)
have no attack surface in this architecture**; five were assessed and produced no
finding; and **A03 produced the single low-severity finding** in this report, with
A05 and A09 producing informational process notes. All three are now fixed (§10).

**What a defensible one-line summary looks like:** *"CodeQL (security-extended, 105
queries), Semgrep (incl. OWASP Top 10 rules), Gitleaks over full history, and OSV-Scanner
were run on commit `b35e233`; one low-severity finding and two informational items, all
remediated and locked by tests; no DAST or penetration test was performed."* Anything
stronger than that — in particular "the app is secure" — is not supported by this work.

---

## Appendix A — out-of-scope true positive requiring action

Recorded here because it was discovered by the mandated repo-wide history scan and
concerns live credentials in a public repository. It is **not** in `apps/discussions`
and is outside this report's scope per the owner's instruction, but it should not wait
on a scoping decision.

**Gitleaks true positives 4–7 — real OAuth credentials committed to a public repo.**

Two files, **both still tracked at HEAD**, and the containing directory is **not**
gitignored:

- `apps/axis/sync-calender/.dev/poc-storage.json`
- `apps/axis/sync-calender/archive/poc/custom-object-direct-local/snapshot/poc-storage-final.json`

Introduced in commits `d94cd96016` and `63584bcd06` (both 2026-07-07). Each contains a
proof-of-concept storage dump with these fields (values inspected only to classify
them; **not reproduced here, and not printed to any log or chat**):

| Field | Shape | Assessment |
|---|---|---|
| `googleRefreshToken` | 103 chars, `1//…` prefix | **Google OAuth refresh token. Highest concern — refresh tokens do not expire with time; they remain valid until explicitly revoked.** |
| `googleAccessToken` | 253 chars, `ya29.…` prefix | Google access token — short-lived, long expired. |
| `mondayAccessToken` | 227-char JWT | monday API token (uid 71077014, account 27549619). Decoded `exp` claim: **expired**. |
| `googleSyncToken` | 44 chars | Google Calendar incremental sync token — low value alone. |
| `googleUserEmail` | `ilai@twyst.co.il` | Confirms these are a **real account's** credentials, not fixtures. No placeholder markers in any value. |

**Recommended action, in order:**

1. **Revoke the Google refresh token now** — Google Account → Security → Third-party
   access, remove the app's authorisation. This is the step that actually ends the
   exposure; deleting the file does not, because the value remains in the git pack and
   the repository is public.
2. Rotate the monday token as hygiene (already expired, but it was public).
3. Remove both files from the working tree and add `.dev/` to `.gitignore`.
4. Decide separately whether to purge them from history (`git filter-repo` / BFG).
   Note this rewrites history and is disruptive on a shared repo — and it is **not** a
   substitute for step 1, since the values must be assumed already harvested.

Owner action required; agents do not hold or rotate these credentials.

---

*Scan performed 2026-08-04 against commit `b35e233c248bffe693b2b163895450d3000295b8`.
Findings remediated the same day on branch `claude/code-scan-security-wx0cgv` (§10).
Raw tool output: [`security/`](../security/).*

*One item remains open and is owner-only: the credential rotation in Appendix A.*

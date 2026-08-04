# Security scan brief — `apps/discussions`

**For:** a code agent (Claude Code / Codex) running on a **local machine with
unrestricted network access**, on a fresh clone of this repo.

**Why this document exists:** a security consultant asked the owner *"which code
scan did you perform, and at what level?"* Today the answer is "a manual,
security-oriented review" — accurate, but not backed by a named tool. Your job is
to produce a **defensible report from recognised industry tools**, so the answer
becomes: *"Semgrep, Gitleaks and OSV-Scanner, on this commit, here are the
findings."*

A previous agent attempted this in an ephemeral cloud VM and was blocked: the
egress policy denied `semgrep.dev` (403 on CONNECT), so the Semgrep rule registry
was unreachable. **That is the entire reason this runs locally.** Verify you have
open network access before starting.

---

## 1. Scope

**Primary target: `apps/discussions`.** That is what the consultant asked about.

Facts about it, so you calibrate severity correctly:

- Client-side React 19 app, ~76,000 lines across 486 `.js`/`.jsx` files under
  `apps/discussions/src`.
- It runs **inside an iframe on monday.com**. It has **no server, no database,
  and no authentication or authorisation logic of its own.**
- All API traffic goes through monday's **seamless** `monday.api()`: the SDK
  forwards the call to the parent monday window, which executes it under the
  logged-in user's session. **There is no token, client secret or credential in
  the client bundle.** AuthN/AuthZ belong entirely to the monday platform.

This shapes triage. Whole vulnerability classes (SQLi, SSRF, broken access
control, session fixation, insecure deserialisation on a server) **have no
surface here**. Do not pad the report with them. Equally, do not let the small
surface make you sloppy about the classes that *do* apply: XSS, GraphQL
injection, secrets in the bundle, supply chain, and data leakage through
telemetry.

Repo-wide scanning is **out of scope for the report** but worth running once (see
§6) — the other apps in the monorepo include two server-side apps with a very
different risk profile.

---

## 2. Ground rules (from `CLAUDE.md`, binding)

- Work on a `claude/*` or `feature/*` branch based on **`develop`**. Never push
  to `main`. Never push to `develop` directly.
- Toolchain: **Node 20, pnpm 10**. `pnpm install` at the repo root. Never
  npm/yarn.
- **Do not touch `MONDAY_TOKEN`** or any deploy path. This task is read-only
  analysis plus documentation; the only code change sanctioned here is the F-1
  fix in §5, and only if the owner asks for it.
- Confirm the commit you scanned. Record `git rev-parse HEAD` — the report is
  worthless without it, because "we scanned the code" is meaningless without
  *which* code.

---

## 3. What is already known — verify, don't repeat

A manual review was already performed at commit `2b0bb43`. Treat these as
**hypotheses to confirm or refute**, not as gospel. If a tool contradicts one,
the tool's finding wins until you have traced it yourself.

### Confirmed clean (manual sweep across 100% of source files)

| Check | Result |
|---|---|
| `eval` / `new Function` / `document.write` | 0 occurrences |
| `dangerouslySetInnerHTML` | 0 occurrences in the entire app |
| `innerHTML` | 7 occurrences, all inside one sanitiser module |
| Hardcoded credentials | 0 (regex sweep for key/secret/password/bearer/token) |
| `postMessage` listeners of its own | none — no cross-window message surface |
| Open redirect (`window.open`, `location =`) | 0; `location.href` is read-only, for error context |
| `localStorage` / `sessionStorage` | UI preferences and view cache only, no sensitive data |
| Dependency CVEs reachable from `apps/discussions` | 0 |

### The HTML sanitiser — read it before you triage any XSS finding

`apps/discussions/src/utils/summaryHtml.js` is an allowlist sanitiser sitting on
the editor → monday save boundary. It:

- keeps a closed tag allowlist, drops the whole subtree for
  `script/style/head/title/meta/link/iframe/object/embed`;
- strips **every** attribute, then restores a small per-tag allowlist;
- restricts `href` to `https?:|mailto:|tel:` and adds `rel="noopener noreferrer"`;
- rejects `url(`, `expression`, `javascript:` inside style declarations.

**Every SAST tool will flag the `innerHTML` writes in this file.** They are the
sanitiser's own machinery, operating on an already-scrubbed `DOMParser` document.
Report them as **false positives with that justification** — do not report them
as XSS, and do not "fix" them.

### Two open findings, both low severity

**F-1 — GraphQL document injection surface (low)**
`apps/discussions/src/utils/mondayApi/fileUpload.js`, lines **47** and **97**:

```js
add_file_to_column (item_id: ${Number(itemId)}, column_id: "${columnId}", file: $file)
```

`itemId` is coerced with `Number()`. **`columnId` is interpolated into the query
document unescaped.** It reaches this code from board configuration
(`docxExport.js:1265`), not from end-user input, which is why this is low and not
high. It is nonetheless the only place in the app where a string value reaches
GraphQL query text.

Fix, if the owner asks: promote it to a typed variable (`$col: String!`), exactly
as `clearFileColumn` in the same file already does. Two lines.

**F-2 — telemetry data minimisation (low/medium, currently dormant)**
`apps/discussions/src/utils/mondayApi/client.js` lines **279, 321, 330** attach
the full GraphQL document **and its `variables`** to error objects. Those
variables carry user-authored business content (discussion names, topic names,
column values). There is no redaction layer.

It is currently inert — the Axiom sink is gated behind `Boolean(AXIOM_TOKEN)` in
`src/index.jsx`, and no token is configured. **This must be resolved before
telemetry is activated**, not after. Confirm the gate still holds at the commit
you scan.

### Verified safe, so you don't re-flag them

- `utils/templateBatching.js` — batch mutations. All user data passes as typed
  variables (`$name0: String!`, `$cv0: JSON!`); only internally generated integer
  indices and aliases are interpolated.
- `utils/mondayApi/subscribers.js` — ids are `Number()`-coerced and filtered
  through `Number.isFinite`; the `kind` enum is constrained by a two-way ternary.
- `hooks/useStatusOptions.js` — labels pass through `JSON.stringify`; `color` is
  a GraphQL enum drawn from an internal palette.

---

## 4. Tools to run

Run all three. They cover different classes and the consultant will recognise
every name.

### 4.1 Semgrep — SAST (the headline)

```bash
pip install semgrep          # or: brew install semgrep
semgrep --version            # confirm you are on the current release

cd <repo-root>
semgrep scan \
  --config=p/javascript \
  --config=p/react \
  --config=p/owasp-top-ten \
  --config=p/xss \
  --config=p/secrets \
  --sarif --output=security/semgrep-discussions.sarif \
  apps/discussions

# human-readable pass for the report
semgrep scan --config=p/javascript --config=p/react --config=p/owasp-top-ten \
  --config=p/xss --config=p/secrets apps/discussions
```

This needs `semgrep.dev` reachable — that is the step that failed in the cloud.
If it 403s here too, your network is still restricted; stop and say so rather
than silently falling back to something weaker.

Exclude build output and vendored code, not test files:
`--exclude=build --exclude=dist --exclude=node_modules`.

### 4.2 Gitleaks — secrets across the **entire git history**

```bash
brew install gitleaks        # or: go install github.com/gitleaks/gitleaks/v8@latest

cd <repo-root>
gitleaks detect --source . --report-format json --report-path security/gitleaks.json --redact
```

`detect` walks the full commit history, not just the working tree. This matters:
a consultant asking about secret hygiene means history, because a key removed in
a later commit is still in the pack. The repo is **public**, which raises the
stakes.

Run it repo-wide, not scoped to `apps/discussions` — git history is not
per-directory.

**Known, expected, not a finding:** client builds bake `VITE_AXIOM_TOKEN` into a
publicly readable bundle. It is write-only and scoped to a single dataset. This
is inherent to any client-side app and should be **disclosed** in the report, not
buried.

### 4.3 OSV-Scanner — SCA against Google's OSV database

```bash
go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest
# fallback, verified working: github.com/google/osv-scanner/cmd/osv-scanner@latest (v1.9.2)

cd <repo-root>
osv-scanner --lockfile=pnpm-lock.yaml --format=json --output=security/osv.json
osv-scanner --lockfile=pnpm-lock.yaml       # readable pass
```

**Critical triage note.** `pnpm audit` at commit `2b0bb43` reported 34 advisories
across the workspace (1 critical, 18 high, 17 moderate, 2 low) out of 1,909
dependencies — and **not one was reachable from `apps/discussions`**. Every path
rooted in another app (`day-off`, `team-people-column`, `sync-calender`,
`deadline-confirm`, `planner`, `tracker`) or in the root ESLint devDependencies.
Nearly all were build/dev tooling (vite, vitest, esbuild, postcss,
brace-expansion, shell-quote) or server-side packages; the single critical was
the **vitest UI dev server**, which never ships.

OSV-Scanner will report the same workspace-wide set. **Do not present it as
"discussions has 34 vulnerabilities."** Attribute every advisory to its owning
package path, and state plainly which are shipped to a browser versus which live
only in the build toolchain. Getting this wrong is worse than not running the
scan.

Cross-check with `pnpm audit --json` and reconcile any disagreement.

### 4.4 Optional, if the consultant demands more

- **CodeQL** — the gold standard, and what GitHub Advanced Security runs. Free
  for public repos. Either enable it on GitHub (a `.github/workflows/codeql.yml`)
  or run the CLI locally. It performs true taint analysis with exhaustive path
  enumeration, which is the one thing manual review cannot guarantee.
- **`eslint-plugin-no-unsanitized`** (Mozilla's) and **`eslint-plugin-security`**
  — cheap to add to the existing ESLint 9 flat config at
  `apps/discussions/eslint.config.js`. Adds a standing gate rather than a
  one-off scan. If you wire these in, follow the config's existing philosophy:
  curated rules, each one justified in a comment.
- **`npx retire`** — known-vulnerable JS library detection.

---

## 5. Triage rules

A raw tool dump is not a security report, and a consultant will read it as
evidence you did not understand your own output.

For **every** finding:

1. **Trace the data flow yourself**, across files, from entry point to sink.
   Tools flag patterns; only tracing establishes reachability.
2. **State reachability explicitly**: can an end user influence this input, or
   does it come from board configuration / an admin / a constant?
3. **Justify the severity you assign**, especially when you downgrade the tool's
   default. F-1 is the model: real pattern, real sink, unreachable by an end
   user, therefore low.
4. **Mark false positives as false positives, with the reason.** The
   `summaryHtml.js` hits are the worked example.
5. **Never suppress a finding to make the report look clean.** A report with two
   honest lows is more credible than one with zero findings.

Do **not** fix anything you find without asking, other than F-1 if the owner
requests it. This task produces a report; a report that quietly rewrote the code
it was assessing is not a report.

---

## 6. Deliverable

Write **`docs/SECURITY-SCAN-REPORT.md`** with these sections:

1. **Scope and commit** — what was scanned, the exact SHA, the date.
2. **Tools and versions** — name and exact version of every tool, and the
   rulesets used. This is the sentence the consultant actually wants.
3. **Architecture and threat model** — the client-only, no-token, monday-owned-auth
   picture from §1. Explain *why* several vulnerability classes are out of scope,
   rather than silently omitting them.
4. **Findings** — one entry each: severity, file:line, data flow, reachability,
   recommendation. Ordered most severe first.
5. **False positives** — what was flagged and why it was dismissed. Do not skip
   this section; it is what demonstrates the output was actually read.
6. **Dependencies** — the SCA result, split into *shipped to the browser* versus
   *build/dev tooling only*, with the workspace-attribution caveat from §4.3.
7. **Known accepted exposures** — the `VITE_AXIOM_TOKEN` disclosure, and the
   public-repo posture.
8. **Limitations** — what these tools do *not* cover. Semgrep's OSS rules are
   pattern and dataflow rules, not exhaustive interprocedural taint analysis;
   no DAST was performed; no penetration test was performed. Say it plainly.

Commit the raw tool output under `security/` alongside the report so the findings
are reproducible and auditable.

Also append anything you learn to the relevant skill's `references/` directory,
per the repo's standing rule.

---

## 7. What NOT to do

- Do not push to `main` or `develop`, under any phrasing of the request.
- Do not run `mapps code:push`, or any deploy, from the local machine.
- Do not read, print, set or commit `MONDAY_TOKEN`.
- Do not add anything to `packages/shared` — it is an empty stub and touching it
  redeploys every app.
- Do not weaken or disable a lint rule, a test, or a repo hook to get a clean
  run. If a guard fires, the guard's message is the fix.
- Do not overstate the result. "Passed a Semgrep OWASP scan with two low findings"
  is defensible. "The app is secure" is not, and the consultant will know it.

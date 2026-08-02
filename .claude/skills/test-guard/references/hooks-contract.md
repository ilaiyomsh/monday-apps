# test-guard v2 — Binding Technical Contract

Status: BINDING for all builders. Deviations require an explicit contract amendment.
Skill dir (all `undefined` placeholders in the task resolve to this):
`<repo-root>/.claude/skills/test-guard` (where `<repo-root>` is the root of the current clone — `git rev-parse --show-toplevel`)

Referred to below as `$SKILL_DIR`. New subdirectory `$SKILL_DIR/hooks/` will hold the three hooks. Existing script: `$SKILL_DIR/scripts/redgreen.sh` (301 lines, read in full — its state ABI is frozen in §2).

---

## 1. Ground truth: Claude Code hooks API (fetched from https://code.claude.com/docs/en/hooks on 2026-07-07)

### 1.1 stdin JSON (all hook events)

Every hook receives one JSON object on stdin. Common fields (exact names):

- `session_id` (string)
- `transcript_path` (string)
- `cwd` (string)
- `hook_event_name` (string, e.g. `"PreToolUse"`, `"PostToolUse"`, `"Stop"`)
- `permission_mode` (string)

Tool events (`PreToolUse`, `PostToolUse`) additionally carry:

- `tool_name` (string: `"Write"`, `"Edit"`, `"Bash"`, …)
- `tool_input` (object):
  - Write/Edit: `tool_input.file_path` (Write also has `content`; Edit has `old_string`/`new_string` — we only rely on `file_path`)
  - Bash: `tool_input.command`
- `PostToolUse` additionally has `tool_response`.

`Stop` input carries the common fields plus `stop_reason`. **`stop_hook_active` is NOT documented in the current docs** — a targeted verbatim search of the page returned NOT FOUND. Consequence (binding): the stop gate's loop protection MUST rely on its own persisted counter (§3.4). It MUST still defensively honor the field if present at runtime (older/newer runtimes may send it): if stdin contains `"stop_hook_active"` with value `true`, exit 0 immediately with no output. Detection may be a plain grep for `"stop_hook_active"[[:space:]]*:[[:space:]]*true` — never assume the field exists.

### 1.2 Exit codes (docs, exact semantics)

- **exit 0** — success. stdout is parsed as JSON (if valid) and processed. **JSON output is ONLY processed on exit 0.**
- **exit 2** — blocking error. stdout is DISCARDED; stderr is shown as feedback. Blocks PreToolUse tool calls; prevents stopping on Stop. Cannot block PostToolUse (tool already ran).
- **any other exit code (incl. 1)** — NON-blocking error; shown as a "hook error" notice. **Footgun (binding rule): never signal a block with exit 1. Our hooks never exit non-zero at all** — all blocking is via exit 0 + JSON, which is the only path that delivers a structured reason; on any anomaly they exit 0 silently (§3.5).

### 1.3 stdout JSON per event (exact field names)

**PreToolUse** (modern format; the old top-level `decision`/`reason` for PreToolUse is legacy — use this):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "ask",
    "permissionDecisionReason": "<string shown to Claude/user>"
  }
}
```

`deny` blocks the tool call and feeds `permissionDecisionReason` back to Claude. No output at all = normal permission flow proceeds.

**PostToolUse** (cannot un-run the tool; can inject context):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "<string injected for Claude, 10k char limit>"
  }
}
```

(Top-level `decision: "block"` + `reason` also exists for PostToolUse but only prompts Claude with the reason; route-nudge uses `additionalContext` only — it is explicitly non-blocking.)

**Stop**:

```json
{
  "decision": "block",
  "reason": "<string — Claude receives this and continues working>"
}
```

`decision` and `reason` are TOP-LEVEL for Stop. Omitting output (or no `decision`) allows the stop.

Universal optional fields (do not use unless stated): `continue`, `stopReason`, `suppressOutput`, `systemMessage`.

### 1.4 Matcher syntax

Matchers are exact-name alternations: `"Write|Edit"`, `"Bash"`. `"*"`/empty matches all. Hook registration (goes in the project root's `.claude/settings.json`; the settings writer must merge, not clobber). `$CLAUDE_PROJECT_DIR` is expanded by Claude Code at hook-invocation time, so the registration is clone-location independent:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/hooks/testfile-lock.sh", "timeout": 5 }] },
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/hooks/testfile-lock.sh", "timeout": 5 }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/hooks/route-nudge.sh", "timeout": 5 }] }
    ],
    "Stop": [
      { "matcher": "*",
        "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/hooks/stop-gate.sh", "timeout": 10 }] }
    ]
  }
}
```

`timeout` is in seconds. One script (`testfile-lock.sh`) serves both PreToolUse matchers and branches on `tool_name`.

---

## 2. Existing state ABI — `redgreen.sh` (FROZEN; hooks read the SAME state)

### 2.1 State location

```
STATE_ROOT = ${TMPDIR:-/tmp}/redgreen-state            # current hard-coded scheme
STATE_DIR  = $STATE_ROOT/<key>
key        = first 16 hex chars of: printf '%s' "$ABS_TEST" | shasum -a 256
ABS_TEST   = physical absolute path of the test file, computed as:
             (cd "$(dirname "$file")" && printf '%s/%s\n' "$PWD" "$(basename "$file")")
```

Note macOS trap: `$TMPDIR` is a per-user `/var/folders/...` path — hooks MUST compute the default identically (`${TMPDIR:-/tmp}`), never hardcode `/tmp`.

### 2.2 State files (per test file, inside `$STATE_DIR`)

| File | Written by | Content / meaning |
|---|---|---|
| `red.hash` | `red` (also rewritten by `green --amended`) | sha256 (full 64-hex, `shasum -a 256` first field) of the test file at the moment red was observed |
| `red-fails.txt` | `red` | one failing test name per line (marker `✗×✕✖` and trailing duration stripped) |
| `green.ok` | `green` | sha256 of the test file when green passed. **Existence = green passed** |
| `amended.log` | `green --amended` | one appended reason line per amendment |
| `waiver.txt` | `waive` | appended waiver reason lines. Existence = waiver |
| `kills.log` | `spotcheck-fire` | appended lines: `KILLED\|<desc>`, `SURVIVED\|<desc>`, `INVALID\|<desc>` |
| `armed.src` | `spotcheck-arm` | absolute path of the currently armed source file (links a SOURCE file to this gate) |
| `<src>.mutbak` | `spotcheck-arm` | snapshot next to the SOURCE file (not in STATE_DIR) while armed |

`reset` removes the whole `$STATE_DIR`. Script exit codes: 0 = gate passed, 1 = gate FAILED, 2 = usage/setup/anomaly. (These are the SCRIPT's codes — unrelated to hook exit semantics; hooks never propagate them.)

### 2.3 The LOCK predicate (crown jewel)

A test file is **locked** ⇔ `red.hash` exists AND `green.ok` does NOT exist in its `$STATE_DIR`.

### 2.4 The DONE verdict rule (mirrors `cmd_status`, lines 276–284; hooks reimplement it read-only, no test runs)

With `red` = red.hash exists, `green` = green.ok exists, `killed` = count of `^KILLED|` lines, `survived` = count of `^SURVIVED|` lines, `waiver` = waiver.txt exists:

1. `survived > 0` → **NOT DONE** (unresolved survivors)
2. `red && green && (killed >= 2 || waiver)` → **DONE** (TDD path)
3. `!red && killed >= 2` → **DONE** (retrofit path)
4. else → **NOT DONE**

**Known quirk (builders must handle):** `SURVIVED|` lines are never removed when the same mutation is later killed, so verdicts stick at NOT DONE. Resolution mechanism is §4.4 (`survivors.sh resolve` rewrites the line to `SURVIVED-RESOLVED|<desc>`, which `grep -c '^SURVIVED|'` no longer counts — no change to redgreen's status code needed).

### 2.5 Gaps the extensions must fill

Current state dirs contain NO reverse mapping from `<key>` back to the test path (the key is a one-way hash). Therefore (§4.6): every state-writing command must additionally write `$STATE_DIR/test.path` (the `ABS_TEST`, one line). State dirs lacking `test.path` (pre-v2) are invisible to hooks — acceptable, documented.

---

## 3. Shared conventions (apply to EVERY new hook and script)

### 3.1 State-root env override (testability)

`redgreen.sh` has no override today; this contract defines one, and redgreen.sh is extended to honor it:

```sh
STATE_ROOT="${REDGREEN_STATE_ROOT:-${TMPDIR:-/tmp}/redgreen-state}"
```

Every hook and script resolves state exclusively under `$STATE_ROOT`. Default is byte-identical to current behavior (backward compatible). Verifiers inject fake state by exporting `REDGREEN_STATE_ROOT` to a scratch dir.

### 3.2 Session-scoped state (new)

```
$STATE_ROOT/sessions/<session_id>/touched.txt        # appended by route-nudge (one abs source path per line)
$STATE_ROOT/sessions/<session_id>/stop-blocks.count  # single integer, managed by stop-gate
$STATE_ROOT/sessions/<session_id>/nudged.txt         # files already nudged this session (dedupe, §4.2)
```

`<session_id>` must be sanitized before use as a path component: strip everything but `[A-Za-z0-9._-]`; if empty after sanitizing, exit 0 silently. Stale session dirs are left for OS tmp cleanup.

### 3.3 Portability

bash 3.2 (macOS default): no associative arrays, no `${var,,}`, no `mapfile`/`readarray`, no `&>>`. `shasum -a 256` (not sha256sum). `jq` only behind a runtime check:

```sh
if command -v jq >/dev/null 2>&1; then ...; else <sed/grep fallback>; fi
```

Both branches mandatory in every hook that parses stdin. Fallback extraction patterns (sufficient because Claude Code emits standard JSON string encoding; paths with `"` in them are out of scope):

```sh
# file_path:  sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
# tool_name:  sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
# session_id: sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
# command: prefer jq; in fallback, unescape \" \\ \n minimally via sed before matching
```

When emitting JSON without jq, all interpolated strings must be escaped: at minimum `\` → `\\`, `"` → `\"`, newlines → `\n` (a small `json_escape()` shell function; builders share one implementation by copy — hooks may not source files outside their own dir).

### 3.4 Loop protection constants

`MAX_STOP_BLOCKS` default **2** (the task's placeholder value is fixed here), overridable via env `TEST_GUARD_STOP_MAX_BLOCKS`. After the counter reaches the max, stop-gate allows the stop but emits a warning (§4.3).

### 3.5 Hook safety invariants (all three hooks)

1. **Never crash the session**: top of script sets `set -u` at most; every anomalous path (unreadable stdin, missing fields, unparsable JSON, missing state root, sed failure) → `exit 0`, no output. Recommended skeleton: main logic in a function; `main "$@" 2>/dev/null || exit 0; exit 0`.
2. **Never exit non-zero.** Blocking is exit 0 + JSON only (§1.2 footgun).
3. **Fast**: < 2s worst case. No network. No LLM calls. No test-runner invocations. Never call `redgreen.sh red/green/spotcheck-*` from a hook. Filesystem reads under `$STATE_ROOT` plus at most one bounded upward walk for `package.json` are the ceiling. Iterating `$STATE_ROOT/*/` is O(number of tracked test files) — acceptable.
4. **Every block has an escape hatch**, stated inside the deny/block reason text itself (amend-intent for the lock; `waive` for the stop gate). A block message that doesn't tell the agent the sanctioned way out is a contract violation.
5. Hooks are read-only w.r.t. gate state, EXCEPT: testfile-lock consumes `amend-intent` (§4.1), route-nudge appends to session files (§3.2), stop-gate increments its counter.

---

## 4. Component contracts

### 4.1 `$SKILL_DIR/hooks/testfile-lock.sh` — PreToolUse (matchers `Write|Edit|MultiEdit` and `Bash`)

Input: stdin JSON per §1.1. Branch on `tool_name`.

**Write/Edit/MultiEdit branch:**
1. Extract `tool_input.file_path`. Empty → exit 0 silently.
2. Normalize to a physical abs path: if the file exists use the §2.1 `abs_path` recipe; else normalize textually against `cwd` from stdin (a nonexistent file can still be a Write target; a locked file always exists, so a failed physical resolution that still string-matches a `test.path` is decided by string comparison).
3. Enumerate `$STATE_ROOT`/*/ dirs having `test.path`. For each where the lock predicate (§2.3) holds and `test.path` content equals the normalized path → **locked hit**.
4. On hit, check `$STATE_DIR/amend-intent.txt`:
   - Present → CONSUME it: `mv "$STATE_DIR/amend-intent.txt" "$STATE_DIR/amend-consumed.log.$(date +%s)"` (mv = atomic consumption; exactly ONE edit passes even under races), append its content to `$STATE_DIR/amended-intent.log`, then exit 0 with `permissionDecision: "allow"` and reason `"amend-intent consumed: <reason>"`.
   - Absent → exit 0 emitting:
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"test-guard LOCK: <path> is hash-locked (red recorded, green not yet passed). Editing a test while making it pass invalidates the red gate. Sanctioned paths: (a) implement product code until 'redgreen.sh green <path>' passes, or (b) declare intent first: '<abs redgreen.sh> amend-intent <path> \"one-line reason\"' — that unlocks exactly ONE edit, and green will then require --amended."}}
```
5. No hit → exit 0, no output.

**Bash branch:**
1. Extract `tool_input.command`. Empty → exit 0.
2. Build the locked set (paths + basenames) as above. Empty set → exit 0 (fast path).
3. Deny iff BOTH: (a) command matches the destructive-verb regex `(^|[;&|[:space:]("'\''`])(rm|mv|truncate)[[:space:]]|(^|[;&|[:space:]])cp[[:space:]].*[[:space:]]|git[[:space:]]+(checkout|restore)([[:space:]]|$)|(>|>>)[[:space:]]*` (builders may tighten; `cp` counts only when a locked file is plausibly the DESTINATION — matching the locked path/basename after `cp ` is sufficient; precision beyond that is not required), AND (b) the command string contains the full locked path OR the locked file's basename as a word. False positives are acceptable by design — the deny reason names the amend-intent escape and the option to rephrase the command.
4. A pending amend-intent is honored here too (same consumption, one shot total across both branches).
5. Deny JSON identical in shape to the Write/Edit branch, reason prefixed `test-guard LOCK (bash):` and quoting which locked file matched.

### 4.2 `$SKILL_DIR/hooks/route-nudge.sh` — PostToolUse on `Write|Edit|MultiEdit`

Non-blocking by definition (§1.2). Steps:

1. Extract `file_path`, `session_id`. Missing either → exit 0.
2. **Product-source filter** (ALL must hold, else exit 0 silently):
   - extension is `.js`, `.mjs`, `.cjs`, or `.ts` (this excludes `.jsx`/`.tsx` = the JSX-view exclusion; also excludes `.md`, `.json`, `.css`, etc.)
   - path does NOT contain `/node_modules/`, `/dist/`, `/build/`, `/.claude/`, `/coverage/`
   - basename does NOT match `\.(test|spec)\.` and path does not contain `/__tests__/`, `/tests/`, `/test/`
   - basename does NOT match `(\.config\.|^\.|rc\.(js|cjs|mjs|ts)$|vite\.|vitest\.|jest\.|babel\.|eslint)`
   - "in a monday app": an upward walk from the file (max 15 levels, stop at `/`) finds a `package.json`, and the file's abs path starts with the project root the session runs in (the hooks derive it from `$CLAUDE_PROJECT_DIR`, falling back to `git rev-parse --show-toplevel`, then the hook's cwd; env override `TEST_GUARD_APPS_ROOT` replaces that prefix for verifier fixtures).
3. **Always** (for any file passing the filter): append abs path to `$STATE_ROOT/sessions/<sid>/touched.txt` (mkdir -p first). Append-only; stop-gate dedupes.
4. **Nudge decision** — module gate lookup for the touched source file `S` (a "module" = one product source file):
   - armed gate: some state dir's `armed.src` equals `S` → gate exists;
   - else conventional-test probe: candidate test paths are `dirname(S)/<stem>.test.<ext>`, `dirname(S)/<stem>.spec.<ext>`, `dirname(S)/__tests__/<stem>.test.<ext>` for ext ∈ {js,ts,mjs,cjs,jsx,tsx}; a candidate maps to a state dir via the §2.1 hash — if that dir exists, the module is tracked;
   - a tracked module counts as covered if its verdict (§2.4) is DONE, or `waiver.txt` exists, or the gate is currently in-flight (red.hash exists — the lock/stop-gate own that case).
5. If NOT covered AND `S` is not already in `$STATE_ROOT/sessions/<sid>/nudged.txt` (dedupe: nudge each file at most once per session, so the agent isn't spammed): append `S` to nudged.txt and exit 0 emitting:
```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"test-guard: <relpath> is product source with no armed test-guard gate, no DONE verdict, and no waiver. Route this change through test-guard before finishing: /test-guard tdd (new behavior) or /test-guard retrofit <dir> (existing code), or record a waiver via redgreen.sh waive. The Stop gate will hold the session open until every touched module is DONE or waived."}}
```
6. Otherwise exit 0, no output.

### 4.3 `$SKILL_DIR/hooks/stop-gate.sh` — Stop

1. Read stdin. If it contains `"stop_hook_active": true` (defensive, §1.1) → exit 0 silently.
2. Extract `session_id`; missing → exit 0. `T = $STATE_ROOT/sessions/<sid>/touched.txt`. Missing or empty → **fast-exit 0 silently** (nothing touched — this is the common path and must cost one stat).
3. Dedupe `T` (sort -u). For each touched file, compute covered/uncovered exactly per §4.2 step 4 (same lookup, same verdict rule). Collect uncovered module list `U`.
4. `U` empty → exit 0 silently.
5. Loop guard: read counter `C` from `$STATE_ROOT/sessions/<sid>/stop-blocks.count` (absent = 0). If `C >= MAX_STOP_BLOCKS` (§3.4) → exit 0 emitting a WARNING as `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"test-guard stop-gate: allowing stop after <C> blocks, but these modules are still not DONE/waived: <list>. This is recorded, not forgiven."}}` — allow the stop (explicit escape hatch + loop protection).
6. Else write `C+1` back and exit 0 emitting:
```json
{"decision":"block","reason":"test-guard stop-gate (block <C+1>/<MAX>): touched modules without DONE verdict or waiver: <one per line: relpath — current state e.g. 'red recorded, green missing' / 'untracked' / '1 survivor open'>. Finish the gate (redgreen.sh green / spotcheck-arm+fire until >=2 KILLED) or record an objective waiver: redgreen.sh waive <test-file> \"reason\". After <MAX> blocks the gate yields with a warning."}
```
(`decision`/`reason` are top-level for Stop — §1.3.)
7. Counter and touched log are per `session_id`, so parallel sessions never share a budget.

### 4.4 `$SKILL_DIR/scripts/survivors.sh`

Not a hook — a normal CLI (may take seconds, may be verbose). Honors `REDGREEN_STATE_ROOT`. Resolves `$STATE_DIR` from a test file via the §2.1 recipe (shared with redgreen.sh). Exit codes: 0 ok, 2 usage/anomaly.

Storage — one record per file to allow multi-line diffs:
```
$STATE_DIR/survivors/<NNN>            # NNN = zero-padded 3-digit sequence (001, 002, …)
  format: header lines 'key: value' then a blank line then the free-form mutation diff
  keys: file, line, status(OPEN|KILLED), created(ISO-8601), hypothesis, desc
        (`desc` = the exact string logged (or loggable) to kills.log as `SURVIVED|<desc>`;
         `resolve` needs it verbatim to rewrite that line, so it is stored, not re-derived —
         defaults to `hypothesis` when `--desc` is omitted)
$STATE_DIR/strengthen.iter            # single integer, per-module strengthen-iteration counter
```

Subcommands:
- `survivors.sh record <test-file> --src <src-file> --line <N> --hypothesis "<missing assertion hypothesis>" [--desc "<one-line>"]` — reads the mutation diff from stdin (or `--diff-file <path>`); writes the next `survivors/NNN` with `status: OPEN`; also appends `SURVIVED|<desc-or-hypothesis>` to `kills.log` IF the caller passes `--log-kills` (spotcheck-fire already logs its own line; the flag prevents double counting — default is NOT to touch kills.log).
- `survivors.sh report <test-file>` — prints the **strengthen-brief**: for every OPEN record: `file:line`, the mutation diff verbatim, the hypothesis, and the imperative next step ("add/strengthen an assertion that fails under this diff, then re-arm and re-fire the SAME mutation"). Ends with the iteration count and, when `strengthen.iter >= 4`, the warning: `"WARNING: 4+ strengthen iterations on this module — research shows convergence by ~4; the remaining survivors likely indicate an equivalent mutant or a design problem (untestable seam). Consider redesign or an explicit waiver instead of iteration 5."`
- `survivors.sh iterate <test-file>` — increments `strengthen.iter`, prints new value, emits the same warning at >= 4. Called once per strengthen round by the skill flow.
- `survivors.sh resolve <test-file> <NNN>` — sets that record's `status: KILLED`, and rewrites the FIRST still-unresolved matching `^SURVIVED|<desc>` line in `kills.log` to `SURVIVED-RESOLVED|<desc>` (in-place via temp file + mv), so the §2.4 verdict can reach DONE. This is the sanctioned fix for the §2.4 quirk.
- `survivors.sh list <test-file>` — one line per record: `NNN  OPEN|KILLED  file:line  hypothesis`.

### 4.5 `$SKILL_DIR/scripts/impact.sh`

`impact.sh <changed-src-file>` — informational, always exit 0 on success (2 on usage/missing file). No state writes.

1. Project root = nearest ancestor with `package.json` (die 2 if none).
2. Consumer scan: `grep -rn` (with `--include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' --include='*.mjs' --include='*.cjs'`, excluding dirs `node_modules`, `dist`, `build`, `coverage`, `.git`) over the project root for import/require of the module: match `from ['"]...<stem>['"]`, `require(['"]...<stem>['"])`, and `import(...<stem>...)` where `<stem>` = basename without extension; then filter hits to those whose resolved relative specifier actually points at the changed file (string-suffix check on the specifier path — full Node resolution NOT required, documented as heuristic).
3. Output section 1 — `CONSUMERS:` one line each `path:line  <matched import line>`, split into `production:` and `test:` (test = §4.2 test-path patterns).
4. Export extraction: grep the changed file for `export (default|const|function|class|let|var) <name>`, `export { a, b }`, `module.exports.<name> =`, `module.exports = { ... }` — collect exported identifiers (default export reported as `default`).
5. For each exported identifier, grep the PRODUCTION consumer files (from step 3) for the identifier as a word. Zero production hits → list under `DEAD-CODE CANDIDATES:` with the caveat line `(heuristic: re-exports, dynamic access, and default-import renaming are not tracked — verify before deleting)`.
6. If the module has zero production consumers at all, say so explicitly — the whole file is the candidate.

### 4.6 `redgreen.sh` EXTENSIONS (backward compatible — no existing command's flags, output tokens (`RED GATE PASSED` etc.), or exit codes may change)

1. **`REDGREEN_STATE_ROOT`** honored per §3.1 (edit line 73's `STATE_DIR=` computation to go through `STATE_ROOT`).
2. **`test.path`**: `resolve_env` gains nothing, but every point that does `mkdir -p "$STATE_DIR"` (cmd_red, cmd_arm, cmd_waive — and add it to cmd_green's success path defensively) must also write `printf '%s\n' "$ABS_TEST" > "$STATE_DIR/test.path"`. This is the reverse index the hooks depend on.
3. **`amend-intent <test-file> "<reason>"`** (new): requires the file to be currently locked (§2.3) — otherwise print `NO LOCK: <file> is not hash-locked; amend-intent is unnecessary` and exit 0 without writing. When locked: write (overwrite, not append — the intent is one-shot) `$STATE_DIR/amend-intent.txt` containing `<ISO-8601> <reason>`; print confirmation stating exactly ONE Write/Edit/Bash touch of the file will be allowed and that `green` will still demand `--amended "<reason>"`. Reason must be non-empty (usage error 2 otherwise).
4. **`status-all`** (new): iterate `$STATE_ROOT`/*/ having `test.path`; print an aligned table: `TEST-FILE | RED | GREEN | LOCKED | KILLED | SURVIVED | WAIVER | VERDICT` where VERDICT ∈ `DONE` / `NOT-DONE` / per §2.4, LOCKED per §2.3. Dirs whose `test.path` no longer exists on disk are listed with `(missing)`. Exit 0 always (informational), also when zero tracked files (`no tracked test files`).
5. **`verdict <test-file>`** (new, cheap helper for hooks/scripts): prints exactly one word — `DONE`, `NOT_DONE`, or `UNTRACKED` (no state dir / no red.hash & no kills.log) — computed per §2.4 WITHOUT running any tests. Exit 0 in all three cases.
6. **`locked`** (new): prints the abs path of every currently locked test file (one per line, from `test.path`); prints nothing and exits 0 when none.
7. `status` (existing) additionally prints `amend-intent: pending|none` — additive output line only, appended after `waiver:`.

### 4.7 Files each builder owns

```
$SKILL_DIR/hooks/testfile-lock.sh    (new, chmod +x)
$SKILL_DIR/hooks/route-nudge.sh      (new, chmod +x)
$SKILL_DIR/hooks/stop-gate.sh        (new, chmod +x)
$SKILL_DIR/scripts/survivors.sh      (new, chmod +x)
$SKILL_DIR/scripts/impact.sh         (new, chmod +x)
$SKILL_DIR/scripts/redgreen.sh       (extend per §4.6 only)
<project-root>/.claude/settings.json  (merge hook registrations, §1.4)
```

---

## 5. Verification requirements (per test-guard's own philosophy)

Every component must be demonstrated FAILING-then-passing by its builder before it counts:

- Hooks: pipe hand-crafted stdin JSON with `REDGREEN_STATE_ROOT` pointed at a fixture dir; assert (a) deny/block JSON emitted for a locked/uncovered fixture, (b) silent exit 0 for clean fixtures, (c) silent exit 0 for garbage stdin (`echo 'not json' | hook` must exit 0, empty stdout), (d) `echo '{}' | hook` exits 0 silently, (e) stop-gate honors the counter across repeated invocations and yields with the warning at `MAX`, (f) amend-intent lets exactly one edit through (second identical PreToolUse input is denied again).
- `redgreen.sh` extensions: run the EXISTING commands against a scratch vitest project before and after the change — identical observable behavior (golden output allowing the one additive `amend-intent:` status line); then exercise the new commands with `REDGREEN_STATE_ROOT` overridden.
- Timing: each hook invocation over fixtures completes in < 2s (`time` it with ~20 fake state dirs).
- All shellcheck-clean for `--shell=bash` at severity warning or better, and runnable under `/bin/bash` (3.2) on this Mac — not just under a newer Homebrew bash.


---

## Amendment 2026-07-07 (post-shakedown fixes)

0. **Definition — LIVE-ARMED**: `armed.src` alone is stale metadata of the last arm (spotcheck-fire's restoring `mv` removes only the `.mutbak`). A gate is live-armed — the mutation may still be APPLIED to product source — iff `armed.src` exists AND the `<armed src>.mutbak` sibling exists. Amendments 1–3 key on live-armed, not on `armed.src` alone.
1. **§4.2 step 4 in-flight definition widened**: a module counts as in-flight/covered when `red.hash` exists **OR the gate is live-armed**. Applied to `route-nudge.sh` (`is_covered`). Rationale: shakedown found route-nudge emitting a factually wrong "no armed gate" nudge on every retrofit's first mutation edit. A stale-armed idle gate with <2 kills still gets the nudge (correct — that work was abandoned).
2. **stop-gate keeps blocking on live-armed gates** (deliberate deviation from the reviewer's suggested symmetric fix): a session that stops while live-armed may be leaving an APPLIED mutation in product source — exactly the silent-broken-source hazard the shakedown flagged. Instead of covering it, `uncovered_desc` now names the hazard and both resolution paths (spotcheck-fire / restore `.mutbak`).
3. **§4.6 `status-all` gains an ARMED column** (live-armed only) plus a trailing WARNING block listing the armed source paths, so an interrupted armed mutation is visible without reading state dirs by hand.
4. **§1.4 registration snippet aligned to reality**: matchers are `Write|Edit|MultiEdit` for testfile-lock (PreToolUse) and route-nudge (PostToolUse); all timeouts are 10s (the 5s in the original snippet is superseded).
5. **Destructive-Bash regex refined** (2026-07-07, found by dogfooding on the first real TDD run): the redirect arm previously matched fd redirects (`2>&1`), so the sanctioned `redgreen.sh green <locked-file> 2>&1 | tail` was denied. The redirect target must now start with a non-`&`/non-`>` token (a real path). File clobbers (`> file`, `>> file`) still deny.
6. **error-guard interop** (owned by error-guard, recorded here for discoverability): `error-guard-check.sh` skips any file with a `.mutbak` sibling — an armed test-guard mutation is deliberate, and "fix then re-edit" mid-spot-check would break the one-mutation-at-a-time protocol. The pristine file is re-checked on its next real edit.

## ~~Known gap~~ FIXED by amendment 7 (same day): waive was unreachable for runner-less apps

`stop-gate.sh` covers a touched module only via a state dir found by `gate_dir_for_src`
(armed.src == source, or `test.path` == one of the 4 conventional test candidates).
But `redgreen.sh waive` runs `resolve_env`, which **dies if the test file does not
exist** — so in an app with no test suite at all (e.g. CEO_Display before vitest lands)
there is no way to record a waiver the stop-gate can see: waiving the SOURCE path
creates a state dir keyed to the source (invisible to the candidate patterns), and
waiving the conventional test path fails with "test file not found". The only path
through is the loop-protection yield after MAX blocks ("recorded, not forgiven").
Fix candidates for a future session: let `cmd_waive` use state-only resolution
(like `cmd_verdict`/`cmd_amend_intent`), or teach `gate_dir_for_src` to also match
state dirs whose `test.path` equals the touched source itself.

7. **Runner-less waiver fallback** (2026-07-07, closes the known gap above): `gate_dir_for_src` (stop-gate) and `find_gate_dir` (route-nudge) now try one more key after the 24 conventional test candidates — the touched SOURCE path itself. That is the only key `redgreen.sh waive` can create in an app with no test files (resolve_env dies on a nonexistent test path, so waiving the existing source file is the recorded workaround). Verified: the error-guard pilot's 21 CEO_Display waivers became visible with no re-recording; genuinely untracked files still block; a mixed session lists only the untracked ones. The deeper fix (state-only resolution for cmd_waive) remains open as a nice-to-have.

8. **`fail_names` multibyte-marker stripping** (2026-07-14, found in a cloud/Linux session): in a C/POSIX locale, the sed bracket class `[✗×✕✖]` matches single BYTES of the multi-byte failure glyph, leaving a residual byte (observed: 0x97) glued to the front of every name recorded in `red-fails.txt`. The green gate then greps those corrupted names against the (clean) verbose output and false-fails with "test(s) recorded failing at red are ABSENT from this run" — on EVERY tdd flow in that environment. Fix in `redgreen.sh fail_names`: strip the marker as an alternation of full glyphs `(✗|×|✕|✖)` under `LC_ALL=C`, plus a defensive `s/^[^ -~]+[[:space:]]*//` that removes any leftover non-ASCII marker bytes (test names as recorded start at the ASCII relative path). Verified both directions with a sandboxed fixture (`REDGREEN_STATE_ROOT`): red records clean names and green then passes after implementation (false positive gone); green while tests still fail is still blocked (true positive intact).

9. **~~Known gap~~ FIXED by amendment 11 — multi-module test file loses earlier `armed.src` mappings** (2026-07-14, found on the deadline-confirm bootstrap): when ONE test file gates SEVERAL source modules (e.g. `tests/core-output.test.js` covering pages.js + snippet.js + logger.js, each spot-checked with 2 KILLED mutations), `armed.src` in that state dir is overwritten on every `spotcheck-arm` — after the last fire it names only the LAST source (logger.js). `gate_dir_for_src` then reports the earlier modules (pages.js, snippet.js) as "untracked" at stop time even though their kills are in the same dir's kills.log and the verdict is DONE. Observed workaround (sanctioned, logged): source-keyed waivers whose reason points at the DONE gate and names the killed mutations. Fix candidates for a future session: make `armed.src` append-only (one line per armed source, `lookup_armed` matching any line), or record `killed-srcs.txt` alongside kills.log and teach `gate_dir_for_src` to consult it. **Recurred 2026-07-15 (deadline-confirm v3 multitenant), same `tests/core-output.test.js` gating html.js after pages.js/snippet.js re-armed it** — closed the same way (source-keyed waiver on html.js). Reporting note for the next reader: a bare source-keyed waiver makes `stop-gate.sh` treat the module as covered (it checks `waiver.txt` existence directly, line ~226), but `redgreen.sh status`/`verdict_for_dir` still PRINT `VERDICT: NOT DONE` for that dir because both their DONE branches also require red+green — the waiver only substitutes for the `killed>=2` clause, not for red+green. So "waiver: yes" + "VERDICT: NOT DONE" together is expected for a pointer waiver and does NOT mean the stop is blocked. Aligning the two computations (status honoring a bare waiver like the stop-gate does) is a candidate fix but is enforcement-mechanism-wide, so deferred with the above.

10. **Known gap — `node:test` (TAP) output is invisible to `fail_names`** (2026-07-28, found wiring unit tests for `scripts/lib/workflow-env.mjs`, the structural workflow reader behind the error-wiring audit): repo-root `scripts/` has no vitest/jest and deliberately carries **no dependencies** (the audit is `node:fs` only), so its tests use Node's built-in runner. Two independent blocks follow. (a) `resolve_env` dies with "no vitest/jest declared in any package.json above the test file" for EVERY subcommand including `waive` — `REDGREEN_RUNNER='node --test'` is enough to get past it, even for `waive`, which runs no tests. (b) `fail_names` greps for the vitest/jest glyphs `(✗|×|✕|✖)`; node:test emits TAP (`not ok 1 - <name>`), so red records ZERO failing names and the gates cannot function even though the tests genuinely run, genuinely fail on a stub, and genuinely pass after implementation. Closed here with the **Manual gate** (mutation-protocol.md) + source-keyed waivers pointing at the pasted evidence: 12/12 red on a `NOT_IMPLEMENTED` stub → 12/12 green → 5 KILLED mutations, with the one initial survivor (removing the `stepsIndent` reset) resolved by strengthening the two-jobs fixture with a `needs:` list rather than being waived away. Fix candidate for a future session: teach `fail_names` a TAP branch (`^not ok [0-9]+ - (.*)$` → name) and `passed_count`/`skipped_count` the `# pass` / `# skip` summary lines, selected by runner or by sniffing `TAP version` in the output. That would make the automatic gate work for any stdlib-runner package, of which this repo now has one (`ci.yml` step "Audit lib unit tests", `node --test scripts/lib/*.test.mjs`).

11. **Multi-module gate association is append-only (`gated-srcs.txt`)** (2026-08-02, closes known gap 9 on its **third** occurrence — twyst-your-status round313, one `defaultStatusLabel.test.js` gating `statusLabelDraft.js` + `statusColors.js`). `redgreen.sh spotcheck-fire` now appends the mutated SOURCE path to `<state dir>/gated-srcs.txt` (deduped) on every **KILLED** fire, and `gate_dir_for_src` (stop-gate) / `find_gate_dir` (route-nudge) consult those lines alongside `armed.src`. Written on KILL, not on arm: an armed-but-never-fired source proves nothing, and arming already maps through `armed.src`. No enforcement is weakened — `armed.src` already mapped the LAST armed source to that dir's verdict, so this only extends the same mapping to the earlier ones (kill attribution has always been per state dir, not per source: `kills.log` records descriptions only). Verified both directions with a sandboxed fixture (`REDGREEN_STATE_ROOT`, three state-dir/session pairs): a module listed in `gated-srcs.txt` of a DONE dir no longer blocks the stop; removing that one file reproduces the block (so the fixture discriminates); a genuinely untracked module still blocks; the last-armed module still resolves. In-repo after the fix: editing `statusColors.js` — no longer the last-armed source — draws no route-nudge, while `services/mondayService.js` still does. The previous workaround (source-keyed pointer waivers) is no longer needed for this case; existing ones stay valid and harmless.

    *Usability trap found while using the survivor loop the same day (not a defect — documented behaviour worth flagging):* `survivors.sh record` defaults `--desc` to `--hypothesis`, but `spotcheck-fire` logs the **mutation description**, and the two are normally different sentences (the hypothesis is about the missing assertion, the description about the injected bug). When they differ, `survivors.sh resolve` marks the record KILLED and its `kills.log` fixup silently no-ops, so `^SURVIVED|` survives and the verdict stays NOT DONE with no obvious cause. Pass `--desc "<exactly what spotcheck-fire logged>"` when recording. Candidate fix: have `record` default `--desc` to the newest unresolved `SURVIVED|` line in `kills.log` when one exists, instead of to the hypothesis.


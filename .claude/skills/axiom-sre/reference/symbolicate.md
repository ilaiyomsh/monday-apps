# Symbolicate — minified `stack1` → original source

`app-errors` rows carry a single **minified** `stack1` frame
(`at Sl (…/assets/index-Brz8XzEh.js:61:29212)`) to stay within the wire's privacy
budget. `scripts/symbolicate` resolves that frame back to `File.jsx:line:col` using
the build's sourcemap, which is produced but **never shipped to the CDN**.

## How the maps get there (see `docs/LOGGING-ARCHITECTURE.md` §6)

- Client apps build with **`build.sourcemap: 'hidden'`** — `.map` files are written
  but the `//# sourceMappingURL=` comment is omitted, so browsers never fetch them.
- Each client deploy workflow, **between Build and `mapps code:push`**, uploads
  `build/**/*.map` as the artifact **`sourcemaps-<app>-<github.sha>`** (90-day
  retention) and then **deletes every `.map` from the deploy dir**, asserting none
  remain. Maps live only in GitHub Actions artifacts, gated by repo access.

## Usage

```bash
# By ver (the log row's `ver` = <pkgVersion>+<shortSha>) — pulls the CI artifact via gh:
scripts/symbolicate '<stack1 string>' --app discussions --ver 2.3.0+9292e7a

# By full sha:
scripts/symbolicate '<stack1 string>' --app discussions --sha <40-char-sha>

# Offline, against a local or already-downloaded map:
scripts/symbolicate 'index-<hash>.js:61:29212' --map apps/discussions/build/assets/index-<hash>.js.map

# More/less source context (default 3 lines):
scripts/symbolicate '<frame>' --map <file> -C 6
```

`<frame>` accepts the raw `stack1` string, a bare URL, or just `file.js:LINE:COL`.

### Getting the frame + ver from Axiom

```bash
scripts/axiom-query prod --since 7d --ndjson <<< \
  "['app-errors'] | where app=='discussions' and level=='error' | project ver, stack1 | take 5" \
  | grep -v '^#' | jq -r '"\(.ver)\t\(.stack1)"'
```

Then feed each `stack1` with its `ver` into `symbolicate`.

## Requirements & notes

- **`gh` authenticated** for the `--app/--ver/--sha` path (it lists + downloads the
  artifact). The `--map` path needs no network.
- First run installs one dependency (`@jridgewell/trace-mapping`) into
  `scripts/lib/node_modules` (gitignored).
- **Bundle hash must match the build.** A frame from production ver `X+abc1234`
  only resolves against the artifact for that exact SHA — a locally rebuilt bundle
  has different hashes and offsets. Match the `ver`.
- Artifacts **expire** (retention set in the deploy workflow, default 90 days). For
  an older crash, re-run the deploy workflow on that commit (`workflow_dispatch` on
  the draft workflow) to regenerate the artifact, or bump retention.
- Column handling: browser stacks report 1-based line + 1-based column; the tool
  converts to the sourcemap's 1-based line + 0-based column automatically.

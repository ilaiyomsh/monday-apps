# `.codex/` — running this repo under OpenAI Codex

Codex reads [`AGENTS.md`](../AGENTS.md) at the repo root automatically. This
directory adds the two things `AGENTS.md` alone cannot give it: the **enforcement
hooks** and the **standing session briefing**.

```
.codex/
  hooks.json               hook wiring (mirrors .claude/settings.json 1:1)
  briefing.md              the standing briefing text — edit this, not the script
  hooks/session-brief.sh   SessionStart hook: injects briefing.md as context
  hooks/codex-adapter.py   Codex payload -> Claude payload bridge
  hooks/tests/             adapter test suite
  skills -> ../.claude/skills   symlink: Codex project-skill discovery path
  verify.sh                check the whole wiring on your machine
```

`.agents/skills` is the same symlink under the cross-agent convention, so skills
resolve whichever path your Codex version looks in.

## One-time setup (per developer)

1. **Enable hooks.** They are experimental and off by default. In
   `~/.codex/config.toml`:
   ```toml
   [features]
   codex_hooks = true
   ```
2. **Trust the project.** Project-local hooks load only when the project `.codex/`
   layer is trusted — approve the trust prompt when Codex first opens the repo. In
   an untrusted project Codex silently loads only your user-level hooks, so this
   repo's guards would not run.
3. **Verify.** `bash .codex/verify.sh`, and `/hooks` inside Codex to confirm they
   are registered. Do not assume — a hook that is not loaded fails silently and
   looks identical to one that passed.

No token setup belongs here: `MONDAY_TOKEN` is user-only and agents never touch it
(see `AGENTS.md`).

## How the bridge works

Codex's hook protocol is nearly Claude Code's — same stdin keys (`tool_name`,
`tool_input`, `cwd`), same "exit 2 + stderr blocks the call", same
`permissionDecision` JSON. What differs is tool naming and input shape:

| Codex | Claude Code |
|---|---|
| `tool_name: "shell"` | `"Bash"` |
| `tool_input.command: ["bash","-lc","<script>"]` | `tool_input.command: "<script>"` |
| `tool_name: "apply_patch"`, N files per call | `"Write"` / `"Edit"`, one file per call |

`codex-adapter.py` normalizes and then **delegates to the real script** in
`.claude/hooks/`. The enforcement logic is single-sourced — there is no forked
Codex copy to drift.

That translation is load-bearing, not cosmetic. Every guard begins with
`if tool_name != "Bash": exit 0`, so an unnormalized Codex payload does not error
— it **fails open silently while looking perfectly wired**. And a naive
space-join of `["bash","-lc","mapps code:push"]` would hide the deploy from
deploy-guard, whose patterns anchor to a command position. Both cases are pinned
by tests.

## Tests

```bash
bash .codex/hooks/tests/adapter.test.sh
```

23 cases: payload normalization, patch fan-out, deny passthrough, fail-open
semantics, and end-to-end blocking through the real deploy-guard. Change the
adapter → run these. They were written red-first and both of the adapter's
load-bearing behaviours are mutation-checked (disabling either turns the suite
red).

## Known caveats

- **File-edit hooks may not fire.** Codex's `PreToolUse`/`PostToolUse` coverage for
  `apply_patch` is version-dependent (upstream openai/codex#16732). The wiring is
  registered and harmless if it never fires — but until you have confirmed it does
  on your version, treat `error-guard` and `test-guard` as **self-enforced** and
  run `bash .claude/skills/error-guard/scripts/check.sh <file>` by hand.
- **`git push` to `main` is not blocked by any hook** — under Codex or Claude.
  deploy-guard covers deploys, not git. Rule 1 of `AGENTS.md` is discipline.
  (A `pre-push` git hook could make this physical for every agent and human at
  once; not wired today.)
- **Git worktrees:** project-level `.codex/hooks.json` has been reported ignored
  when Codex runs inside a worktree (upstream openai/codex#27133). Verify with
  `/hooks` if you work in one.
- **Windows:** Codex hooks are not supported there, and the committed symlinks may
  not materialize. Use WSL.
- **Hook commands resolve the repo root** via `git rev-parse --show-toplevel`, so
  they work from any clone with no machine-specific paths.

## Maintaining this

Change hook behaviour in `.claude/hooks/` — both agents inherit it. Only change
`.codex/hooks.json` when adding, removing, or re-matching a hook. `AGENTS.md` and
`CLAUDE.md` must be updated together when a rule changes.

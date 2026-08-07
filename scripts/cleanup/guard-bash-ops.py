#!/usr/bin/env python3
"""PreToolUse hook (Bash) for the cleanup-executor subagent.

WHY THIS EXISTS. The Edit/Write guard cannot see a shell command, and a dead-file batch
deletes files with `rm` — so without this hook the single most destructive operation in the
cleanup workflow is the one the scope guard never inspects.

DENY BY DEFAULT — and that is the second version of this file. The first enumerated
*mutating* verbs and allowed everything else, which a live adversarial probe took apart in
minutes: `node -e "fs.unlinkSync(...)"`, `python3 -c`, `python3 - <<EOF`, `node --eval`,
`git -C <dir> commit` (the dir was parsed as the subcommand), `1> file` and `2> file` (the
redirect regex skipped numbered fds on purpose, to let `2>&1` through), `bash -c "rm ..."`,
`sh script.sh`, `ex -sc wq file`. Enumerating ways to write to a disk is a game you lose.
So: a command runs only if every segment's verb is on the read-only allowlist or matches a
sanctioned pattern below. Anything unrecognized is refused with an explanation, and the
refusal names what to do instead.

Sanctioned writes, each path-checked through the SAME decision function the Edit guard uses
(scripts/cleanup/lib-path-verdict.sh — one rule set, two surfaces):
  rm / mv / cp / touch / mkdir / sed -i   → every operand checked
  any redirection, including 1> and 2>    → target checked
  pnpm remove --filter <twyst workspace>  → the one dependency path
  pnpm lint|test|build|exec|install|dlx   → the gate itself, never policed
  node scripts/<repo tooling>             → the two audits the executor self-checks with

exit 0 = allow, exit 2 = block with the reason on stderr (agent-facing).
Self-test: bash scripts/cleanup/guard-protected-paths.test.sh
"""

import json
import os
import re
import shlex
import subprocess
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
).stdout.strip()

# Verbs that only read. A cleanup executor investigates with these and nothing else.
READ_ONLY = {
    "grep", "rg", "egrep", "fgrep", "cat", "head", "tail", "ls", "wc", "sort", "uniq",
    "cut", "paste", "join", "comm", "diff", "file", "stat", "basename", "dirname",
    "echo", "printf", "jq", "tr", "nl", "od", "xxd", "strings", "md5sum", "sha1sum",
    "sha256sum", "shasum", "cksum", "du", "df", "realpath", "readlink", "pwd", "cd",
    "test", "true", "false", "which", "type", "date", "seq", "expr", "tee_disabled",
    "column", "fold", "rev", "less", "more", "awk", "sed", "node", "pnpm", "git", "find",
}
# Writers whose operands get path-checked.
CHECKED_MUTATORS = {"rm", "unlink", "rmdir", "mv", "cp", "ln", "touch", "mkdir", "rename"}
# git subcommands that only read.
GIT_READ = {
    "status", "log", "diff", "show", "ls-files", "ls-tree", "rev-parse", "cat-file",
    "blame", "describe", "shortlog", "grep", "config", "remote", "tag", "for-each-ref",
    "merge-base", "name-rev", "symbolic-ref", "count-objects", "verify-pack", "branch",
}
# The sanctioned pnpm workspace filters come from the ACTIVE app's env file (CLEANUP_APP
# selects it; guards and env agree by construction). Fail-closed: if the env refuses to
# load (unknown app, missing file), the set is empty and every dependency change is
# blocked — an unresolvable scope must never widen to "anything goes".
def _sanctioned_pnpm_filters() -> set:
    out = subprocess.run(
        ["bash", "-c",
         '. "$1/scripts/cleanup/cleanup-env.sh" && '
         'printf "%s\\n%s\\n" "$CLEANUP_SPA_FILTER" "$CLEANUP_SRV_FILTER"',
         "_", ROOT],
        capture_output=True, text=True, env=dict(os.environ),
    )
    if out.returncode != 0:
        return set()
    return {f.strip() for f in out.stdout.splitlines() if f.strip()}


SANCTIONED_PNPM_FILTERS = _sanctioned_pnpm_filters()
PNPM_OK = {"lint", "test", "build", "exec", "install", "dlx", "run", "--filter", "-r"}
EVAL_FLAGS = {"-e", "--eval", "-p", "--print", "-c", "-"}
UNRESOLVABLE = re.compile(r"[*?\[]|\$\(|`|\$\{|\$[A-Za-z_]")
SAFE_REDIRECT = {"/dev/null", "/dev/stderr", "/dev/stdout", "/dev/tty"}


def block(reason: str) -> None:
    print(f"Blocked by the cleanup guard: {reason}", file=sys.stderr)
    sys.exit(2)


def verdict(path: str) -> str:
    out = subprocess.run(
        ["bash", "-c",
         '. "$1/scripts/cleanup/cleanup-env.sh"; . "$1/scripts/cleanup/lib-path-verdict.sh"; '
         'ROOT="$1" cleanup_path_verdict "$2"',
         "_", ROOT, path],
        capture_output=True, text=True, env={**os.environ, "ROOT": ROOT},
    )
    return out.stdout.strip() or "BLOCK|the path decision function produced no verdict"


def check_path(path: str, op: str) -> None:
    if UNRESOLVABLE.search(path):
        block(f"`{op}` targets '{path}', which cannot be resolved statically (glob, variable "
              f"or command substitution). A cleanup batch acts on a KNOWN list of files — "
              f"pass one explicit path per command.")
    v = verdict(path)
    if v != "ALLOW":
        block(f"`{op}` would touch a protected path. {v.split('|', 1)[-1]}")


def segments(command: str):
    # Deliberately NOT splitting on a lone `&`: an earlier version did, and it cut `2>&1`
    # in half, leaving a segment that was just `1` — which then looked like an unknown
    # command and got refused. Background execution is not something a cleanup batch needs,
    # and a trailing `&` leaves the verb intact, so the checks below still see it.
    return [s for s in re.split(r"\|\||&&|;|\||\n", command) if s.strip()]


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command.strip():
        sys.exit(0)

    for seg in segments(command):
        # --- Redirections FIRST, including numbered fds. `1> file` and `2> file` write just
        # as well as `> file`; only fd-duplications (>&1) and the null sinks are exempt.
        for m in re.finditer(r"(\d*)>{1,2}\s*(&?[^\s;|&]+)", seg):
            target = m.group(2).strip("\"'")
            if target.startswith("&") or target in SAFE_REDIRECT:
                continue
            check_path(target, "shell redirection")

        try:
            words = shlex.split(seg, comments=True)
        except ValueError:
            block("the command could not be parsed (unbalanced quotes). Re-issue it as a "
                  "simple, quoted command — this guard refuses what it cannot read.")
        if not words:
            continue

        i = 0
        while i < len(words) and "=" in words[i] and not words[i].startswith("-"):
            i += 1
        if i >= len(words):
            continue
        verb = os.path.basename(words[i])
        rest = words[i + 1:]

        # --- Deny by default. Everything below is a narrowing of an already-allowed verb.
        if verb in CHECKED_MUTATORS:
            for t in [w for w in rest if not w.startswith("-")]:
                check_path(t, verb)
            continue

        if verb not in READ_ONLY:
            block(f"`{verb}` is not on the cleanup executor's allowlist. This guard denies by "
                  f"default: a shell that can reach an interpreter (`node -e`, `python3 -c`, "
                  f"`bash -c`), an editor (`ex`, `vi`, `ed`), or a byte mover (`tee`, `dd`) can "
                  f"write anywhere, which would make the scope guard decorative. Use Read/Edit "
                  f"for file work, `rm <explicit path>` to delete, and the gate commands to "
                  f"verify. If you genuinely need this command, stop and report it.")

        # --- Narrowings for the powerful verbs that ARE on the allowlist.
        if verb in ("sed", "awk", "perl", "ruby"):
            inplace = [a for a in rest if a == "-i" or a.startswith("-i") and len(a) > 2
                       or a == "--in-place"]
            if inplace:
                # First non-flag operand is the script/expression, not a path.
                operands = [w for w in rest if not w.startswith("-")]
                for w in operands[1:]:
                    check_path(w, f"{verb} in-place edit")
            continue

        if verb == "node":
            if any(a in EVAL_FLAGS for a in rest) or not rest:
                block("`node` with an inline script (-e/--eval/-p/--print) or reading stdin can "
                      "write any file on disk, so it is refused. The executor's self-check runs "
                      "`node scripts/error-wiring-audit.mjs` and `node scripts/lib/eager-graph.mjs`.")
            script = next((w for w in rest if not w.startswith("-")), "")
            if not script.startswith("scripts/"):
                block(f"`node {script}` is refused — only repo tooling under scripts/ may be run "
                      f"(the wiring audit and the eager-import audit). An arbitrary script can "
                      f"write anywhere.")
            continue

        if verb == "git":
            # Find the subcommand properly: skip global flags AND their values, so
            # `git -C <dir> commit` cannot smuggle a write past a naive first-word check.
            sub, j = "", 0
            while j < len(rest):
                w = rest[j]
                if w in ("-C", "-c", "--git-dir", "--work-tree", "--namespace",
                         "--exec-path", "--config-env"):
                    j += 2
                    continue
                if w.startswith("-"):
                    j += 1
                    continue
                sub = w
                break
            if sub not in GIT_READ:
                block(f"`git {sub or '(no subcommand found)'}` is refused for a cleanup executor. "
                      f"Only read subcommands are allowed ({', '.join(sorted(GIT_READ))[:80]}…). "
                      f"Committing, reverting and cleaning the tree belong to the workflow's "
                      f"finalize step, which is a different agent. Use `rm <path>` to delete.")
            continue

        if verb == "pnpm":
            if any(a in ("remove", "uninstall", "add") for a in rest):
                allowed = ", ".join(sorted(SANCTIONED_PNPM_FILTERS)) or "(none — the cleanup env failed to load)"
                if "--filter" not in rest:
                    block(f"a dependency change must name its workspace: "
                          f"`pnpm remove --filter \"<workspace>\" <pkg>` — sanctioned: {allowed}.")
                f = rest[rest.index("--filter") + 1] if rest.index("--filter") + 1 < len(rest) else ""
                if f.strip("\"'") not in SANCTIONED_PNPM_FILTERS:
                    block(f"`--filter {f}` is outside this cleanup's scope. Sanctioned: {allowed}.")
                continue
            if not any(a in PNPM_OK for a in rest):
                block(f"`pnpm {' '.join(rest[:2])}` is not one of the sanctioned forms "
                      f"(lint/test/build/exec/install/dlx/run, or remove --filter).")
            continue

        if verb == "find":
            if "-delete" in rest or "-exec" in rest or "-execdir" in rest or "-ok" in rest:
                block("`find -delete` / `-exec` cannot be checked path by path, so it is refused. "
                      "Delete the files the batch names, one explicit `rm <path>` each.")
            continue

    sys.exit(0)


if __name__ == "__main__":
    main()

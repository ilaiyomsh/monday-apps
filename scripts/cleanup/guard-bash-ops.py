#!/usr/bin/env python3
"""PreToolUse hook (Bash) for the cleanup-executor subagent.

WHY THIS EXISTS. The Edit/Write guard cannot see a shell command, and a dead-file batch
deletes files with `rm` — so until this hook was added, the single most destructive
operation in the whole cleanup workflow was the one operation the scope guard never
inspected. Found by a pre-approval refutation pass, not by a test, which is exactly the
class of hole that looks identical to a guard that passed.

WHAT IT DOES. Parses the command, finds every file-MUTATING operation, and runs each target
path through the same decision function the Edit guard uses
(scripts/cleanup/lib-path-verdict.sh — one source of truth, no drift). Read-only commands
are untouched: this hook polices writes, not curiosity.

Fails closed on anything it cannot resolve statically (globs, variables, command
substitution, xargs, find -exec/-delete): a cleanup deletes a known list of files, one
explicit path at a time, so an unresolvable destructive target is never legitimate here.

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

# Verbs that change files on disk. `mkdir`/`touch`/`chmod` are here not because they are
# dangerous but because a cleanup has no business creating or re-permissioning anything
# outside the app it is scoped to.
MUTATING = {
    "rm", "unlink", "rmdir", "mv", "cp", "ln", "touch", "mkdir", "truncate",
    "shred", "tee", "dd", "install", "chmod", "chown", "rename",
}
# In-place editors: only mutating with an in-place flag.
INPLACE = {"sed": ("-i", "--in-place"), "perl": ("-i",), "ruby": ("-i",), "python": ("-i",)}
# git subcommands that write to the working tree or history. The executor never commits or
# reverts — the workflow's finalize step does, as a different agent with different hooks.
GIT_WRITE = {
    "rm", "mv", "checkout", "restore", "clean", "reset", "stash", "apply", "commit",
    "revert", "merge", "rebase", "cherry-pick", "switch", "push", "am",
}
UNRESOLVABLE = re.compile(r"[*?\[]|\$\(|`|\$\{|\$[A-Za-z_]")
SAFE_REDIRECT_TARGETS = {"/dev/null", "/dev/stderr", "/dev/stdout", "/dev/tty"}
SANCTIONED_PNPM_FILTERS = {"./apps/twyst-your-status", "./apps/twyst-your-status/server"}


def block(reason: str) -> "None":
    print(f"Blocked by the cleanup guard: {reason}", file=sys.stderr)
    sys.exit(2)


def verdict(path: str) -> str:
    """Delegate to the shared bash decision function — one rule set, two hook surfaces."""
    out = subprocess.run(
        ["bash", "-c",
         '. "$1/scripts/cleanup/cleanup-env.sh"; . "$1/scripts/cleanup/lib-path-verdict.sh"; '
         'ROOT="$1" cleanup_path_verdict "$2"',
         "_", ROOT, path],
        capture_output=True, text=True, env={**os.environ, "ROOT": ROOT},
    )
    return out.stdout.strip() or "BLOCK|the path decision function produced no verdict"


def check_path(path: str, op: str) -> "None":
    if UNRESOLVABLE.search(path):
        block(
            f"`{op}` targets '{path}', which this guard cannot resolve statically (glob, "
            f"variable or command substitution). A cleanup batch deletes a KNOWN list of "
            f"files — pass one explicit path per command instead."
        )
    v = verdict(path)
    if v != "ALLOW":
        block(f"`{op}` would touch a protected path. {v.split('|', 1)[-1]}")


def segments(command: str):
    """Split on shell operators. Deliberately crude: over-splitting only costs extra
    checks, while missing a separator would hide a mutating verb."""
    return [s for s in re.split(r"\|\||&&|;|\||\n|&(?!>)", command) if s.strip()]


def main() -> "None":
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # not our business to fail on a malformed payload
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command.strip():
        sys.exit(0)

    for seg in segments(command):
        # --- redirections anywhere in the segment (echo x > file, cmd >> file)
        for target in re.findall(r"(?<![0-9&])>{1,2}\s*([^\s;|&]+)", seg):
            t = target.strip("\"'")
            if t.startswith("&") or t in SAFE_REDIRECT_TARGETS:
                continue
            check_path(t, "shell redirection")

        try:
            words = shlex.split(seg, comments=True)
        except ValueError:
            # Unbalanced quotes — cannot reason about it. Only fail closed if a mutating
            # verb is even plausibly present; otherwise a stray quote in a grep pattern
            # would break ordinary work.
            if any(v in seg.split() for v in MUTATING) or "git " in seg:
                block("the command could not be parsed (unbalanced quotes) and mentions a "
                      "file-mutating verb. Re-issue it as a simple, quoted command.")
            continue
        if not words:
            continue

        # skip leading env assignments and common wrappers
        i = 0
        while i < len(words) and ("=" in words[i] and not words[i].startswith("-")):
            i += 1
        while i < len(words) and words[i] in ("sudo", "command", "env", "time", "nohup"):
            i += 1
        if i >= len(words):
            continue
        verb = os.path.basename(words[i])
        rest = words[i + 1:]

        if verb in ("xargs", "find") or "-delete" in rest or "-exec" in rest:
            if verb == "xargs" or "-delete" in rest or ("-exec" in rest and any(
                    os.path.basename(w) in MUTATING for w in rest)):
                block(
                    "`find -delete` / `-exec <mutating>` / `xargs` cannot be checked path by "
                    "path, so it is refused during cleanup. Delete or move the files the "
                    "batch names, one explicit command per path."
                )

        if verb == "git":
            sub = next((w for w in rest if not w.startswith("-")), "")
            if sub in GIT_WRITE:
                block(
                    f"`git {sub}` is refused for a cleanup executor. Committing, reverting and "
                    f"cleaning the tree belong to the workflow's finalize step, not to a batch: "
                    f"the batch's job is to leave exactly its own edits in the working tree. "
                    f"Use plain `rm <path>` to delete a file the batch names."
                )
            continue

        if verb in ("npm", "yarn"):
            block("this repo is pnpm-only (tracker's postinstall needs pnpm, and CI runs "
                  "--frozen-lockfile). Never npm/yarn.")

        if verb == "pnpm":
            if "remove" in rest or "uninstall" in rest or "add" in rest:
                if "--filter" not in rest:
                    block("a dependency change must name its workspace: "
                          "`pnpm remove --filter \"./apps/twyst-your-status\" <pkg>` (or the "
                          "server workspace). An unfiltered pnpm remove hits the root workspace.")
                f = rest[rest.index("--filter") + 1] if rest.index("--filter") + 1 < len(rest) else ""
                if f.strip("\"'") not in SANCTIONED_PNPM_FILTERS:
                    block(f"`--filter {f}` is outside this cleanup's scope. Only "
                          f"./apps/twyst-your-status and ./apps/twyst-your-status/server may be "
                          f"changed.")
            continue  # lint/test/build/exec are the gate itself — never policed

        if verb in INPLACE:
            if any(a in rest for a in INPLACE[verb]) or any(
                    a.startswith("-i") and len(a) > 2 for a in rest):
                # The FIRST non-flag argument is the script/expression, not a path —
                # `sed -i 's/a/b/' file` would otherwise have its own substitution command
                # checked as a path and blocked with a nonsensical reason. Drop it, check
                # the rest. Extra expressions (multiple -e) fall through as paths and fail
                # closed, which is the correct direction for an in-place editor.
                operands = [w for w in rest if not w.startswith("-")]
                for w in operands[1:]:
                    check_path(w, f"{verb} in-place edit")
            continue

        if verb in MUTATING:
            targets = [w for w in rest if not w.startswith("-")]
            if not targets:
                continue
            for t in targets:
                check_path(t, verb)

    sys.exit(0)


if __name__ == "__main__":
    main()

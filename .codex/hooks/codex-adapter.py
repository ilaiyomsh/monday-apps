#!/usr/bin/env python3
"""codex-adapter.py — run this repo's Claude Code hooks under OpenAI Codex.

WHY THIS EXISTS
    The enforcement hooks in .claude/hooks/ (deploy-guard, error-guard, test-guard,
    the GraphQL reminder) are the physical layer behind CLAUDE.md's golden rules.
    Codex's hook engine speaks almost the same protocol — same stdin JSON keys
    (tool_name / tool_input / cwd), same "exit 2 + stderr blocks the call", same
    permissionDecision JSON — but it names its tools differently and shapes their
    inputs differently:

        Codex                                   Claude Code
        tool_name "shell"                       "Bash"
        tool_input.command = ["bash","-lc",S]   tool_input.command = "<string>"
        tool_name "apply_patch" (N files)       "Write"/"Edit" (one file per call)

    Feeding a Codex payload straight into those scripts does NOT error — every one
    of them starts with `if tool_name != "Bash"/"Write"...: exit 0`. They would
    fail open, silently, while looking perfectly wired. That is the exact failure
    this adapter prevents.

    It normalizes, then DELEGATES to the real hook script. The enforcement logic
    stays single-sourced in .claude/hooks/ — there is no forked Codex copy to
    drift out of sync.

USAGE (from .codex/hooks.json)
    codex-adapter.py [--emit] [--timeout SECS] <delegate>
        <delegate>  hook script to run, absolute or repo-root-relative.
        --emit      print the normalized payload(s) as JSONL and exit; used by the
                    test suite to pin the translation without side effects.

TRANSLATION RULES
    tool_name absent (Stop, SessionStart, ...) -> payload passed through untouched.
    Shell tools        -> one "Bash" payload; ["bash","-lc",S] reduces to S, other
                          argv arrays are shlex-joined.
    Patch/edit tools   -> one payload per touched file: Add File -> "Write",
                          Update/Delete File -> "Edit", with tool_input.content
                          carrying only the ADDED lines.
    Anything else      -> dropped (no delegate run).

RESULT TRANSLATION
    delegate exit 2      -> exit 2, stderr forwarded (blocks the call in Codex too)
    delegate deny JSON   -> forwarded on stdout (Codex acts on permissionDecision "deny")
    any other exit code  -> exit 0 (exit 1 is non-blocking by Claude convention)
    multi-file fan-out   -> one blocked file blocks the whole call

FAIL-OPEN: every internal error exits 0 so a broken adapter can never wedge a
session — but it always says so on stderr. A silent adapter is the thing we are
guarding against, so nothing here is swallowed quietly.
"""

import json
import os
import re
import shlex
import subprocess
import sys

# .codex/hooks/codex-adapter.py -> .codex/hooks -> .codex -> repo root
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_TIMEOUT = 30

# Codex's shell tool has been named several things across versions; accept them
# all, plus Claude's own name so one hooks.json works under either agent.
SHELL_TOOLS = {
    "shell", "local_shell", "exec_command", "run_command", "bash", "Bash",
    "container.exec", "shell_command",
}

# apply_patch is the canonical Codex tool_name for every file edit; Edit/Write are
# accepted matcher aliases that may also arrive as the reported name.
PATCH_TOOLS = {
    "apply_patch", "Edit", "Write", "MultiEdit", "str_replace_editor", "edit_file",
}

PATCH_MARKERS = ("*** Begin Patch", "*** Update File:", "*** Add File:", "*** Delete File:")
FILE_RE = re.compile(r"^\*\*\*\s+(Add|Update|Delete)\s+File:\s*(.+?)\s*$")
MOVE_RE = re.compile(r"^\*\*\*\s+Move\s+to:\s*(.+?)\s*$")


def log(msg):
    sys.stderr.write("codex-adapter: %s\n" % msg)


# --------------------------------------------------------------- shell payloads

def normalize_command(tool_input):
    """Reduce Codex's command shape to the single string Claude's hooks expect.

    ["bash","-lc","mapps code:push"] must become "mapps code:push", NOT
    "bash -lc 'mapps code:push'": deploy-guard anchors its patterns to a command
    position (start of string or after a shell separator), so a wrapped form
    would slip past the guard entirely.
    """
    cmd = tool_input.get("command")
    if cmd is None:
        for key in ("script", "cmd", "commands", "input"):
            if key in tool_input:
                cmd = tool_input[key]
                break

    if isinstance(cmd, str):
        return cmd

    if isinstance(cmd, (list, tuple)):
        parts = [str(p) for p in cmd]
        if not parts:
            return ""
        # `sh -c SCRIPT`, `bash -lc SCRIPT`, `zsh -ic SCRIPT`, ...
        if (
            len(parts) >= 3
            and os.path.basename(parts[0]) in ("sh", "bash", "zsh", "dash", "ksh")
            and parts[1].startswith("-")
            and "c" in parts[1]
        ):
            return parts[2]
        return shlex.join(parts)

    return ""


# --------------------------------------------------------------- patch payloads

def find_patch_text(tool_input):
    """Locate the patch envelope regardless of which key carries it.

    The key has moved between Codex versions (and a known runtime bug hands hooks
    an unrecognized shape), so preferred keys are tried first and then every
    string in the payload is scanned for the envelope markers.
    """
    for key in ("input", "patch", "diff", "content", "text", "arguments"):
        value = tool_input.get(key)
        if isinstance(value, str) and any(m in value for m in PATCH_MARKERS):
            return value

    stack = [tool_input]
    while stack:
        current = stack.pop()
        if isinstance(current, str):
            if any(m in current for m in PATCH_MARKERS):
                return current
        elif isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, (list, tuple)):
            stack.extend(current)
    return None


def parse_patch(text):
    """Split a patch envelope into [{op, paths, added}] sections."""
    sections = []
    current = None
    for line in text.splitlines():
        match = FILE_RE.match(line)
        if match:
            current = {"op": match.group(1), "paths": [match.group(2)], "added": []}
            sections.append(current)
            continue

        moved = MOVE_RE.match(line)
        if moved and current is not None:
            current["paths"].append(moved.group(1))
            continue

        if current is None:
            continue
        # Added lines only: context and removed lines were never written, and
        # reporting them as content would make the content-scanning hooks
        # (GraphQL reminder, error-guard) fire on code that is being deleted.
        if line.startswith("+") and not line.startswith("+++"):
            current["added"].append(line[1:])
    return sections


def payloads_for_patch(payload, text, cwd):
    out = []
    for section in parse_patch(text):
        content = "\n".join(section["added"])
        tool_name = "Write" if section["op"] == "Add" else "Edit"
        for path in section["paths"]:
            file_path = path if os.path.isabs(path) else os.path.join(cwd, path)
            out.append(dict(
                payload,
                tool_name=tool_name,
                tool_input={"file_path": file_path, "content": content},
            ))
    return out


# ------------------------------------------------------------------ normalizing

def normalize(payload):
    """Codex payload -> list of Claude-shaped payloads (possibly empty)."""
    tool_name = payload.get("tool_name") or ""
    cwd = payload.get("cwd") or REPO_ROOT

    # Non-tool events (Stop, SessionStart, UserPromptSubmit) carry no tool_name;
    # their hooks read cwd/session_id only, so pass them through as-is.
    if not tool_name:
        return [payload]

    if tool_name in SHELL_TOOLS:
        return [dict(
            payload,
            tool_name="Bash",
            tool_input={"command": normalize_command(payload.get("tool_input") or {})},
        )]

    if tool_name in PATCH_TOOLS:
        tool_input = payload.get("tool_input") or {}
        text = find_patch_text(tool_input)
        if text:
            return payloads_for_patch(payload, text, cwd)
        # Already Claude-shaped (a plain file_path/content edit): keep it, only
        # settling the tool_name to something the delegates dispatch on.
        file_path = tool_input.get("file_path") or tool_input.get("path")
        if file_path:
            settled = "Write" if tool_name == "Write" else "Edit"
            return [dict(payload, tool_name=settled)]
        log("tool_name=%s carried no patch text and no file_path; skipping" % tool_name)
        return []

    return []


# ------------------------------------------------------------------- delegating

def delegate_argv(path):
    """Invoke via an explicit interpreter so a lost exec bit cannot break a guard."""
    try:
        with open(path, "rb") as handle:
            first = handle.readline(256).decode("utf-8", "replace")
    except OSError as exc:
        log("cannot read delegate %s: %s" % (path, exc))
        return None
    if first.startswith("#!") and "python" in first:
        return [sys.executable, path]
    return ["bash", path]


def run_delegate(path, payload, timeout):
    """Run one delegate. Returns (returncode, stdout, stderr); rc None on failure."""
    argv = delegate_argv(path)
    if argv is None:
        return None, "", ""

    env = dict(os.environ)
    # The hooks resolve repo-relative paths through this variable; Codex has no
    # equivalent of its own, so the adapter supplies it.
    env["CLAUDE_PROJECT_DIR"] = REPO_ROOT

    cwd = payload.get("cwd") or REPO_ROOT
    if not os.path.isdir(cwd):
        cwd = REPO_ROOT

    try:
        proc = subprocess.run(
            argv,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            cwd=cwd,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        log("delegate %s timed out after %ss; allowing the call" % (path, timeout))
        return None, "", ""
    except OSError as exc:
        log("delegate %s failed to start: %s" % (path, exc))
        return None, "", ""

    return proc.returncode, proc.stdout or "", proc.stderr or ""


def is_deny(stdout):
    if "permissionDecision" not in stdout and "decision" not in stdout:
        return False
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except ValueError:
            continue
        specific = data.get("hookSpecificOutput") or {}
        if specific.get("permissionDecision") == "deny" or data.get("decision") == "block":
            return True
    return False


# -------------------------------------------------------------------------- main

def main(argv):
    emit = False
    timeout = DEFAULT_TIMEOUT
    delegate = None

    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--emit":
            emit = True
        elif arg == "--timeout":
            index += 1
            timeout = int(argv[index])
        elif delegate is None:
            delegate = arg
        index += 1

    raw = sys.stdin.read()
    if not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except ValueError as exc:
        log("unparseable stdin (%s); allowing the call" % exc)
        return 0
    if not isinstance(payload, dict):
        log("stdin was not a JSON object; allowing the call")
        return 0

    payloads = normalize(payload)

    if emit:
        for item in payloads:
            sys.stdout.write(json.dumps(item) + "\n")
        return 0

    if not payloads:
        return 0

    if not delegate:
        log("no delegate given; nothing to run")
        return 0

    path = delegate if os.path.isabs(delegate) else os.path.join(REPO_ROOT, delegate)
    if not os.path.isfile(path):
        log("delegate not found: %s; allowing the call" % path)
        return 0

    blocked = False
    stderr_parts = []
    for item in payloads:
        code, out, err = run_delegate(path, item, timeout)
        if out:
            sys.stdout.write(out if out.endswith("\n") else out + "\n")
        if code == 2:
            blocked = True
            if err:
                stderr_parts.append(err)
        elif is_deny(out):
            # Already forwarded on stdout; Codex acts on it without exit 2.
            blocked = False
        elif err:
            # A non-blocking delegate still gets its message surfaced.
            stderr_parts.append(err)

    if stderr_parts:
        sys.stderr.write("\n".join(part.rstrip("\n") for part in stderr_parts) + "\n")

    return 2 if blocked else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - fail open, but never silently
        log("internal error (%s: %s); allowing the call" % (type(exc).__name__, exc))
        sys.exit(0)

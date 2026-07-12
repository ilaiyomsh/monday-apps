#!/usr/bin/env python3
"""
PreToolUse hook (matcher: Bash) — monorepo variant.

Blocks ANY local deploy/push command. In this monorepo, deploys happen ONLY on
GitHub Actions runners: merge to develop -> latest draft, merge to main ->
latest live. A local `mapps code:push` (or `npm run deploy` / `pnpm run deploy`
/ `pnpm deploy`) is always a violation — there is no ship.sh escape hatch here
(ship.sh serves standalone apps outside the monorepo). See CLAUDE.md and the
monday-cicd skill.

Reads the tool call JSON on stdin ({"tool_name": "Bash", "tool_input": {"command": "..."}}).
Exit 2 + stderr message blocks the tool call. Exit 0 allows it.
"""
import json
import re
import sys


def _deploy_script_uses_mapps(command, payload):
    """True when the project whose deploy script would run pushes via mapps.

    Resolves the project dir from an explicit `cd <abspath>` in the command,
    else the hook payload's cwd; walks up to the nearest package.json and
    checks whether any deploy* script (or a script it chains) mentions mapps
    or code:push. Unreadable/missing package.json blocks (conservative).
    """
    import os

    m = re.search(r"(?:^|[;&|]\s*)cd\s+(/[^\s;&|]+)", command)
    start = m.group(1) if m else (payload.get("cwd") or os.getcwd())
    d = start
    for _ in range(8):
        pj = os.path.join(d, "package.json")
        if os.path.isfile(pj):
            try:
                with open(pj) as f:
                    scripts = json.load(f).get("scripts", {})
            except (OSError, json.JSONDecodeError, ValueError):
                return True
            chain = " ".join(v for k, v in scripts.items() if k.startswith("deploy"))
            return ("mapps" in chain) or ("code:push" in chain)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return True


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        # Can't parse -> don't block on our own error.
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    if tool_name != "Bash":
        sys.exit(0)

    command = (payload.get("tool_input") or {}).get("command", "") or ""

    # Strip quoted segments first: deploy commands mentioned inside quotes
    # (grep patterns, echo strings, commit messages) are not invocations.
    # A real deploy invocation is never fully quoted.
    stripped = re.sub(r"'[^']*'", "''", command)
    stripped = re.sub(r'"[^"]*"', '""', stripped)

    # Anchor to a command position: start of line/command, or after a shell
    # separator (;, &&, ||, |, $(, backtick, newline) — not mid-string.
    CMD_POS = r"(?:^|[;&|`\n(]|\$\()\s*(?:sudo\s+|env\s+\S+=\S+\s+)*"
    direct_push = re.search(CMD_POS + r"mapps\s+code:push\b", stripped)
    script_deploy = re.search(
        CMD_POS + r"(?:npm\s+run\s+deploy|pnpm\s+run\s+deploy|pnpm\s+deploy)\b", stripped
    )

    # Running ship.sh is itself a deploy: it wraps code:push internally, out of
    # this hook's sight. In the monorepo it is forbidden like any local push.
    # Matches execution forms only (direct path or via an interpreter), not
    # mere mentions like `grep ship.sh`.
    ship_invocation = re.search(
        CMD_POS + r"(?:(?:bash|sh|zsh|source)\s+)?(?:\S*/)?ship\.sh\b", stripped
    )

    # `npm/pnpm run deploy` is only a monday-code deploy if the project's
    # deploy scripts actually invoke mapps/code:push. Apps hosted externally
    # (e.g. gh-pages) have legitimate deploy scripts that must not be blocked.
    if script_deploy and not direct_push:
        script_deploy = _deploy_script_uses_mapps(command, payload)

    if direct_push or script_deploy or ship_invocation:
        sys.stderr.write(
            "BLOCKED: deploys in this monorepo happen ONLY on GitHub Actions "
            "(merge to develop -> draft, merge to main -> live). Never push from "
            "a machine — including via ship.sh. Open a PR instead; see CLAUDE.md "
            "'Deploys — pipeline only' and the monday-cicd skill.\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()

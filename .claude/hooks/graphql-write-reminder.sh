#!/usr/bin/env python3
"""
PostToolUse hook (matcher: Write|Edit). Monorepo variant.

Reminds the model that the monday-api skill's VALIDATE (live schema /
column-type lookup) and TEST (scratch-board probe) steps are mandatory
before commit, whenever app source code is written/edited containing
monday.com GraphQL operations.

The repo root is derived from this script's own location (.claude/hooks/),
so the hook works from any clone, including cloud sessions.

Fast, offline, no network calls. Reads the tool call JSON on stdin:
{"tool_name": "Write"|"Edit", "tool_input": {"file_path": "...", "content": "...", ...}}

Exit 2 + stderr message surfaces the reminder to the model. Exit 0 is silent.
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLAUDE_DIR_MARKER = "/.claude/"

SOURCE_EXT_RE = re.compile(r"\.(js|ts|jsx|tsx)$")

GRAPHQL_OP_RE = re.compile(r"\b(query|mutation)\b")

GRAPHQL_FIELD_MARKERS = (
    "column_values",
    "board_relation",
    "items_page",
    "change_multiple_column_values",
    "create_item",
)


def extract_content(tool_input):
    # Write: {"file_path": ..., "content": ...}
    # Edit: {"file_path": ..., "old_string": ..., "new_string": ...} (single edit)
    #       or {"file_path": ..., "edits": [{"old_string":..., "new_string":...}, ...]}
    parts = []
    if "content" in tool_input:
        parts.append(tool_input.get("content") or "")
    if "new_string" in tool_input:
        parts.append(tool_input.get("new_string") or "")
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and "new_string" in e:
                parts.append(e.get("new_string") or "")
    return "\n".join(parts)


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path", "") or ""

    if not file_path:
        sys.exit(0)

    # Must be app source under the repo root, not under any .claude/ dir.
    if not file_path.startswith(REPO_ROOT):
        sys.exit(0)
    if CLAUDE_DIR_MARKER in file_path:
        sys.exit(0)
    if not SOURCE_EXT_RE.search(file_path):
        sys.exit(0)

    content = extract_content(tool_input)
    if not content:
        sys.exit(0)

    has_graphql_op = bool(GRAPHQL_OP_RE.search(content))
    has_field_marker = any(marker in content for marker in GRAPHQL_FIELD_MARKERS)

    if has_graphql_op and has_field_marker:
        sys.stderr.write(
            "REMINDER: this file writes monday.com GraphQL (query/mutation touching "
            "column_values / board_relation / items_page / change_multiple_column_values / "
            "create_item). Before committing: (1) VALIDATE against the live schema / "
            "column-type lookup via the monday-api skill, (2) TEST against a scratch board "
            "in the sandbox workspace, and (3) run `/monday-api check " + file_path + "` "
            "and make sure it passes.\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()

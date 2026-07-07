#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <role> <task> <status>"
  exit 1
fi

ROLE="$1"
TASK="$2"
STATUS="$3"
FILE="${ANALYSIS_FILE:-tech-debt/ANALYSIS.md}"
STAMP="$(date '+%Y-%m-%d %H:%M')"
SECTION="## Agent Progress Log"
ENTRY="- [${STAMP}] [${ROLE}] [${TASK}] — ${STATUS}"

python3 - "$FILE" "$SECTION" "$ENTRY" <<'PY'
from pathlib import Path
import sys

file_path = Path(sys.argv[1])
section = sys.argv[2]
entry = sys.argv[3]

if not file_path.exists():
    raise SystemExit(f"Missing file: {file_path}")

text = file_path.read_text(encoding="utf-8")

if section not in text:
    if not text.endswith("\n"):
        text += "\n"
    text += f"\n---\n\n{section}\n\n{entry}\n"
else:
    parts = text.split(section, 1)
    before = parts[0]
    after = parts[1]
    if after.startswith("\n\n"):
        after = after[2:]
    text = f"{before}{section}\n\n{entry}\n{after}"

file_path.write_text(text, encoding="utf-8")
PY

echo "Updated ${FILE}: ${ENTRY}"

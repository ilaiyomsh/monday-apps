#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"task description\" [--merge]"
  exit 1
fi

TASK="$1"
DO_MERGE="${2:-}"
ROLE="ReviewerMerger"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_SCRIPT="${ROOT_DIR}/scripts/analysis-progress.sh"
SUMMARY_SCRIPT="${ROOT_DIR}/scripts/generate-findings-table.py"
CLEAN_COMMAND="${AGENT_CLEAN_COMMAND:-/clear}"
if [[ "${CLEAN_COMMAND}" == "/clean" ]]; then
  CLEAN_COMMAND="/clear"
fi
OUTPUT_DIR="${ROOT_DIR}/tech-debt/agent-runs"
mkdir -p "${OUTPUT_DIR}"
RUN_ID="$(date '+%Y%m%d-%H%M%S')"

REVIEW_OUTPUT="${OUTPUT_DIR}/${RUN_ID}-review.txt"
FIX_OUTPUT="${OUTPUT_DIR}/${RUN_ID}-fix.txt"
VERIFY_OUTPUT="${OUTPUT_DIR}/${RUN_ID}-verify.txt"

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "תחילת עבודה"
bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "בדיקה"

claude -p "${CLEAN_COMMAND}
/pr-review-toolkit:review-pr
Task: ${TASK}
Review all current changes on this branch.
Output format:
1) Findings by severity with file references
2) Open questions
3) Decision: APPROVE or REQUEST_CHANGES
Do not modify files." > "${REVIEW_OUTPUT}"

if python3 - "$REVIEW_OUTPUT" <<'PY'
from pathlib import Path
import sys

review_text = Path(sys.argv[1]).read_text(encoding="utf-8")
if "Unknown command: /pr-review-toolkit:review-pr" in review_text:
    raise SystemExit(1)
raise SystemExit(0)
PY
then
  :
else
  claude -p "${CLEAN_COMMAND}
You are a strict code reviewer for this repository.
Task: ${TASK}
Review all current changes on this branch.
Output format:
1) Findings by severity with file references
2) Open questions
3) Decision: APPROVE or REQUEST_CHANGES
Do not modify files." > "${REVIEW_OUTPUT}"
fi

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום בדיקה"
bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "תיקון"

if python3 - "$REVIEW_OUTPUT" <<'PY'
from pathlib import Path
import sys

review_text = Path(sys.argv[1]).read_text(encoding="utf-8")
if "Decision: APPROVE" in review_text:
    raise SystemExit(0)
raise SystemExit(1)
PY
then
  printf '%s\n' "No fixes required. Review decision is APPROVE." > "${FIX_OUTPUT}"
else
  claude -p "${CLEAN_COMMAND}
You are the fix phase agent for this repository.
Task: ${TASK}
Read the review report and implement the requested fixes.
Review report path: ${REVIEW_OUTPUT}
Constraints:
- Apply only fixes required by the review findings.
- Keep scope tight.
- Run verification commands before finishing.
At the end, return a short report with files changed and verification results." > "${FIX_OUTPUT}"
fi

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום תיקון"

if [[ "${DO_MERGE}" == "--merge" ]]; then
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  BASE_BRANCH="${BASE_BRANCH:-chore/tech-debt-sweep}"

  if [[ "${CURRENT_BRANCH}" == "${BASE_BRANCH}" ]]; then
    echo "Cannot merge from base branch itself: ${BASE_BRANCH}"
    exit 1
  fi

  bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "אימות"
  if pnpm run test:run > "${VERIFY_OUTPUT}" 2>&1 && pnpm run build >> "${VERIFY_OUTPUT}" 2>&1; then
    bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום אימות"
  else
    bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "אימות נכשל"
    echo "Verification failed. Merge was blocked."
    echo "Verification output: ${VERIFY_OUTPUT}"
    exit 1
  fi

  git checkout "${BASE_BRANCH}"
  git pull
  git merge --no-ff "${CURRENT_BRANCH}"
  git branch -d "${CURRENT_BRANCH}" || true

  bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "מיזוג"
fi

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום משימה"
python3 "${SUMMARY_SCRIPT}" >/dev/null 2>&1 || true

echo "Review output: ${REVIEW_OUTPUT}"
echo "Fix output: ${FIX_OUTPUT}"
if [[ "${DO_MERGE}" == "--merge" ]]; then
  echo "Verification output: ${VERIFY_OUTPUT}"
fi

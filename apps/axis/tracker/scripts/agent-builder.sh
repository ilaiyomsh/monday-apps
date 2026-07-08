#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"task description\""
  exit 1
fi

TASK="$1"
ROLE="Builder"
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

PLAN_OUTPUT="${OUTPUT_DIR}/${RUN_ID}-plan.txt"
BUILD_OUTPUT="${OUTPUT_DIR}/${RUN_ID}-build.txt"

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "תחילת עבודה"

claude -p "${CLEAN_COMMAND}
You are the planning phase agent for this repository.
Task: ${TASK}
Return:
1) Scope
2) Out of scope
3) Files likely to change
4) Verification commands
5) Definition of Done
Keep it concise." > "${PLAN_OUTPUT}"

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום תכנון"

claude -p "${CLEAN_COMMAND}
You are the implementation phase agent for this repository.
Task: ${TASK}
Implement the change directly in the workspace.
Constraints:
- Keep scope tight to task only.
- Update tech-debt/ANALYSIS.md only if relevant to completed finding.
- Run verification before finishing.
At the end, return a short report with changed files and verification results." > "${BUILD_OUTPUT}"

bash "${LOG_SCRIPT}" "${ROLE}" "${TASK}" "סיום בנייה"
python3 "${SUMMARY_SCRIPT}" >/dev/null 2>&1 || true

echo "Plan output: ${PLAN_OUTPUT}"
echo "Build output: ${BUILD_OUTPUT}"

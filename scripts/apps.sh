# apps.sh — single source of truth for the app list (slug <-> path).
# Sourced by bump.sh, corridor-guard.sh, release-guard.sh, release-debt.sh,
# and tag-release.yml. Add new apps HERE and nowhere else.
#
# Slugs match the deploy-workflow names (deploy-draft-<slug>.yml).

APP_SLUGS=(
  axis-day-off
  axis-planner
  axis-sync-calender
  axis-tracker
  deadline-confirm
  discussions
  team-people-column
  telemetry-dashboard
  twyst-your-status
)

app_path() {
  case "$1" in
    axis-day-off)        echo "apps/axis/day-off" ;;
    axis-planner)        echo "apps/axis/planner" ;;
    axis-sync-calender)  echo "apps/axis/sync-calender" ;;
    axis-tracker)        echo "apps/axis/tracker" ;;
    deadline-confirm)    echo "apps/deadline-confirm" ;;
    discussions)         echo "apps/discussions" ;;
    team-people-column)  echo "apps/team-people-column" ;;
    telemetry-dashboard) echo "apps/telemetry-dashboard" ;;
    twyst-your-status)   echo "apps/twyst-your-status" ;;
    *) echo "unknown app slug: $1" >&2; return 1 ;;
  esac
}

# Paths whose changes affect EVERY app (a shared change redeploys all).
SHARED_PATHS=(packages/shared)

#!/usr/bin/env bash
# Z Chat pull deploy. Installed to /usr/local/sbin/zchat-deploy (root:root 0755)
# and run by zchat-deploy.timer every 30 seconds.
#
# Security model: this script runs as root but NEVER executes repository code
# as root. Repository code is only:
#   - checked out with git (fixed commands, no hooks from the clone), and
#   - built/run by systemd units that drop to the sandboxed `zchat` user
#     (zchat-build.service / zchat-app.service) with ProtectHome/ProtectSystem.
# The installed copy of THIS script is not updated by git - changing the deploy
# logic is a deliberate root-only action.
set -euo pipefail

SRC=/srv/zchat/src
APP=/srv/zchat/app
STATE=/srv/zchat/state
LOG=/srv/zchat/deploy.log
BRANCH=main
LOCK_FILE="$STATE/deploy.lock"
REV_FILE="$STATE/deployed-rev"
FAIL_FILE="$STATE/deploy-failed"

mkdir -p "$STATE"
exec >>"$LOG" 2>&1

# Never let two deploys overlap.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

runuser -u zchat -- git -C "$SRC" fetch --quiet origin "$BRANCH"
REMOTE=$(runuser -u zchat -- git -C "$SRC" rev-parse "origin/$BRANCH")
LAST=$(cat "$REV_FILE" 2>/dev/null || true)

# Quiet no-op: polling runs every 30s, so only real deploys are logged.
if [ "$REMOTE" = "$LAST" ]; then
  exit 0
fi

# Backoff: if this exact revision failed to build recently, wait 10 minutes
# before retrying instead of burning a full build every 30 seconds.
if [ -s "$FAIL_FILE" ]; then
  read -r FAIL_REV FAIL_TS < "$FAIL_FILE" || true
  if [ "${FAIL_REV:-}" = "$REMOTE" ] && [ -n "${FAIL_TS:-}" ] && [ $(( $(date +%s) - FAIL_TS )) -lt 600 ]; then
    exit 0
  fi
fi

echo "=== $(date -Is) deploying $REMOTE (last deployed: ${LAST:-none})"
runuser -u zchat -- git -C "$SRC" reset --hard "origin/$BRANCH"

echo "building $REMOTE ..."
if ! systemctl start zchat-build.service; then
  echo "BUILD FAILED for $REMOTE at $(date -Is) (retry in ~10 min or on next change)"
  printf '%s %s\n' "$REMOTE" "$(date +%s)" > "$FAIL_FILE"
  exit 1
fi

# Build succeeded: publish atomically and restart.
rm -rf "$APP/.output.new"
cp -a "$SRC/.output" "$APP/.output.new"
rm -rf "$APP/.output"
mv "$APP/.output.new" "$APP/.output"
chown -R zchat:zchat "$APP"

systemctl restart zchat-app.service
echo "$REMOTE" > "$REV_FILE"
rm -f "$FAIL_FILE"
echo "deployed $REMOTE"

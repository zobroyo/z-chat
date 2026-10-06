#!/usr/bin/env bash
# Z Chat pull deploy. Installed to /usr/local/sbin/zchat-deploy (root:root 0755).
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

mkdir -p "$STATE"
exec >>"$LOG" 2>&1

# Never let two deploys overlap.
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "[$(date -Is)] another deploy is already running; skipping"; exit 0; }

echo "=== $(date -Is) deploy check ($BRANCH)"

runuser -u zchat -- git -C "$SRC" fetch --quiet origin "$BRANCH"
REMOTE=$(runuser -u zchat -- git -C "$SRC" rev-parse "origin/$BRANCH")
LAST=$(cat "$REV_FILE" 2>/dev/null || true)

if [ "$REMOTE" = "$LAST" ]; then
  echo "already up to date ($REMOTE)"
  exit 0
fi

echo "new revision $REMOTE (last deployed: ${LAST:-none})"
runuser -u zchat -- git -C "$SRC" reset --hard "origin/$BRANCH"

echo "building $REMOTE ..."
systemctl start zchat-build.service

# Build succeeded: publish atomically and restart. If the build fails, `set -e`
# aborts here, the deployed revision is NOT recorded, and the next timer run
# retries while the current build keeps serving.
rm -rf "$APP/.output.new"
cp -a "$SRC/.output" "$APP/.output.new"
rm -rf "$APP/.output"
mv "$APP/.output.new" "$APP/.output"
chown -R zchat:zchat "$APP"

systemctl restart zchat-app.service
echo "$REMOTE" > "$REV_FILE"
echo "deployed $REMOTE"

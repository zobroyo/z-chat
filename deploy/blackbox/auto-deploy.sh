#!/usr/bin/env bash
#
# ZChat auto-deploy worker (black box).
#
# Pulls the configured branch and rebuilds + redeploys ONLY when the remote
# commit changed, so it is safe to run on a short timer. Installed by
# deploy/blackbox/install-auto-deploy.sh; drive it with zchat-deploy.timer.
#
#   Logs:     journalctl -u zchat-deploy -f
#   Run now:  sudo systemctl start zchat-deploy.service
#
set -euo pipefail

REPO_DIR="${ZCHAT_REPO_DIR:-/home/user/zchat}"
APP_DIR="${ZCHAT_APP_DIR:-/home/user/zchat-app}"
BRANCH="${ZCHAT_BRANCH:-main}"
APP_SERVICE="${ZCHAT_APP_SERVICE:-zchat-app}"
STATE_DIR="${ZCHAT_STATE_DIR:-${HOME:-/home/user}/.cache/zchat-deploy}"
LOCK_FILE="$STATE_DIR/deploy.lock"
REV_FILE="$STATE_DIR/deployed-rev"

# Supabase public config, baked into the client bundle at build time. These are
# publishable (already visible in the browser bundle), not secrets.
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://dwstivxwyqdogzgxnidm.supabase.co}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_1ToX7uWyKMM_cqFjdWpGmQ_tQak-JF3}"

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }

mkdir -p "$STATE_DIR"

# Never let two deploys overlap.
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { log "another deploy is already running; skipping"; exit 0; }
fi

cd "$REPO_DIR"

log "checking origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
REMOTE_REV="$(git rev-parse "origin/$BRANCH")"
LAST_REV="$(cat "$REV_FILE" 2>/dev/null || true)"

if [ "$REMOTE_REV" = "$LAST_REV" ]; then
  log "already up to date ($REMOTE_REV)"
  exit 0
fi

log "new revision $REMOTE_REV (was ${LAST_REV:-none}) — deploying"

# Fast-forward the working tree to the remote revision. Untracked files (.env,
# node_modules) are left alone. If the tree cannot fast-forward, reset it.
git checkout --quiet "$BRANCH" 2>/dev/null || git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

log "installing dependencies"
npm install --no-audit --no-fund

log "building"
npm run build

if [ ! -d "$REPO_DIR/.output" ]; then
  log "ERROR: build produced no .output directory"
  exit 1
fi

log "publishing build to $APP_DIR/.output"
mkdir -p "$APP_DIR/.output"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$REPO_DIR/.output/" "$APP_DIR/.output/"
else
  rm -rf "$APP_DIR/.output.new"
  cp -r "$REPO_DIR/.output" "$APP_DIR/.output.new"
  rm -rf "$APP_DIR/.output"
  mv "$APP_DIR/.output.new" "$APP_DIR/.output"
fi
date -Is > "$APP_DIR/.output/.deployed-at"

log "restarting $APP_SERVICE"
sudo -n systemctl restart "$APP_SERVICE"

echo "$REMOTE_REV" > "$REV_FILE"
log "deployed $REMOTE_REV"

#!/usr/bin/env bash
#
# One-time installer for ZChat auto-deploy on the black box.
#
# Run on the box (after pulling this commit):
#   sudo bash /home/user/zchat/deploy/blackbox/install-auto-deploy.sh
#
# It installs and starts zchat-deploy.timer; from then on the box pulls
# origin/main, rebuilds, and restarts zchat-app whenever the commit changes.
#
# Overridable: ZCHAT_REPO_DIR, ZCHAT_APP_DIR, ZCHAT_USER, ZCHAT_APP_SERVICE, ZCHAT_BRANCH
#
set -euo pipefail

REPO_DIR="${ZCHAT_REPO_DIR:-/home/user/zchat}"
APP_DIR="${ZCHAT_APP_DIR:-/home/user/zchat-app}"
RUN_USER="${ZCHAT_USER:-user}"
APP_SERVICE="${ZCHAT_APP_SERVICE:-zchat-app}"
BRANCH="${ZCHAT_BRANCH:-main}"
UNIT_SRC="$REPO_DIR/deploy/blackbox"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo:  sudo bash $UNIT_SRC/install-auto-deploy.sh" >&2
  exit 1
fi

if [ ! -d "$REPO_DIR" ]; then
  echo "Repo not found at $REPO_DIR (set ZCHAT_REPO_DIR)" >&2
  exit 1
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "User '$RUN_USER' does not exist (set ZCHAT_USER)" >&2
  exit 1
fi

echo "==> Rendering systemd units"
sed -e "s|__USER__|$RUN_USER|g" \
    -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_SERVICE__|$APP_SERVICE|g" \
    -e "s|__BRANCH__|$BRANCH|g" \
    "$UNIT_SRC/zchat-deploy.service" > /etc/systemd/system/zchat-deploy.service
install -m 0644 "$UNIT_SRC/zchat-deploy.timer" /etc/systemd/system/zchat-deploy.timer
chmod +x "$UNIT_SRC/auto-deploy.sh"

echo "==> Allowing $RUN_USER to restart $APP_SERVICE without a password"
cat > /etc/sudoers.d/zchat-deploy <<EOF
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $APP_SERVICE
EOF
chmod 0440 /etc/sudoers.d/zchat-deploy
visudo -cf /etc/sudoers.d/zchat-deploy >/dev/null

echo "==> Enabling the timer"
systemctl daemon-reload
systemctl enable --now zchat-deploy.timer

echo "==> Running the first deploy now"
systemctl start zchat-deploy.service
systemctl --no-pager --full status zchat-deploy.service || true

cat <<EOF

Done. The box now auto-deploys origin/$BRANCH every 2 minutes.

  Watch:     journalctl -u zchat-deploy -f
  Deploy now: sudo systemctl start zchat-deploy.service
  Stop it:    sudo systemctl disable --now zchat-deploy.timer
EOF

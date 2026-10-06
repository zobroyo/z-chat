#!/usr/bin/env bash
# Z Chat idempotent installer. Run as root from /home/user/zchat/deploy:
#   sudo bash /home/user/zchat/deploy/install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: install.sh must be run as root (sudo bash $0)" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/home/user/zchat"
APP_DEPLOY="${APP_DIR}/deploy"
SYSTEMD_DIR="/etc/systemd/system"

echo "==> Z Chat installer (source: ${DEPLOY_DIR})"

echo "==> Installing systemd units into ${SYSTEMD_DIR}"
install -d -m 0755 "${SYSTEMD_DIR}"
install -m 0644 "${DEPLOY_DIR}/zchat.service" "${SYSTEMD_DIR}/zchat.service"
install -m 0644 "${DEPLOY_DIR}/zchat-tunnel.service" "${SYSTEMD_DIR}/zchat-tunnel.service"
install -m 0644 "${DEPLOY_DIR}/ollama-keepalive.service" "${SYSTEMD_DIR}/ollama-keepalive.service"
install -m 0644 "${DEPLOY_DIR}/ollama-keepalive.timer" "${SYSTEMD_DIR}/ollama-keepalive.timer"
install -m 0644 "${DEPLOY_DIR}/backup.service" "${SYSTEMD_DIR}/backup.service"
install -m 0644 "${DEPLOY_DIR}/backup.timer" "${SYSTEMD_DIR}/backup.timer"

echo "==> Ensuring helper scripts live in ${APP_DEPLOY}"
install -d -m 0755 "${APP_DEPLOY}"
if [[ "${DEPLOY_DIR}" != "${APP_DEPLOY}" ]]; then
  install -m 0755 "${DEPLOY_DIR}/ollama-keepalive.sh" "${APP_DEPLOY}/ollama-keepalive.sh"
  install -m 0755 "${DEPLOY_DIR}/backup.sh" "${APP_DEPLOY}/backup.sh"
fi
chmod +x "${APP_DEPLOY}/ollama-keepalive.sh" "${APP_DEPLOY}/backup.sh"

echo "==> Creating Python virtualenv (if missing)"
if [[ ! -x "${APP_DIR}/.venv/bin/python" ]]; then
  /usr/bin/python3 -m venv "${APP_DIR}/.venv"
fi
"${APP_DIR}/.venv/bin/pip" install --upgrade pip
"${APP_DIR}/.venv/bin/pip" install quart hypercorn aiohttp

echo "==> Installing ollama keep-alive drop-in"
install -d -m 0755 "${SYSTEMD_DIR}/ollama.service.d"
install -m 0644 "${DEPLOY_DIR}/ollama-keepalive.conf" "${SYSTEMD_DIR}/ollama.service.d/keepalive.conf"

echo "==> Reloading systemd and restarting ollama"
systemctl daemon-reload
systemctl restart ollama

echo "==> Enabling Z Chat services"
systemctl enable --now zchat.service
systemctl enable --now zchat-tunnel.service

echo "==> Enabling timers"
systemctl enable --now ollama-keepalive.timer backup.timer

echo "==> Fixing ownership of ${APP_DIR} (including .venv)"
chown -R user:user "${APP_DIR}"

if [[ -f "${APP_DIR}/ADMIN_LOGIN.txt" ]]; then
  echo "==> Admin credentials (${APP_DIR}/ADMIN_LOGIN.txt):"
  cat "${APP_DIR}/ADMIN_LOGIN.txt"
else
  echo "==> No ${APP_DIR}/ADMIN_LOGIN.txt found (skipping credential note)"
fi

echo "==> Service status"
for unit in zchat.service zchat-tunnel.service ollama-keepalive.timer backup.timer; do
  printf '  %-30s %s\n' "${unit}" "$(systemctl is-active "${unit}" || true)"
done

echo "==> Done."

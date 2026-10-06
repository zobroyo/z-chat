#!/usr/bin/env bash
# One-time bootstrap of Z Chat on a fresh black box (run as root).
#
# Creates the sandboxed `zchat` system user, clones the repo, installs the
# systemd units, builds once and enables the 5-minute GitHub pull deploy.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

REPO="${ZCHAT_REPO:-https://github.com/zobroyo/z-chat.git}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NPM_BIN="$(command -v npm)"
NODE_BIN="$(command -v node)"

if [[ -z "${NPM_BIN}" || -z "${NODE_BIN}" ]]; then
  echo "node/npm not found in PATH" >&2
  exit 1
fi

echo "==> system user + directories"
id -u zchat >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/zchat --shell /usr/sbin/nologin zchat
mkdir -p /srv/zchat/src /srv/zchat/app
chown -R zchat:zchat /srv/zchat

echo "==> clone / update repository"
if [[ ! -d /srv/zchat/src/.git ]]; then
  runuser -u zchat -- git clone --depth 50 "${REPO}" /srv/zchat/src
else
  runuser -u zchat -- git -C /srv/zchat/src fetch --quiet origin main
  runuser -u zchat -- git -C /srv/zchat/src reset --hard origin/main
fi
chown -R zchat:zchat /srv/zchat

echo "==> install systemd units"
install -m 0644 "${HERE}/zchat-app.service" /etc/systemd/system/zchat-app.service
install -m 0644 "${HERE}/zchat-build.service" /etc/systemd/system/zchat-build.service
install -m 0644 "${HERE}/zchat-deploy.service" /etc/systemd/system/zchat-deploy.service
install -m 0644 "${HERE}/zchat-deploy.timer" /etc/systemd/system/zchat-deploy.timer

# Patch the npm path if it is not /usr/bin/npm.
if [[ "${NPM_BIN}" != "/usr/bin/npm" ]]; then
  sed -i "s|^ExecStart=/usr/bin/npm|ExecStart=${NPM_BIN}|g" /etc/systemd/system/zchat-build.service
fi
if [[ "${NODE_BIN}" != "/usr/bin/node" ]]; then
  sed -i "s|^ExecStart=/usr/bin/node|ExecStart=${NODE_BIN}|g" /etc/systemd/system/zchat-app.service
fi

echo "==> install root deploy wrapper (deliberately NOT updated by git)"
install -m 0755 "${HERE}/zchat-deploy.sh" /usr/local/sbin/zchat-deploy

systemctl daemon-reload
systemctl enable zchat-app.service zchat-deploy.timer

echo "==> first build + deploy"
systemctl start zchat-deploy.service

echo "==> enable timers"
systemctl start zchat-deploy.timer

echo "==> status"
systemctl is-active zchat-app.service || true
systemctl is-active zchat-deploy.timer || true
tail -n 5 /srv/zchat/deploy.log 2>/dev/null || true
echo "Done. The site updates automatically within 5 minutes of any push to main."

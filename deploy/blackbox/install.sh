#!/usr/bin/env bash
# One-time bootstrap of Z Chat on a fresh black box (run as root).
#
# Creates the sandboxed `zchat` system user, clones the repo, installs the
# systemd units (app, build, 30-second GitHub pull deploy, health watchdog),
# the resilience settings (kernel panic reboot, software watchdog), builds
# once and enables everything.
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
mkdir -p /srv/zchat/src /srv/zchat/app /srv/zchat/state
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
install -m 0644 "${HERE}/zchat-deploy.path" /etc/systemd/system/zchat-deploy.path
install -m 0644 "${HERE}/zchat-healthcheck.service" /etc/systemd/system/zchat-healthcheck.service
install -m 0644 "${HERE}/zchat-healthcheck.timer" /etc/systemd/system/zchat-healthcheck.timer

# Patch the npm/node paths if they are not the defaults.
if [[ "${NPM_BIN}" != "/usr/bin/npm" ]]; then
  sed -i "s|^ExecStart=/usr/bin/npm|ExecStart=${NPM_BIN}|g" /etc/systemd/system/zchat-build.service
fi
if [[ "${NODE_BIN}" != "/usr/bin/node" ]]; then
  sed -i "s|^ExecStart=/usr/bin/node|ExecStart=${NODE_BIN}|g" /etc/systemd/system/zchat-app.service
fi

echo "==> install root helpers (deliberately NOT updated by git)"
install -m 0755 "${HERE}/zchat-deploy.sh" /usr/local/sbin/zchat-deploy
install -m 0755 "${HERE}/zchat-healthcheck.sh" /usr/local/sbin/zchat-healthcheck

echo "==> resilience settings"
install -m 0644 "${HERE}/ollama-resilience.conf" /etc/systemd/system/ollama.service.d/resilience.conf
install -m 0644 "${HERE}/99-zchat-resilience.conf" /etc/sysctl.d/99-zchat-resilience.conf
install -m 0644 "${HERE}/softdog.conf" /etc/modules-load.d/softdog.conf
install -d -m 0755 /etc/systemd/system.conf.d
install -m 0644 "${HERE}/watchdog.conf" /etc/systemd/system.conf.d/watchdog.conf
modprobe softdog 2>/dev/null || true
sysctl --system >/dev/null 2>&1 || true

echo "==> deploy webhook secret"
if [[ ! -s /srv/zchat/deploy-hook.secret ]]; then
  (umask 177; openssl rand -hex 32 > /srv/zchat/deploy-hook.secret)
fi
chown root:root /srv/zchat/deploy-hook.secret
chmod 600 /srv/zchat/deploy-hook.secret

systemctl daemon-reload
systemctl daemon-reexec
mkdir -p /etc/systemd/system/ollama.service.d
systemctl enable zchat-app.service zchat-deploy.timer zchat-deploy.path zchat-healthcheck.timer
systemctl enable docker.service 2>/dev/null || true

echo "==> first build + deploy"
systemctl start zchat-deploy.service

echo "==> start timers"
systemctl start zchat-deploy.timer
systemctl start zchat-deploy.path
systemctl start zchat-healthcheck.timer

echo "==> status"
systemctl is-active zchat-app.service || true
systemctl is-active zchat-deploy.timer || true
systemctl is-active zchat-deploy.path || true
systemctl is-active zchat-healthcheck.timer || true
tail -n 5 /srv/zchat/deploy.log 2>/dev/null || true

cat <<EOF

Done. Deploys trigger on GitHub push (webhook) with a 30s polling fallback,
and the health check runs every 2 minutes.

Add the webhook in GitHub: repo -> Settings -> Webhooks -> Add webhook
  Payload URL:  https://z-chat.men/api/deploy-hook
  Content type: application/json
  Secret:       $(cat /srv/zchat/deploy-hook.secret)
  Events:       Just the push event
EOF

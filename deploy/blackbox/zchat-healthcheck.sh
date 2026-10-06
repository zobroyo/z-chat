#!/usr/bin/env bash
# Z Chat black box health check + auto recovery.
# Installed to /usr/local/sbin/zchat-healthcheck (root:root 0755) and driven by
# zchat-healthcheck.timer every 2 minutes. Fixed steps only - this script is
# NOT updated by git (same rule as the deploy wrapper).
set -uo pipefail

APP_URL="http://127.0.0.1:1298/"
OLLAMA_URL="http://127.0.0.1:11434"
MODEL="gemma4:e2b"
TUNNEL_CONTAINER="zchat-tunnel"
LOG="/srv/zchat/health.log"
LOCK="/srv/zchat/state/health.lock"

mkdir -p /srv/zchat/state

# Keep the log at a sane size (keep the last 500 lines when it passes 1 MiB).
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 1048576 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exec 9>"$LOCK"
flock -n 9 || exit 0

log() { printf '[%s] %s\n' "$(date -Is)" "$*" >>"$LOG"; }

problems=0
recover() {
  log "$1"
  problems=$((problems + 1))
}

# 1. Web app answers with 200.
if ! systemctl is-active --quiet zchat-app.service; then
  recover "zchat-app.service inactive -> starting"
  systemctl start zchat-app.service
elif ! curl -fsS -m 8 -o /dev/null "$APP_URL"; then
  recover "app not answering on $APP_URL -> restarting zchat-app.service"
  systemctl restart zchat-app.service
fi

# 2. Ollama is up.
if ! curl -fsS -m 5 -o /dev/null "$OLLAMA_URL/api/tags"; then
  recover "ollama not responding -> restarting ollama.service"
  systemctl restart ollama.service
fi

# 3. The moderation model is resident (keeps first messages fast after outages).
if curl -fsS -m 5 -o /dev/null "$OLLAMA_URL/api/tags" && ! ollama ps 2>/dev/null | grep -q "$MODEL"; then
  recover "moderation model $MODEL not loaded -> warming"
  curl -sf -m 600 "$OLLAMA_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${MODEL}\",\"think\":false,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1,\"num_ctx\":2048}}" \
    >/dev/null || log "warning: model warm-up request failed"
fi

# 4. Cloudflare tunnel container is running.
if command -v docker >/dev/null 2>&1; then
  if ! docker inspect -f '{{.State.Running}}' "$TUNNEL_CONTAINER" 2>/dev/null | grep -q true; then
    recover "tunnel container '$TUNNEL_CONTAINER' not running -> starting"
    systemctl start docker.service 2>/dev/null || true
    docker start "$TUNNEL_CONTAINER" >/dev/null 2>&1 || log "warning: could not start $TUNNEL_CONTAINER"
  fi
fi

# 5. Periodic services are still scheduled.
for unit in zchat-deploy.timer zchat-deploy.path ollama-keepalive.timer backup.timer zchat-healthcheck.timer; do
  if ! systemctl is-active --quiet "$unit"; then
    recover "$unit inactive -> starting"
    systemctl start "$unit"
  fi
done

# 6. Disk space early warning.
avail_kb=$(df --output=avail /srv 2>/dev/null | tail -1 | tr -d ' ')
if [ -n "${avail_kb:-}" ] && [ "${avail_kb:-0}" -lt 3145728 ]; then
  recover "warning: low disk space on /srv ($((avail_kb / 1024)) MiB free)"
fi

if [ "$problems" -eq 0 ]; then
  log "ok"
fi

exit 0

#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="/home/user/zchat/tunnel.token"

if [[ -s "${TOKEN_FILE}" ]]; then
  exec /usr/bin/cloudflared tunnel --no-autoupdate run --token "$(tr -d '[:space:]' < "${TOKEN_FILE}")"
fi

exec /usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8790

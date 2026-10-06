#!/usr/bin/env bash
# Keep the ollama model loaded forever (keep_alive=-1).
#
# Always send a 1-token /api/chat ping: if the model is not resident it gets
# loaded, and if it is already resident the keep-alive timer is refreshed.
set -euo pipefail

MODEL="llama3.2:3b"
URL="http://127.0.0.1:11434"

curl -sf -m 120 "${URL}/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1}}"

echo "ollama-keepalive: refreshed ${MODEL} with keep_alive=-1 at $(date -Is)"

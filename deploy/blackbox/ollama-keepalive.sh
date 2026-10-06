#!/usr/bin/env bash
# Keep the ollama moderation model loaded forever (keep_alive=-1).
#
# Always send a 1-token /api/chat ping with the SAME num_ctx the app uses
# (context length is part of the load; a mismatch forces a reload), so the
# model stays resident and warm for every moderation request.
set -euo pipefail

MODEL="gemma4:e2b"
NUM_CTX=2048
URL="http://127.0.0.1:11434"

curl -sf -m 600 "${URL}/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"think\":false,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1,\"num_ctx\":${NUM_CTX}}}"

echo "ollama-keepalive: refreshed ${MODEL} (num_ctx=${NUM_CTX}) with keep_alive=-1 at $(date -Is)"

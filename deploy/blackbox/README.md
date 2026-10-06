# Black box deployment notes (AI moderation)

The chat app is served from the black box through the Cloudflare tunnel;
everything else lives on Supabase. Only the AI moderation model runs locally.

## Hosting

- Built app lives in `/home/user/zchat-app` and runs via
  `/usr/bin/node .output/server/index.mjs` under `zchat-app.service`
  (Restart=always, enabled at boot). Unit file is next to this README.
- cloudflared runs in Docker (`--network host` is required so the container can
  reach `localhost:1298`):

  ```
  docker run -d --name zchat-tunnel --restart unless-stopped --network host \
    cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TOKEN>
  ```

  Dashboard ingress: `z-chat.men` -> `http://localhost:1298`.
- Rebuild + deploy: `npm run build` with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` set, copy `.output/` to
  `/home/user/zchat-app/.output`, then `systemctl restart zchat-app`.

## Ollama (RTX 4060)

- Model: `llama3.1:8b`, pinned with `keep_alive=-1`.
- Drop-in: `/etc/systemd/system/ollama.service.d/keepalive.conf`
  (OLLAMA_KEEP_ALIVE=-1, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0,
  OLLAMA_NUM_PARALLEL=1)
- The app requests `num_ctx=2048`; the keepalive ping must use the same value
  or Ollama reloads the model on every context change.
- Keepalive timer (`ollama-keepalive.timer`, every 5 min) runs
  `/home/user/zchat/deploy/ollama-keepalive.sh` — a 1-token ping that keeps the
  model permanently resident. The script here is the synced copy of that file.
- Do NOT send `format: "json"` to Ollama for the moderation call: the JSON
  grammar adds ~750ms per request. The prompt asks for JSON and the server
  parses prose/fenced JSON tolerantly.

## Latency notes (measured)

- Ollama warm: ~520-580ms per verdict (~230ms runner scheduling + ~240ms
  generation + ~30ms cached prefill). The ~230ms scheduling cost is inherent to
  Ollama 0.23.1 on this box (unchanged by NUM_PARALLEL / flash attention).
- Supabase round-trip from the box: ~360ms. The server keeps short-lived caches
  (settings 60s, conversation 5s, profile 15s) and takes the chat history from
  the client so a send needs only one DB write.
- End-to-end send (warm):
  - greetings / DMs / AI-off groups: ~350-400ms
  - AI-checked messages: ~850-950ms (Ollama verdict + Supabase insert, serial)

## GPU clock warning

`kryptex_kaspa/start_miner.sh` locks the memory clock to 810 MHz for mining.
Those locks persist after the miner stops and make inference ~11x slower
(4.8 tok/s instead of ~53 tok/s). Reset with:

```
nvidia-smi --reset-gpu-clocks
nvidia-smi --reset-memory-clocks
```

If you want to mine and chat at the same time, remove the `--lock-memory-clocks`
line from the miner start script (or stop the miner while using the AI).

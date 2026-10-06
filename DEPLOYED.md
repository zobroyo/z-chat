# Z Chat — deployment status (black box)

Everything runs on the black box (10.10.0.13). Nothing is hosted on Cloudflare;
cloudflared is only an ingress tunnel that dials out from the box.

## Live right now

- LAN: `http://10.10.0.13:8790` (ufw allows 8790/tcp)
- Quick tunnel (temporary, changes on restart): see `/home/user/zchat/tunnel.log`
- Named tunnel "Z Chat" (id `6608ef49-46a5-4c94-b813-f8cc541e0bd4`) is connected
  and configured for `z-chat.men` + `www.z-chat.men` -> `http://127.0.0.1:8790`.
  It goes live as soon as DNS points there (needs a DNS-capable Cloudflare token,
  or dashboard: Zero Trust > Networks > Tunnels > Z Chat > Public Hostname).

## Admin

- Web admin panel: gear icon in the sidebar as an admin user.
- Credentials file: `/home/user/zchat/ADMIN_LOGIN.txt` (generated on first start).
- Override via env `ZCHAT_ADMIN_USER` / `ZCHAT_ADMIN_PASSWORD` before first run.

## AI moderation

- Ollama `llama3.2:3b` on the RTX 4060, pinned with `OLLAMA_KEEP_ALIVE=-1`
  (drop-in: /etc/systemd/system/ollama.service.d/keepalive.conf).
- Every message is checked before it is stored/broadcast, with the last 15
  messages of the channel as context. Only `safe: true` messages are sent.
- System prompt is editable in the admin panel ("AI Moderation" tab).
- If Ollama/the model is down, the server keeps working and gates messages with
  the built-in basic filter (UI shows "AI moderation: fallback filter").
- Blocked messages are logged; 3 blocks within 10 minutes = automatic 10 minute
  timeout. Admins can time out users manually (popover or admin panel).

## Services (all enabled at boot)

- `zchat.service` — Quart app on 0.0.0.0:8790 (hypercorn, venv .venv)
- `zchat-tunnel.service` — cloudflared (named tunnel if tunnel.token exists, else quick tunnel)
- `ollama-keepalive.timer` — re-warms/pins the model every 5 minutes
- `backup.timer` — daily 04:30 rclone sync to Google Drive (`gdrive:BlackBox-Backup`)
- `ollama.service` — already enabled system-wide

## Backup

- rclone config: `/root/.config/rclone/rclone.conf` (remote `gdrive`)
- Script: `/home/user/zchat/deploy/backup.sh`, log: `/home/user/zchat/backup.log`
- Excludes caches/venvs/node_modules; includes /home/user, /etc/systemd/system,
  fstab/hosts/environment and the rclone config.

## Voice/video

- WebRTC mesh with WebSocket signaling through the app; STUN only (no TURN).
  Peers behind strict/symmetric NAT may fail to connect; add a TURN server
  (e.g. coturn) to fix that.

## Offline behaviour

- If the box reboots or the app restarts: systemd brings everything back,
  clients reconnect automatically, queued messages are flushed, the model is
  re-warmed by the keepalive timer.
- If the app/model is unavailable the web client caches the shell + messages
  (service worker + localStorage) and queues outgoing messages until reconnect.

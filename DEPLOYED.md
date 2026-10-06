# Z Chat — deployment status (black box)

Everything runs on the black box (10.10.0.13). Nothing is hosted on Cloudflare;
the cloudflared tunnel is only an ingress connection that dials out from the box.

## Live

- **https://z-chat.men** — served from the black box through the Docker tunnel
- LAN: `http://10.10.0.13:1298` (ufw allows 1298/tcp)
- App listens on **port 1298** (`zchat.service`, hypercorn, venv `.venv`)

## Tunnel (Docker, runs on the box)

```
docker run -d --name zchat-tunnel --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TUNNEL_TOKEN>
```

- `--network host` is required so the container can reach `localhost:1298`.
- The token lives in `/home/user/zchat/tunnel.token` (chmod 600, git-ignored).
- Dashboard ingress for this tunnel: `z-chat.men -> http://localhost:1298`.
- The old `zchat-tunnel.service` (quick tunnel / named tunnel fallback) is
  disabled. Re-enable it only if the Docker container is removed.

## Admin

- Web admin panel: gear icon in the sidebar as an admin user.
- Credentials file: `/home/user/zchat/ADMIN_LOGIN.txt` (generated on first start).
- Change the password after first login and close registration if you want it private.

## AI moderation

- Ollama `llama3.2:3b` on the RTX 4060, pinned with `OLLAMA_KEEP_ALIVE=-1`
  (drop-in: `/etc/systemd/system/ollama.service.d/keepalive.conf`).
- Every message is checked before it is stored/broadcast, with the last 15
  messages of the channel as context. Only `safe: true` messages are sent.
- System prompt is editable in the admin panel ("AI Moderation" tab).
- If Ollama/the model is down, the server keeps working and gates messages with
  the built-in basic filter (UI shows "AI moderation: fallback filter").
- Blocked messages are logged; 3 blocks within 10 minutes = automatic 10 minute
  timeout. Admins can time out users manually (popover or admin panel).

## Services (all enabled at boot)

- `zchat.service` — Quart app on 0.0.0.0:1298 (Restart=always)
- `zchat-tunnel` (Docker, `--restart unless-stopped`) — cloudflared ingress
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

- If the box reboots or the app restarts: systemd/Docker bring everything back,
  clients reconnect automatically, queued messages are flushed, the model is
  re-warmed by the keepalive timer.
- If the app/model is unavailable the web client caches the shell + messages
  (service worker + localStorage) and queues outgoing messages until reconnect.

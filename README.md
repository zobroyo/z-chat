# Z Chat

Z Chat is a small, self-hosted, Discord-style community chat server. It pairs a
Quart + SQLite + WebSocket backend with a static single-page frontend and adds
real-time AI moderation: every message is judged by `llama3.2:3b` running
locally through [Ollama](https://ollama.com) (intended to run on an RTX 4060),
with an admin-editable system prompt and the last 15 messages of the channel as
context. If Ollama is offline the chat keeps working through a regex fallback
filter, and the client queues messages locally until the socket is back.

## Features

- **Discord-like UI** — channel list, member list with online state, message
  history, typing indicators, per-channel text and voice channels.
- **AI moderation** — each message is checked by `llama3.2:3b` via Ollama with
  the **last 15 messages of the same channel** as context (spam floods and
  targeted attacks are visible in context). The moderation system prompt is
  editable in the admin panel.
- **Strict verdict gating** — only an explicit `{"safe": true, ...}` from the
  model (or the fallback filter) lets a message through. Blocked messages are
  logged, the sender gets `mod_denied`, and 3 blocks inside 10 minutes trigger
  an automatic 10-minute timeout.
- **Timeouts** — automatic (AI) and manual (admin) with reason and `by` field.
- **Voice / video** — channel-based WebRTC; the server only relays SDP/ICE
  signaling (`voice_*` WebSocket events), media flows peer-to-peer.
- **Discord-style markdown** in messages, rendered client-side:
  `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``,
  `# headings`, `-# subtext`, `||spoilers||`.
- **Admin panel** — live mod log, member list, moderation on/off, registration
  open/close, system prompt editor, manual timeout/untimeout.
- **Spam rate badges** — messages-per-minute per user, badge at >= 6 msg/min,
  plus hard flood fallback at >= 25 msg/min.
- **Offline resilience** — model warmup retries in the background (chat is
  served immediately even if Ollama is down), a regex fallback filter blocks
  threats/spam/slurs, the client queues messages while disconnected, and a PWA
  service worker caches the app shell.
- **PWA** — `static/manifest.json` + `static/sw.js` for installability and
  offline shell caching.

## Architecture

```
browser  ──HTTPS/WSS──>  cloudflared  ──>  hypercorn (Quart)  127.0.0.1:8790
                                             ├── SQLite (zchat.db, WAL): users, channels, messages, config, mod_log
                                             ├── in-memory state: sockets, online users, voice rooms, message rates
                                             └── HTTP client ──> Ollama  127.0.0.1:11434  (llama3.2:3b)
```

- `server.py` — Quart app, REST API, WebSocket hub
  (`/ws`), moderation pipeline, SQLite persistence.
- `moderation.py` — Ollama client, strict JSON verdict parsing, regex fallback
  filter.
- `static/` — frontend SPA (`index.html`, `markdown.js`, `voice.js`, `sw.js`,
  `manifest.json`, `style.css`).
- `deploy/` — cloudflared tunnel config and systemd unit(s).

The server is **single-process by design**: socket sets, online/voice state and
rate counters live in memory, so run **exactly one worker**.

## Requirements

- Python 3.12 (tested on 3.12, Quart 0.20)
- Ollama reachable at `OLLAMA_URL`, with the configured model pulled
  (`ollama pull llama3.2:3b`)

Python packages are pinned in `requirements.txt`:

```
quart==0.20.0
hypercorn>=0.17
aiohttp>=3.10
```

## Run

```bash
python3 -m venv .venv
pip install -r requirements.txt
.venv/bin/hypercorn --bind 0.0.0.0:8790 --workers 1 server:app
```

Bind to `127.0.0.1:8790` and put cloudflared (or another reverse proxy that
supports WebSockets) in front for public access. On a dev box you can also run
`python server.py`, which uses `ZCHAT_HOST`/`ZCHAT_PORT` (default
`0.0.0.0:8790`); under hypercorn the bind address comes from `--bind`, and
`--workers 1` is required.

On first start the server creates `zchat.db`, a `.secret_key` file (session
signing, chmod 0600 where supported) and an admin account if none exists.

## Admin credentials

- On first run an admin user is generated and the credentials are written to
  `ADMIN_LOGIN.txt` in this directory (`username: ...` / `password: ...`,
  chmod 0600 where supported). To choose your own credentials, set the
  environment variables below *before* the first run. To reset a lost password,
  delete the admin row from the `users` table and restart, and a new
  `ADMIN_LOGIN.txt` will be generated.
- `ZCHAT_ADMIN_USER` — admin username (default `admin`).
- `ZCHAT_ADMIN_PASSWORD` — admin password (default: random `token_urlsafe(12)`).

Passwords are stored as PBKDF2-HMAC-SHA256 with 200,000 iterations and a
per-user 16-byte salt. Sessions are signed cookies; `POST /api/logout` clears
the session.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZCHAT_DB` | `./zchat.db` next to `server.py` | SQLite database path (WAL mode). |
| `ZCHAT_HOST` | `0.0.0.0` | Bind host, used by `python server.py` only. |
| `ZCHAT_PORT` | `8790` | Bind port, used by `python server.py` only. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL. |
| `ZCHAT_MODEL` | `llama3.2:3b` | Ollama model used for moderation and warmup; the value is mirrored into the DB config so `/api/state` reports the model actually in use. |
| `ZCHAT_ADMIN_USER` | `admin` | Admin username created on first run if no admin exists. |
| `ZCHAT_ADMIN_PASSWORD` | random | Admin password created on first run if no admin exists. |

Runtime toggles live in the `config` table and are changed through the admin
panel/API: `moderation_enabled`, `registration_open`, `mod_prompt`, `model`.

## Moderation pipeline

1. If the user is timed out, the message is rejected immediately (`mod_denied`).
2. The message rate is updated and the last 15 messages of the channel are
   loaded as context.
3. `moderator.check(...)` is called with a 60-second server-side deadline:
   - **Ollama offline** (probe of `/api/tags` fails) → regex fallback filter;
     normal messages pass, threats/spam/slurs are blocked.
   - **Ollama reachable** → `/api/chat` with `format: "json"`, temperature 0.1,
     `num_predict` 160, `num_ctx` 4096; the response must be a JSON object with
     `safe` (boolean / `"true"` / `1` may pass; anything else is unsafe).
   - **AI timeout (60 s)** → message denied (fail closed).
   - **Unparseable verdict** → regex fallback filter.
4. Unsafe messages are logged to `mod_log`, the sender is notified, admins get
   a `mod_log` event, and 3 blocks within 10 minutes cause a 10-minute
   auto-timeout. Only safe messages are inserted and broadcast.

The model is warmed once on startup with `keep_alive: -1` so it stays resident
in VRAM; the warmup runs as a background task that retries every 30 seconds and
never blocks startup.

## HTTP API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | Frontend SPA. |
| GET | `/static/<path>` | Static assets. |
| POST | `/api/register` | `{username, password}`; 409 on duplicate username, 403 when registration is closed. |
| POST | `/api/login` | `{username, password}`; 401 on bad credentials. |
| POST | `/api/logout` | Clears the session. |
| GET | `/api/me` | `{user: ...}` or `{user: null}`. |
| GET | `/api/state` | Channels, members (with `rpm`/`spamming`), moderation state, voice roster. |
| GET | `/api/messages` | `?channel_id=&limit=&before_id=` (limit capped at 200). |
| GET | `/api/admin/state` | Admin only: prompt, config, mod log, members. |
| POST | `/api/admin/prompt` | Admin only: replace the moderation system prompt. |
| POST | `/api/admin/config` | Admin only: `{moderation_enabled?, registration_open?}`. |
| POST | `/api/admin/timeout` | Admin only: `{user_id, minutes, reason?}`. |
| POST | `/api/admin/untimeout` | Admin only: `{user_id}`. |
| WS | `/ws` | Requires a logged-in session cookie; closes with 4401 otherwise. |

## WebSocket events

Server → client: `ready`, `members`, `message`, `message_ack`
(`{nonce, id, mode}` where `mode` is `ai` or `fallback`), `mod_denied`
(`{nonce, reason}`), `typing`, `timeout` (`{until, reason, by}`), `mod_config`
(`{enabled}`), `voice_peers`, `voice_joined`, `voice_left`, `voice_state`,
`voice_signal`, `voice_peer_left`, `pong` (reply to `ping`). Admins also
receive `mod_log` entries.

Client → server: `send` (`{channel_id, content, nonce}`), `typing`
(`{channel_id}`), `voice_join`, `voice_leave`, `voice_state`
(`{muted, deafened, video}`), `voice_signal` (`{target, data}`), `ping`.

Malformed frames are ignored and never tear down the socket.

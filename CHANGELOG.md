# Changelog

All changes to ZChat since the original build (`b265943` — "CHECKPOINT BEFORE CH", the Vercel-hosted React + Supabase app).

## 2026-10-06 (late) — link policy

- URLs are stripped from message text (and history) before the model sees them (`[link]`), so the AI can no longer flag links as "suspicious/spam".
- Banned sites are handled by a deterministic domain blocklist in the server (adult/OnlyFans and similar): matching messages are blocked instantly (~0.4s) with reason "banned website (adult content)".
- The moderation prompt no longer blocks messages for links, advertising or offers — it only blocks threats, targeted harassment/hate, sexual content, doxxing and clearly illegal content.
- The settings cache dropped from 60s to 15s so admin prompt edits take effect quickly.

## 2026-10-06 (evening) — moderation model swap

- Switched the moderation model from `llama3.1:8b` to **`gemma4:e2b`** (with its "thinking" mode disabled — otherwise Ollama returns an empty `content` and moderation breaks).
- Rewrote the moderation system prompt as a compact few-shot classifier: **20/20 on the moderation test set** (greetings, banter, mild swearing, threats, harassment, doxxing, scam links, spam).
- Keepalive script now pins `gemma4:e2b`; the per-request timeout was raised to 240s so a cold model load (gemma takes ~2-3 min the first time) doesn't drop messages.
- Trade-off: `gemma4:e2b` (7.7GB) doesn't fully fit in the 8GB 4060, so it runs ~25% GPU / 75% CPU — AI-checked messages are now ~1.6-1.8s end-to-end (was ~0.9s with llama3.1:8b). Greetings/short messages still skip the model entirely (~350-400ms), and DMs/AI-off groups are unaffected.

## 2026-10-06 — AI moderation, voice/video, Discord-style formatting, self-hosting

### Added

- **AI moderation before send** (`3006f6c`, `aa6556b`): every message is checked before it is stored or broadcast. The model runs locally on the self-hosted RTX 4060 (Ollama, `llama3.1:8b`) and receives the last 10 messages of the conversation plus the admin-configured system prompt. Only a `safe: true` verdict lets the message through; blocked messages are rejected with the reason and written to the moderation log.
- **Admin panel — AI moderation section** (`3006f6c`): on/off toggle, model display, editable moderation system prompt (Admin → Settings → AI moderation).
- **Timeouts, Discord-style** (`3006f6c`): admins can time out a user for 60s / 5m / 10m / 1h / 1d / 1w with a reason and remove timeouts (Admin → Users, and the member popover). Three AI blocks within 10 minutes = automatic 10-minute timeout. Timed-out users are blocked at the database level (RLS on `messages`), not just in the UI. **Admins can never be banned or timed out by the AI — only their message is blocked** (`2108b82`).
- **Voice/video calls** (`3006f6c`): per-conversation WebRTC calls with mic / camera / deafen / leave, participant tiles and a speaking indicator; signaling over Supabase Realtime (no extra servers).
- **Discord-style message formatting** (`3006f6c`): `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `inline code` ``, fenced code blocks, `#`/`##`/`###` headings, `-# subtext`, `>` quotes, `||spoilers||` and clickable links.
- **@mentions and @time** (`eeec997`): typing `@` opens a member autocomplete (arrow keys, Enter/Tab, Escape); mentions render as highlighted names and work with spaces in display names. `@time` inserts a live timestamp token rendered Discord-style (`t`, `T`, `d`, `D`, `f`, `F`, `R` formats, relative time updates live).
- **Per-conversation moderation scope** (`aa6556b`): DMs are never AI-moderated; group owners get an "AI moderation" toggle (shield icon) in the chat header; the public room follows the global admin setting.
- **Self-hosting on the black box**: the app now builds to Node and is served from the black box through the Cloudflare tunnel; Supabase stays the backend for auth/messages/storage. Deploy notes and units in `deploy/blackbox/`.

### Changed

- **Message list look** (`eeec997`, `aa6556b`): flat Discord-style rows — avatar + name + timestamp once per message run, each message on its own line, no bubbles. Consecutive messages from the same person are spaced tighter. Hover highlights the message and reveals the timestamp (absolutely positioned, no row-height change). Reply action on hover.
- **Moderation model** (`aa6556b`): switched from `llama3.2:3b` to `llama3.1:8b`; the prompt now explicitly allows greetings and short messages (`hi`, `hey`, `lol`, `ok`, …), which were being falsely flagged.
- **Send latency** (`aa6556b`): local JWT validation instead of an auth round-trip, short-lived server caches for settings/conversation/profile, conversation context supplied by the client, removed Ollama's JSON grammar (it cost ~750 ms/request), and a fast-path that skips the model entirely for greetings/acknowledgements. Measured end-to-end (warm): greetings, DMs and AI-off groups **~350–400 ms**; AI-checked messages **~850–950 ms** (down from 2.5–5 s).
- **Site metadata** (`3006f6c`): canonical URL, OG/Twitter image URLs and the Z Games return link now point at `https://z-chat.men` instead of the old Vercel URL.
- `tsc` is now clean (fixed a pre-existing root error-boundary type mismatch).

### Fixed

- Greetings being flagged by moderation.
- AI inference running 11× slower than the GPU allows (the Kryptex miner's start script permanently locks the memory clock to 810 MHz; documented in `deploy/blackbox/README.md`, clocks reset, miner disabled).
- The Ollama keepalive timer pinging the old 3B model and evicting the 8B, forcing slow reloads.
- Hovering a grouped message no longer makes the row taller (timestamp was wrapping to a second line).

### Database (Supabase migrations)

- `20261006180000_ai_moderation_and_timeouts.sql` — `chat_settings` AI columns; `profiles.timeout_until` / `timeout_reason` / `moderation_strikes` / `last_strike_at`; `moderation_log` table + RLS; `messages` insert policy blocks timed-out users; `record_moderation_block()` (strike counting + auto-timeout).
- `20261006190000_conversation_ai_moderation_toggle.sql` — `conversations.ai_moderation_enabled`; owner-only update policy.
- `20261006203000_admins_exempt_from_ai_timeout.sql` — admins are never timed out by the AI; blocked admin messages are still logged.

### Infrastructure (black box, RTX 4060)

- Ollama `llama3.1:8b` pinned with `keep_alive=-1` (flash attention + q8_0 KV cache, `num_ctx=2048`), refreshed every 5 minutes by `ollama-keepalive.timer`.
- `cloudflared` tunnel in Docker (`--network host`) serving `z-chat.men` → `localhost:1298`.
- `zchat-app.service` (Node) with `Restart=always`, enabled at boot; LAN access on `10.10.0.13:1298`.
- Daily 04:30 Google Drive backup of the box via rclone (`backup.timer`).
- Measured Ollama verdict: ~520–580 ms warm; Supabase round-trip from the box: ~360 ms — these two set the ~0.9 s floor for AI-checked messages.

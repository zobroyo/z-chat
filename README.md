# Z Chat

A Discord-style chat app: public room, direct messages and groups, with
rich previews, read receipts, push notifications - plus AI moderation,
voice/video calls and timeouts.

**Live:** https://z-chat.men | **Deploys:** push to `main` (auto-deploys to the
host within ~5 minutes, see [deploy/blackbox](deploy/blackbox/README.md))

## Stack

- **Frontend/SSR:** React 19, TanStack Start/Router, Tailwind v4, shadcn/ui
- **Backend:** Supabase (auth, Postgres + RLS, storage, Realtime) - no
  separate app backend; two server routes run alongside the SSR server:
  `/api/send-message` (moderation gate + insert) and `/api/link-preview`
  (rich previews, SSRF-guarded), plus `/api/moderate`
- **AI moderation:** local `gemma4:e2b` served by Ollama on the host's RTX 4060
  (the only self-hosted service - everything else is Supabase)
- **Hosting:** self-hosted Node build behind a Cloudflare tunnel on the
  "black box"; pull-based deploys from this repo

## Features

- **AI moderation before send** - every message is checked before it reaches
  the database; blocked messages come back with a reason and are logged.
  Context is the last 10 messages; the system prompt is editable in the admin
  panel. Links are judged by a deterministic domain blocklist (normal links
  never get flagged), and greetings/short messages skip the model entirely.
- **Timeouts** - admins can time out users (60s-1 week) from the admin panel;
  3 AI blocks within 10 minutes auto-times a user out; enforcement is in the
  database (RLS). Admins can never be timed out or banned by the AI.
- **Voice/video calls** - per-conversation WebRTC calls with an incoming-call
  ringtone + accept/decline prompt, mic/camera/deafen, participant tiles.
- **Discord-style formatting** - `**bold**`, `*italic*`, `__underline__`,
  `~~strike~~`, `` `code` ``, code blocks, `#` headings, `-#` subtext, quotes,
  `||spoilers||`, links.
- **@mentions and @time** - mention autocomplete, highlighted mentions, and
  Discord-style live timestamps.
- **Ban evasion + appeals** - device-fingerprint auto-ban for repeat signups
  and a ban appeal flow (`banned_appeals`).
- **Admin panel** - users (ban/timeout/admin), conversations, messages,
  settings (keyword + AI moderation), moderation log, ban appeals.

## Repository layout

```
src/routes/            pages (chat, admin/*, profile, recovery, oauth consent)
src/components/chat/   message list, composer, bubbles
src/components/call/   call button/overlay (ringtone + incoming prompt)
src/hooks/use-call.tsx WebRTC mesh + Supabase Realtime signaling + ringtone
src/lib/chat.ts        data access (profiles, conversations, messages, send)
src/lib/serverModeration.ts   /api/send-message + /api/moderate (AI gate)
src/lib/serverLinkPreview.ts  /api/link-preview (SSRF-guarded previews)
src/server.ts          SSR entry + API route interception
supabase/migrations/   every database migration applied to the project
deploy/blackbox/       units, deploy wrapper, installer, hosting docs
```

## Database migrations

Migrations in `supabase/migrations/` are the source of truth. They are applied
to the hosted project with the Supabase tooling; the app's generated types live
in `src/integrations/supabase/types.ts`.

## Development

```bash
npm install
npm run dev     # Vite dev server
npm run build   # production build (Nitro Node server, .output/)
npm run lint
```

Environment for builds: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
(publishable key only - never the service role key), `NITRO_PRESET=node-server`
on the host.

## Auto-deploy authentication

The black box pulls this (private) repository every 30 seconds as the `zchat` user using a read credential embedded in the deploy clone's git remote. If repository visibility or access tokens change, update the credential in `/srv/zchat/src/.git/config` on the box.

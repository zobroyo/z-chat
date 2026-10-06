# How deploys work (Z Chat black box)

Short version: **push to `main` on GitHub → the box pulls → sandboxed build →
atomic publish → restart.** Nobody needs SSH access to the box.

## 1. Source of truth

- Only **`origin/main`** of `github.com/zobroyo/z-chat` is deployed. The box
  checkout `/srv/zchat/src` is hard-synced to `origin/main`; uncommitted edits
  on the box do not survive a deploy.
- Exception: **systemd units** (`/etc/systemd/system/zchat-*`) and the root
  helpers (`/usr/local/sbin/zchat-*`) are root-installed copies. The repo keeps
  reference copies under `deploy/blackbox/`, but editing those files does **not**
  change anything until root runs `deploy/blackbox/install.sh` (or installs the
  file and `systemctl daemon-reload`).

## 2. Does a deploy wipe uncommitted changes?

Yes. `/usr/local/sbin/zchat-deploy` runs `git fetch` + `git reset --hard
origin/main` as the `zchat` user before each build. Never edit
`/srv/zchat/src` in place.

## 3. What triggers a deploy

All routes end at `zchat-deploy.service` → `/usr/local/sbin/zchat-deploy`:

- **GitHub webhook** (instant): GitHub POSTs
  `https://z-chat.men/api/deploy-hook`; the app verifies the HMAC with
  `/srv/zchat/deploy-hook.secret`, writes `/srv/zchat/state/deploy-request`,
  and the root `zchat-deploy.path` unit starts the deploy.
- **Polling fallback**: `zchat-deploy.timer`, every 30 s.
- **Manual**: `systemctl start zchat-deploy.service`.

The deploy script then starts `zchat-build.service` (sandboxed
`npm install && npm run build`), publishes `src/.output` → `/srv/zchat/app/.output`
and restarts `zchat-app.service`.

## 4. Paths

| What | Path |
| --- | --- |
| Source checkout (git) | `/srv/zchat/src` (user `zchat`) |
| Worktree build output | `/srv/zchat/src/.output` |
| Live app served by Node | `/srv/zchat/app/.output` (port 1298) |
| Deploy log | `/srv/zchat/deploy.log` |
| Health log | `/srv/zchat/health.log` |
| State | `/srv/zchat/state/` (`deployed-rev`, `deploy.lock`, `deploy-failed`, `deploy-request`, `health.lock`) |
| Units | `/etc/systemd/system/zchat-{app,build,deploy,healthcheck}.service`, `zchat-*.timer`, `zchat-deploy.path` |
| Root helpers | `/usr/local/sbin/zchat-deploy`, `/usr/local/sbin/zchat-healthcheck` |
| Webhook secret | `/srv/zchat/deploy-hook.secret` (root 600) |

Logs also in `journalctl -u zchat-app` / `-u zchat-build` / `-u zchat-deploy`.

## 5. Lanes

- **Auto-deploys on push to `main` (yours):** `src/`, `public/`,
  `supabase/migrations/`, `package.json`, app docs.
- **Root-only, no auto-apply (mine):** installed systemd units,
  `/usr/local/sbin/*`, secrets, `/srv/zchat/state`. If a change needs a unit
  edit, run `sudo bash /srv/zchat/src/deploy/blackbox/install.sh` (or ask me).
- `deploy/blackbox/*` in the repo is documentation/fresh-install source; it is
  not automatically applied.

## 6. Secrets and environment

- **Build-time:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from
  `zchat-build.service` — publishable key only (already public in the browser
  bundle). Never commit a Supabase service-role key.
- **Runtime:** `zchat-app.service` sets `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `OLLAMA_URL`, and loads
  `/srv/zchat/deploy-hook.secret` via `EnvironmentFile=`.
- **Never touch:** `/srv/zchat/deploy-hook.secret` (rotating it breaks GitHub
  webhook signatures until the GitHub side is updated), `/srv/zchat/state/*`,
  `/root/.config/rclone/*`, `/etc/systemd/system/ollama.service.d/*`.

## 7. Rollback

- **Normal:** revert on GitHub (`git revert <bad> && git push`) — the box
  deploys the revert within ~1 minute.
- **Freeze deploys:** `systemctl stop zchat-deploy.timer zchat-deploy.path`
  (the site keeps serving the current build). Re-enable with
  `systemctl start zchat-deploy.timer zchat-deploy.path`.
- **Build failures never take the site down** — the current build keeps
  serving. A failing revision is retried at most every 10 minutes
  (`/srv/zchat/state/deploy-failed`).

## 8. Safe workflow

- Straight to `main` is fine (small commits deploy in ~30–60 s). Branch + PR if
  you want review before it goes live.
- **Avoid:** force-pushing or rewriting published history (Lovable syncs this
  branch), editing `/srv/zchat/src` directly, committing secrets, changing the
  listen port without updating the tunnel.
- Only `refs/heads/main` deploys; other branches are ignored.

## 9. Gotchas that break the pipeline

- `npm install && npm run build` must pass. TS/build errors block the deploy
  (Nitro uses `NITRO_PRESET=node-server` from `zchat-build.service`).
- After a failed build of the same revision, retries are throttled to every
  10 minutes.
- The app runs sandboxed as `zchat` (`ProtectHome=yes`, `ProtectSystem=strict`,
  no capabilities): it cannot read `/home/user`, `/root` or system files, and
  can only write `/srv/zchat/state`.
- The app listens on `0.0.0.0:1298`; the Cloudflare tunnel forwards
  `localhost:1298`. Vercel is gone — everything must be served by the Nitro
  server (e.g. link previews live at `/api/link-preview`).
- Pushes that only touch `deploy/blackbox/*` still trigger a full rebuild
  (~1 minute, harmless).

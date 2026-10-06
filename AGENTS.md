> [!IMPORTANT]
> **Architecture & deploy.** GitHub `main` on `zobroyo/z-chat` is the single
> source of truth for the code. The production site (`https://z-chat.men`) is
> served from a self-hosted Linux "black box" behind a Cloudflare tunnel, which
> auto-deploys `main`: pull → `npm run build` → publish `.output/` → restart
> `zchat-app`.
>
> - Never rewrite pushed history — force pushing, or rebasing/amending/squashing
>   commits that are already pushed. GitHub and the box both track `main`;
>   rewriting it desyncs them.
> - Keep `main` in a working state: every push is deployed to production.
> - Database changes live in Supabase cloud and are applied there via
>   `supabase/migrations/`; they ship on a separate track from the code deploy.
> - Lovable was used only for the initial design. It is **not** part of the code
>   or deploy workflow — edit the repo directly.

- Theme state is frontend-only: persist mode/accent in localStorage and express palettes through semantic CSS tokens so every screen stays consistent.

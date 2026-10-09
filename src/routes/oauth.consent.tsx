import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

/* Custom OAuth consent between Z Chat and Z Games. Z Games sends the user
   here with client_id / redirect_uri / state / code_challenge; we ask for
   approval, then hand the user's Z Chat access token to the Z Games server,
   which verifies it and returns the redirect URL containing its own signed
   auth code. No third-party OAuth server involved. */

const APPROVE_URL_FALLBACK = "https://game.z-chat.men/api/oauth/approve";

/* Display names for the apps that use this consent page. */
const APP_NAMES: Record<string, string> = {
  "z-games": "Z Games",
  "z-slides": "Z Slides",
  "z-console": "Z Admin Console",
};

/* Only Z Chat family apps may receive the approval token. */
function resolveApproveUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && (url.hostname === "z-chat.men" || url.hostname.endsWith(".z-chat.men"))) {
      return raw;
    }
  } catch {
    /* fall through */
  }
  return APPROVE_URL_FALLBACK;
}

type ConsentParams = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  approve_url: string;
};

export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (search: Record<string, unknown>): ConsentParams => ({
    client_id: typeof search["client_id"] === "string" ? search["client_id"] : "",
    redirect_uri: typeof search["redirect_uri"] === "string" ? search["redirect_uri"] : "",
    state: typeof search["state"] === "string" ? search["state"] : "",
    code_challenge: typeof search["code_challenge"] === "string" ? search["code_challenge"] : "",
    code_challenge_method:
      typeof search["code_challenge_method"] === "string" ? search["code_challenge_method"] : "",
    approve_url: typeof search["approve_url"] === "string" ? search["approve_url"] : "",
  }),
  head: () => ({ meta: [{ title: "Sign in with ZChat" }] }),
  component: OAuthConsent,
});

function OAuthConsent() {
  const params = Route.useSearch();
  const appName = APP_NAMES[params.client_id] ?? "This app";
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = Boolean(
    params.client_id && params.redirect_uri && params.state && params.code_challenge,
  );

  const goLogin = () => {
    const back = window.location.pathname + window.location.search;
    window.location.assign(`/?zoauth_next=${encodeURIComponent(back)}`);
  };

  const decide = async (approve: boolean) => {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      if (!approve) {
        window.location.assign(
          `${params.redirect_uri}?error=access_denied&state=${encodeURIComponent(params.state)}`,
        );
        return;
      }
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Your ZChat session has expired. Log in again, then retry.");
        setBusy(false);
        return;
      }
      const response = await fetch(resolveApproveUrl(params.approve_url), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uri: params.redirect_uri,
          state: params.state,
          code_challenge: params.code_challenge,
        }),
      });
      const result = (await response.json().catch(() => null)) as { redirect?: string; error?: string } | null;
      if (!response.ok || !result?.redirect) {
        const reason = result?.error;
        setError(
          reason === "invalid_token"
            ? "Your ZChat session is no longer valid. Log in again, then retry."
            : reason === "banned"
              ? `This ZChat account is banned, so it can't use ${appName}.`
              : reason === "timed_out"
                ? "This ZChat account is timed out. Try again once the timeout ends."
                : reason === "not_admin"
                  ? `This ZChat account doesn't have access to ${appName}.`
                  : reason === "pending_application"
                    ? `Your application is still being reviewed. You can use ${appName} once an admin approves your account.`
                    : reason === "profile_unavailable"
                      ? `Could not check your ZChat account status for ${appName}. Please try again in a moment.`
                      : `Could not connect to ${appName}. Please try again.`,
        );
        setBusy(false);
        return;
      }
      window.location.assign(result.redirect);
    } catch {
      setError("Could not complete the connection. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom flex min-h-screen items-center justify-center px-5 py-10">
      <section className="surface-panel w-full max-w-md rounded-3xl p-7 shadow-lift sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary font-display text-lg font-extrabold text-primary-foreground">Z</span>
          <div><p className="text-sm text-muted-foreground">Secure sign-in</p><h1 className="text-xl font-bold">ZChat</h1></div>
        </div>

        {!valid ? (
          <p role="alert" className="text-sm text-destructive">
            This sign-in request is incomplete. Return to {appName} and try again.
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Checking your ZChat account…</p>
        ) : !session ? (
          <>
            <h2 className="text-2xl font-bold">Continue with ZChat</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Sign in to ZChat first, then approve the {appName} connection.
            </p>
            <Button className="mt-6 w-full" onClick={goLogin}>Continue to ZChat login</Button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold">Connect {appName}?</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              <strong className="text-foreground">{appName}</strong> is requesting access to your ZChat account.
            </p>
            <div className="mt-5 rounded-xl bg-surface-2 p-4">
              <p className="text-sm font-semibold">Information requested</p>
              <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                <li>Your profile name and avatar</li>
                <li>Your email address</li>
              </ul>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              {appName} uses this to sign you in.
            </p>
            {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>Deny</Button>
              <Button onClick={() => void decide(true)} disabled={busy}>{busy ? "Connecting…" : "Approve"}</Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

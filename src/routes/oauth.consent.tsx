import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  client?: { name?: string };
  scope?: string;
  redirect_uri?: string;
};

export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id: typeof search["authorization_id"] === "string" ? search["authorization_id"] : "",
  }),
  head: () => ({ meta: [{ title: "Connect Z Games with ZChat" }] }),
  component: OAuthConsent,
});

function OAuthConsent() {
  const { authorization_id: authorizationId } = Route.useSearch();
  const { session, loading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authorizationId || loading || !session) return;
    let active = true;

    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: requestError }) => {
      if (!active) return;
      if (requestError || !data) {
        setError(requestError?.message ?? "This sign-in request is no longer valid. Return to Z Games and try again.");
        return;
      }
      const authorization = data as AuthorizationDetails;
      if (!authorization.authorization_id && authorization.redirect_url) {
        window.location.replace(authorization.redirect_url);
        return;
      }
      setDetails(authorization);
    }).catch(() => {
      if (active) setError("Could not load the Z Games sign-in request. Please try again.");
    });

    return () => { active = false; };
  }, [authorizationId, loading, session]);

  const decide = async (approve: boolean) => {
    if (!authorizationId) return;
    setBusy(true);
    setError("");
    try {
      const result = approve
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (result.error) {
        setError(result.error.message);
        setBusy(false);
        return;
      }
      window.location.assign(result.data.redirect_url);
    } catch {
      setError("Could not complete the sign-in request. Please try again.");
      setBusy(false);
    }
  };

  const loginHref = `/?oauth_authorization_id=${encodeURIComponent(authorizationId)}`;

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom flex min-h-screen items-center justify-center px-5 py-10">
      <section className="surface-panel w-full max-w-md rounded-3xl p-7 shadow-lift sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary font-display text-lg font-extrabold text-primary-foreground">Z</span>
          <div><p className="text-sm text-muted-foreground">Secure sign-in</p><h1 className="text-xl font-bold">ZChat</h1></div>
        </div>
        {!authorizationId ? <p role="alert" className="text-sm text-destructive">This sign-in request is missing its authorization ID. Return to Z Games and try again.</p>
          : loading ? <p className="text-sm text-muted-foreground">Checking your ZChat account…</p>
          : !session ? <>
            <h2 className="text-2xl font-bold">Continue with ZChat</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to ZChat first. If you already have a ZChat session, choose continue and you’ll return to approve the Z Games connection.</p>
            <Button asChild className="mt-6 w-full"><a href={loginHref}>Continue to ZChat login</a></Button>
          </>
          : error ? <>
            <h2 className="text-2xl font-bold">Can’t connect right now</h2>
            <p role="alert" className="mt-3 text-sm leading-6 text-destructive">{error}</p>
            <Button asChild variant="outline" className="mt-6 w-full"><a href="https://z-chat.men/">Return to ZChat</a></Button>
          </>
          : !details ? <p className="text-sm text-muted-foreground">Loading the Z Games request…</p>
          : <>
            <h2 className="text-2xl font-bold">Connect Z Games?</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">{details.client?.name ?? "An app"}</strong> is requesting access to your ZChat account.</p>
            {details.scope && <div className="mt-5 rounded-xl bg-surface-2 p-4">
              <p className="text-sm font-semibold">Information requested</p>
              <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                {details.scope.split(" ").filter(Boolean).map((scope) => <li key={scope}>{scope === "email" ? "Your email address" : scope === "profile" ? "Your profile name and avatar" : scope}</li>)}
              </ul>
            </div>}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">You can revoke this connection later from your account’s authorized apps.</p>
            {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>Deny</Button>
              <Button onClick={() => void decide(true)} disabled={busy}>{busy ? "Connecting…" : "Approve"}</Button>
            </div>
          </>}
      </section>
    </main>
  );
}

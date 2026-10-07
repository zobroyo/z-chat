import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, PhoneCall, ShieldCheck } from "lucide-react";

import { CallOverlay } from "@/components/call/CallOverlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCall } from "@/hooks/use-call";
import { createCallGuestClient, randomGuestName, randomLocalGuestId } from "@/lib/call-guest";

/*
 * Guest join page: https://z-chat.men/call/<conversationId>?k=<guestKey>
 *
 * Guests get an isolated Supabase client (`persistSession: false`) and are
 * scoped to exactly one Realtime channel — the invited call. They never touch
 * app tables, so even with a session they cannot use any other Z Chat feature.
 *
 * Preferred auth is Supabase anonymous sign-in; when the project has anonymous
 * sign-ins disabled the page falls back to a locally generated guest identity
 * and joins with the publishable key (the same key every browser already has).
 * To enable anonymous sign-ins: Supabase dashboard -> Authentication ->
 * Sign In / Providers -> enable "Anonymous sign-ins" (or Management API PATCH
 * /v1/projects/{ref}/config/auth with external_anonymous_users_enabled=true).
 */

export const Route = createFileRoute("/call/$conversationId")({
  validateSearch: (search: Record<string, unknown>): { k?: string } => {
    const value = search["k"];
    return typeof value === "string" && value.length > 0 ? { k: value } : {};
  },
  head: () => ({
    meta: [
      { title: "Join call — ZChat" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GuestCallPage,
});

type GuestIdentity = { id: string; name: string };

function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ios-safe-top ios-safe-bottom flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function GuestCallPage() {
  const { conversationId } = Route.useParams();
  const { k } = Route.useSearch();

  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const guestClient = createCallGuestClient();
      if (!guestClient) {
        if (!cancelled) {
          setError("This call link can't be opened right now.");
          setBusy(false);
        }
        return;
      }

      let id = randomLocalGuestId();
      try {
        // Preferred path. If the project disables anonymous sign-ins this
        // returns an error and the guest continues without a session — the
        // call channel is the only Supabase surface this page ever touches.
        const { data, error: authError } = await guestClient.auth.signInAnonymously();
        if (!authError && data.user) id = data.user.id;
      } catch {
        // Fall back to the local guest identity.
      }

      if (cancelled) return;
      const name = randomGuestName();
      setClient(guestClient);
      setIdentity({ id, name });
      setDisplayName(name);
      setBusy(false);
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, []);

  if (busy) {
    return (
      <GuestShell>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Preparing guest access…</p>
        </div>
      </GuestShell>
    );
  }

  if (error || !client || !identity) {
    return (
      <GuestShell>
        <div className="rounded-3xl border border-border bg-surface p-6 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <p className="mt-3 text-sm text-foreground">{error ?? "This call link can't be opened."}</p>
        </div>
      </GuestShell>
    );
  }

  if (!joined) {
    const finalName = displayName.trim() || identity.name;
    return (
      <GuestShell>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-2xl">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <PhoneCall className="size-5" />
          </span>

          <h1 className="mt-4 text-center font-display text-lg font-semibold text-foreground">
            You&apos;ve been invited to a Z Chat call
          </h1>
          <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
            Join as a guest. You can only take part in this call — no account required.
          </p>

          <label
            htmlFor="guest-name"
            className="mt-5 block text-xs font-medium text-muted-foreground"
          >
            Display name
          </label>
          <Input
            id="guest-name"
            value={displayName}
            maxLength={40}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1.5"
          />

          <Button
            type="button"
            className="mt-4 w-full bg-green-600 text-white hover:bg-green-500"
            onClick={() => {
              setIdentity({ id: identity.id, name: finalName });
              setJoined(true);
            }}
          >
            <PhoneCall className="mr-2 size-4" />
            Join call as {finalName}
          </Button>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Your browser will ask for microphone access. Guest links only work for this one call.
          </p>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestCallRoom
      client={client}
      conversationId={conversationId}
      guestKey={k ?? null}
      identity={identity}
      onExit={() => setJoined(false)}
    />
  );
}

function GuestCallRoom({
  client,
  conversationId,
  guestKey,
  identity,
  onExit,
}: {
  client: SupabaseClient;
  conversationId: string;
  guestKey: string | null;
  identity: GuestIdentity;
  onExit: () => void;
}) {
  const call = useCall(conversationId, identity, {
    client,
    guest: true,
    guestKey,
    listenForIncoming: false,
  });

  const [ended, setEnded] = useState(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    void call.joinCall();
    // Join once on mount; `call.joinCall` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (call.inCall) wasActiveRef.current = true;
    if (wasActiveRef.current && !call.inCall && !call.joining) setEnded(true);
  }, [call.inCall, call.joining]);

  const failed = !call.inCall && !call.joining && !!call.error;

  if (failed) {
    return (
      <GuestShell>
        <div className="rounded-3xl border border-border bg-surface p-6 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <p className="mt-3 text-sm text-foreground">{call.error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={onExit}>
              Back
            </Button>
            <Button type="button" onClick={() => void call.joinCall()}>
              Try again
            </Button>
          </div>
        </div>
      </GuestShell>
    );
  }

  if (ended) {
    return (
      <GuestShell>
        <div className="rounded-3xl border border-border bg-surface p-6 text-center">
          <PhoneCall className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-display text-base font-semibold text-foreground">Call ended</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You left the call as {identity.name}.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={onExit}>
              Change name
            </Button>
            <Button
              type="button"
              onClick={() => {
                wasActiveRef.current = false;
                setEnded(false);
                void call.joinCall();
              }}
            >
              Rejoin
            </Button>
          </div>
        </div>
      </GuestShell>
    );
  }

  return <CallOverlay call={call} conversationTitle="Guest call" />;
}

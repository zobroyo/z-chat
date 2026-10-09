import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

import { Z_SERVICES } from "./services";

/** Full-viewport host for a Z service: slim top bar + frameless iframe.
    The service keeps its own login; z-chat.men and game./present./access.
    z-chat.men are same-site, so their cookies keep working in the frame. */
export const Route = createFileRoute("/app/$service")({
  head: ({ params }) => {
    const service = Z_SERVICES.find((entry) => entry.slug === params.service);
    return { meta: [{ title: `${service ? service.name : "Z service"} — ZChat` }] };
  },
  component: ServiceFramePage,
});

function ServiceFramePage() {
  const { service } = Route.useParams();
  const { session, loading: authLoading } = useAuth();
  const entry = Z_SERVICES.find((item) => item.slug === service);
  if (!entry) return <Navigate to="/services" replace />;

  /* The service needs a Z Chat session for its consent flow. When signed out,
     sign in on the top-level page first: Google blocks its sign-in screen
     inside frames, so the login must not happen in the iframe. */
  if (authLoading) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!session) {
    return (
      <main className="standalone-scroll-page ios-safe-top ios-safe-bottom flex min-h-screen items-center justify-center px-5 py-10">
        <section className="surface-panel w-full max-w-sm rounded-3xl p-7 text-center shadow-lift">
          <h1 className="text-xl font-bold">Sign in to Z Chat</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {entry.name} is tied to your Z Chat account. Sign in first, then it opens right here.
          </p>
          <Button
            className="mt-6 w-full"
            onClick={() => {
              window.location.assign(
                `/?zoauth_next=${encodeURIComponent(window.location.pathname)}`,
              );
            }}
          >
            Continue to Z Chat login
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <header className="ios-safe-top flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <Link
          to="/services"
          aria-label="Back to all Z services"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">All services</span>
        </Link>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-foreground sm:text-left">
          {entry.name}
        </span>
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          title={`Open ${entry.name} in a new tab`}
        >
          <span className="hidden sm:inline">Open in new tab</span>
          <ExternalLink className="size-3.5" />
        </a>
      </header>
      <iframe
        src={entry.url}
        title={entry.name}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </main>
  );
}

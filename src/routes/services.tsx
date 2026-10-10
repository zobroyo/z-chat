import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  CreditCard,
  Gamepad2,
  MonitorDown,
  Presentation,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { DownloadButton } from "@/components/DownloadDialog";

export const Route = createFileRoute("/services")({
  head: () => ({ meta: [{ title: "All Z services — ZChat" }] }),
  component: ServicesPage,
});

/** Everything reachable from the hub. `slug` is the /app/$service parameter;
    the services themselves are embedded in a full-viewport frame there. */
export const Z_SERVICES = [
  {
    slug: "games",
    name: "Z Games",
    url: "https://game.z-chat.men",
    description: "The game library — over a thousand titles, every one hosted on the Z Chat box.",
    icon: Gamepad2,
  },
  {
    slug: "slides",
    name: "Z Slides",
    url: "https://present.z-chat.men",
    description: "Turn a short brief into a finished presentation, exported straight to Canva.",
    icon: Presentation,
  },
  {
    slug: "console",
    name: "Z Admin Console",
    url: "https://access.z-chat.men",
    description: "Ops dashboard for the box — service health, deploy log, restarts. Admins only.",
    icon: ShieldCheck,
  },
] as const;

function ServicesPage() {
  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-3xl px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Link
          to="/chat"
          aria-label="Back to chats"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">All Z services</h1>
          <p className="text-xs text-muted-foreground">
            One account for everything on the Z Chat box. Services open right here.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {Z_SERVICES.map((service) => (
          <Link
            key={service.slug}
            to="/app/$service"
            params={{ service: service.slug }}
            className="surface-panel group flex min-h-44 flex-col rounded-2xl p-5 shadow-lift transition-transform hover:scale-[1.01]"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <service.icon className="size-6" />
            </span>
            <span className="mt-4 block font-display text-lg font-bold text-foreground">
              {service.name}
            </span>
            <span className="mt-1 block flex-1 text-xs leading-5 text-muted-foreground">
              {service.description}
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              Open
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}

        <Link
          to="/ask"
          className="surface-panel group flex min-h-44 flex-col rounded-2xl p-5 shadow-lift transition-transform hover:scale-[1.01]"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-6" />
          </span>
          <span className="mt-4 block font-display text-lg font-bold text-foreground">
            Stuck? Get the answer
          </span>
          <span className="mt-1 block flex-1 text-xs leading-5 text-muted-foreground">
            Type a question, get the full working and the answer. Included with Pro and Max.
          </span>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            Open
            <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <Link
          to="/lunch-card"
          className="surface-panel group flex min-h-44 flex-col rounded-2xl p-5 shadow-lift transition-transform hover:scale-[1.01]"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CreditCard className="size-6" />
          </span>
          <span className="mt-4 block font-display text-lg font-bold text-foreground">
            Custom lunch card
          </span>
          <span className="mt-1 block flex-1 text-xs leading-5 text-muted-foreground">
            Your two photos on a card — 35 AED, 2 month warranty. Pick, crop, preview and pay right
            here.
          </span>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            Order
            <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <DownloadButton className="surface-panel group flex min-h-44 flex-col rounded-2xl p-5 text-left shadow-lift transition-transform hover:scale-[1.01]">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MonitorDown className="size-6" />
          </span>
          <span className="mt-4 block font-display text-lg font-bold text-foreground">Download</span>
          <span className="mt-1 block flex-1 text-xs leading-5 text-muted-foreground">
            Get Z Chat on Windows, or install it as an app on iPhone and Android. macOS is coming
            soon.
          </span>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            Download
            <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </DownloadButton>
      </div>
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Gamepad2,
  MonitorDown,
  Presentation,
  ShieldCheck,
} from "lucide-react";

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

const DOWNLOAD_URL = "https://z-chat.men/media/downloads/ZChat-windows.zip?v=1";
const EXE_URL = "https://z-chat.men/media/downloads/ZChat.exe?v=1";

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

        <section className="surface-panel flex min-h-44 flex-col rounded-2xl p-5 shadow-lift">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MonitorDown className="size-6" />
          </span>
          <span className="mt-4 block font-display text-lg font-bold text-foreground">Downloads</span>
          <span className="mt-1 block flex-1 text-xs leading-5 text-muted-foreground">
            ZChat for Windows — the desktop app, same chats in a native window. No installer: unzip
            and run.
          </span>
          <span className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={DOWNLOAD_URL}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="size-3.5" />
              Windows ZIP
            </a>
            <a
              href={EXE_URL}
              className="text-xs underline underline-offset-2 hover:text-foreground"
            >
              just ZChat.exe
            </a>
          </span>
        </section>
      </div>
    </main>
  );
}

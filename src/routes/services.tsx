import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Gamepad2, MessageSquare, Presentation, Server, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/services")({
  head: () => ({ meta: [{ title: "Z services — ZChat" }] }),
  component: ServicesPage,
});

const SERVICES = [
  {
    name: "Z Chat",
    url: "https://z-chat.men",
    description: "The main messenger — DMs, groups, calls, moderation and your profile.",
    icon: MessageSquare,
  },
  {
    name: "Z Games",
    url: "https://game.z-chat.men",
    description: "1,300+ mirrored browser games. Sign in with your Z Chat account to play.",
    icon: Gamepad2,
  },
  {
    name: "Z Slides",
    url: "https://present.z-chat.men",
    description: "AI presentation maker — decks are created straight into your Canva account.",
    icon: Presentation,
  },
  {
    name: "Black Box MCP",
    url: "https://mcp.z-chat.men/healthz",
    description: "Assistant access endpoint for the black box services (token required).",
    icon: Server,
  },
  {
    name: "Z Admin Console",
    url: "https://access.z-chat.men",
    description: "Ops dashboard for the black box — service health, deploy log, restarts. Admins only.",
    icon: ShieldCheck,
  },
] as const;

function ServicesPage() {
  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-md px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Link
          to="/chat"
          aria-label="Back to chats"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">All Z services</h1>
          <p className="text-xs text-muted-foreground">Everything Z Chat runs — one account, all of it.</p>
        </div>
      </div>

      <div className="space-y-3">
        {SERVICES.map((service) => (
          <a
            key={service.name}
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="surface-panel flex items-center gap-3 rounded-2xl p-4 shadow-lift transition-transform hover:scale-[1.01]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <service.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">{service.name}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {service.description}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    </main>
  );
}

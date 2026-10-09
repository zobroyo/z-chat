import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/use-auth";
import {
  useQuickTunnelGate,
  QuickTunnelHandoff,
  QUICK_TUNNEL_BOOT_SCRIPT,
} from "@/hooks/use-quick-tunnel-handoff";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider, themeBootScript } from "@/components/theme/ThemeProvider";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "ZChat" },
      { name: "description", content: "Fast, private messaging with friends and groups." },
      { name: "theme-color", content: "#0b0b0d" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Z Chat" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "ZChat" },
      { property: "og:title", content: "ZChat" },
      { property: "og:description", content: "Fast, private messaging with friends and groups." },
      { property: "og:image", content: "https://z-chat.men/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:url", content: "https://z-chat.men/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ZChat" },
      { name: "twitter:description", content: "Fast, private messaging with friends and groups." },
      { name: "twitter:image", content: "https://z-chat.men/og-image.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/z-180.png" },
      { rel: "canonical", href: "https://z-chat.men/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: QUICK_TUNNEL_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/*
 * Blocks every locked host (e.g. the rotating d-*.z-chat.men quick tunnels)
 * until the gate hook allows the visit. Rendering no children means no route
 * content and no login UI exists on those hosts for a raw visitor.
 */
function QuickTunnelGate({ children }: { children: ReactNode }) {
  const allowed = useQuickTunnelGate();
  if (!allowed) {
    return (
      <div aria-hidden="true" className="grid min-h-screen w-full place-items-center bg-[#0b0b0d]">
        <span className="font-display text-5xl font-extrabold text-white/10 select-none before:content-['Z']" />
      </div>
    );
  }
  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Kept mounted even while the gate blocks, so a #zt= handoff is always
            consumed and stripped from the URL. */}
        <QuickTunnelHandoff />
        <QuickTunnelGate>
          <AuthProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <Toaster position="top-center" />
          </AuthProvider>
        </QuickTunnelGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

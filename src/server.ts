import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleDeployHookRoute } from "./lib/serverDeployHook";
import { handleLinkPreviewRoute } from "./lib/serverLinkPreview";
import { handleModerateRoute, handleSendMessageRoute } from "./lib/serverModeration";
import { handleQuickTunnelPublicRoute, handleSiteTunnelsRoute } from "./lib/serverTunnels";
import { handleTurnCredentialsRoute } from "./lib/serverTurnCredentials";
import {
  handleLunchCardCheckoutRoute,
  handleLunchCardConfirmRoute,
  handleStripeCheckoutRoute,
  handleStripePortalRoute,
  handleStripeWebhookRoute,
} from "./lib/serverStripe";
import {
  handleAdminPushRoute,
  handleApprovalPushRoute,
  handleCallPushRoute,
  handlePushPublicKeyRoute,
  handleTestPushRoute,
} from "./lib/serverPush";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Cache policy.
 *
 * The SSR document MUST NOT be cached: after a deploy the old HTML references
 * hashed JS chunks that no longer exist, so the browser dead-ends on the
 * server error page (the iOS "This page didn't load" bug — clearing browsing
 * data "fixed" it only because it forced a fresh fetch). Content-hashed
 * `/assets/*` files are safe to cache forever; the SW and manifest must be
 * revalidated so updates take effect.
 */
function applyCacheHeaders(request: Request, response: Response): Response {
  const pathname = new URL(request.url).pathname;
  const headers = new Headers(response.headers);
  const type = (headers.get("content-type") ?? "").toLowerCase();

  if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (type.includes("text/html")) {
    // Always revalidate the document (and never store it) so a deploy can't
    // leave a stale shell pointing at removed chunks.
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  } else if (pathname === "/sw.js" || pathname.endsWith("/sw.js") || pathname === "/manifest.webmanifest") {
    headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (url.pathname === "/api/deploy-hook") {
      try {
        return await handleDeployHookRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/link-preview") {
      try {
        return await handleLinkPreviewRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ preview: null }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/moderate" || url.pathname === "/api/send-message") {
      try {
        return url.pathname === "/api/moderate"
          ? await handleModerateRoute(request)
          : await handleSendMessageRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname.startsWith("/api/push")) {
      try {
        if (url.pathname === "/api/push-public-key") {
          return await handlePushPublicKeyRoute(request);
        }
        if (url.pathname === "/api/push/approval") {
          return await handleApprovalPushRoute(request);
        }
        if (url.pathname === "/api/push/test") {
          return await handleTestPushRoute(request);
        }
        if (url.pathname === "/api/push/admins") {
          return await handleAdminPushRoute(request);
        }
        if (url.pathname === "/api/push/call") {
          return await handleCallPushRoute(request);
        }
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/admin/site-tunnels") {
      try {
        return await handleSiteTunnelsRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/quick-tunnel") {
      try {
        return await handleQuickTunnelPublicRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ zchat: { enabled: false, url: "" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/turn-credentials") {
      try {
        return await handleTurnCredentialsRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ iceServers: [] }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/lunch-card/checkout") {
      return await handleLunchCardCheckoutRoute(request);
    }

    if (url.pathname === "/api/lunch-card/confirm") {
      return await handleLunchCardConfirmRoute(request);
    }

    if (url.pathname === "/api/stripe/checkout" || url.pathname === "/api/stripe/portal" || url.pathname === "/api/stripe/webhook") {
      try {
        if (url.pathname === "/api/stripe/checkout") return await handleStripeCheckoutRoute(request);
        if (url.pathname === "/api/stripe/portal") return await handleStripePortalRoute(request);
        return await handleStripeWebhookRoute(request);
      } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return applyCacheHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return applyCacheHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};

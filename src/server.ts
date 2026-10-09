import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleDeployHookRoute } from "./lib/serverDeployHook";
import { handleLinkPreviewRoute } from "./lib/serverLinkPreview";
import { handleModerateRoute, handleSendMessageRoute } from "./lib/serverModeration";
import { handleQuickTunnelPublicRoute, handleSiteTunnelsRoute } from "./lib/serverTunnels";
import { handleTurnCredentialsRoute } from "./lib/serverTurnCredentials";
import {
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
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

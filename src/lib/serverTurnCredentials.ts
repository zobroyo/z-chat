import { readFile } from "node:fs/promises";

import { json } from "./serverModeration";

/*
 * Cloudflare global TURN credentials.
 *
 * International calls (both sides behind NAT/CGNAT) need a relay. The
 * self-hosted coturn on the box handles LAN and well-connected cases, but the
 * home router only exposes its control port, not the UDP relay range, so the
 * world-wide path is Cloudflare's TURN service instead: global anycast,
 * per-session credentials, and TLS-443 endpoints that pass through almost
 * every network.
 *
 * The TURN key (Cloudflare Calls -> TURN) lives in
 * /srv/zchat/state/cf-turn.json on the box (0600, zchat). Credentials are
 * minted per request from the key and cached here until shortly before they
 * expire.
 */

const KEY_FILE = process.env["ZCHAT_CF_TURN_FILE"] || "/srv/zchat/state/cf-turn.json";
const TTL_SECONDS = 60 * 60;
const CACHE_MS = (TTL_SECONDS - 300) * 1000;

type IceServer = { urls: string | string[]; username?: string; credential?: string };
let cache: { iceServers: IceServer[]; at: number } | null = null;

export async function handleTurnCredentialsRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, request);

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return json({ iceServers: cache.iceServers, cached: true }, 200, request);
  }

  try {
    const raw = await readFile(KEY_FILE, "utf8");
    const parsed = JSON.parse(raw) as { key_id?: unknown; secret?: unknown };
    const keyId = typeof parsed.key_id === "string" ? parsed.key_id : "";
    const secret = typeof parsed.secret === "string" ? parsed.secret : "";
    if (!keyId || !secret) throw new Error("turn key not configured");

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error(`turn credentials failed: ${response.status}`);

    const data = (await response.json()) as { iceServers?: unknown };
    const list = Array.isArray(data.iceServers) ? (data.iceServers as IceServer[]) : [];
    const iceServers = list.filter(
      (entry) => entry && (typeof entry.urls === "string" || Array.isArray(entry.urls)),
    );
    if (!iceServers.length) throw new Error("empty iceServers");

    cache = { iceServers, at: Date.now() };
    return json({ iceServers, cached: false }, 200, request);
  } catch (error) {
    console.error("[turn-credentials]", error);
    return json({ iceServers: [] }, 200, request);
  }
}

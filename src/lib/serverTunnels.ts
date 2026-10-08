import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { authenticate, corsPreflight, json } from "./serverModeration";

/*
 * Quick-tunnel admin API.
 *
 * Each site can optionally be served through a Cloudflare quick tunnel
 * (https://<random>.trycloudflare.com, rotated daily by a systemd timer on the
 * black box). The box-side redirectors read /srv/zchat/state/quicktunnels.json
 * and either 302 the main domain to the quick URL or proxy normally; auth
 * paths never redirect because OAuth clients are bound to the main domain.
 *
 * This route only flips the `enabled` flag in that state file. All writes go
 * through state_tool.py on the box, which serialises with the rotation script.
 */

const execFileAsync = promisify(execFile);

const STATE_FILE =
  process.env["ZCHAT_QUICKTUNNEL_STATE"] || "/srv/zchat/state/quicktunnels.json";
const STATE_TOOL =
  process.env["ZCHAT_QUICKTUNNEL_TOOL"] || "/srv/zchat/quicktunnels/state_tool.py";

export const QUICK_TUNNEL_SITES = ["zchat", "games", "slides"] as const;
export type QuickTunnelSite = (typeof QUICK_TUNNEL_SITES)[number];

export type QuickTunnelEntry = { enabled: boolean; url: string; updatedAt: string };
export type QuickTunnelState = Record<QuickTunnelSite, QuickTunnelEntry>;

function emptyState(): QuickTunnelState {
  return {
    zchat: { enabled: false, url: "", updatedAt: "" },
    games: { enabled: false, url: "", updatedAt: "" },
    slides: { enabled: false, url: "", updatedAt: "" },
  };
}

function normalizeEntry(value: unknown): QuickTunnelEntry {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: record["enabled"] === true,
    url: typeof record["url"] === "string" ? record["url"] : "",
    updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : "",
  };
}

export async function readQuickTunnelState(): Promise<QuickTunnelState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const state = emptyState();
    for (const site of QUICK_TUNNEL_SITES) state[site] = normalizeEntry(record[site]);
    return state;
  } catch {
    return emptyState();
  }
}

function isQuickTunnelSite(value: unknown): value is QuickTunnelSite {
  return typeof value === "string" && (QUICK_TUNNEL_SITES as readonly string[]).includes(value);
}

async function writeQuickTunnelEnabled(site: QuickTunnelSite, enabled: boolean): Promise<void> {
  await execFileAsync(
    "/usr/bin/python3",
    [STATE_TOOL, "set-enabled", site, enabled ? "true" : "false"],
    { timeout: 5000 },
  );
}

export async function handleSiteTunnelsRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  // Admin check runs through the caller's RLS-scoped client: the database
  // decides who may read profiles.is_admin.
  const { data, error } = await auth.client
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || data?.is_admin !== true) {
    return json({ error: "Admins only" }, 403, request);
  }

  if (request.method === "GET") {
    return json({ sites: await readQuickTunnelState() }, 200, request);
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "GET, POST, OPTIONS" } });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, request);
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const site = record["site"];
  const enabled = record["enabled"];
  if (!isQuickTunnelSite(site) || typeof enabled !== "boolean") {
    return json(
      { error: "site must be one of zchat|games|slides and enabled must be a boolean" },
      400,
      request,
    );
  }

  try {
    await writeQuickTunnelEnabled(site, enabled);
  } catch (writeError) {
    console.error("[site-tunnels] failed to update quick tunnel state", writeError);
    return json({ error: "Could not update quick tunnel state" }, 500, request);
  }

  return json({ sites: await readQuickTunnelState() }, 200, request);
}

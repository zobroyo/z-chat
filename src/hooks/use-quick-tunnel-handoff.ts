import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/*
 * Quick-tunnel session handoff.
 *
 * SEND (main domain only): once the tab has a Supabase session, send the
 * browser to the current zchat quick tunnel URL with the session tokens in the
 * URL hash (#zt=<base64url({a,r})>). Hash fragments never reach a server, so
 * the tokens are only readable by the app on the quick domain, and the hash is
 * stripped from the URL bar before the receive side does anything else.
 *
 * RECEIVE (any origin): if the URL carries a #zt= payload, restore the session
 * with setSession and strip the fragment immediately, even when the tokens are
 * fake or expired. Errors stay silent — the login screen is the fallback.
 */

const HANDOFF_HOSTS = new Set(["z-chat.men", "www.z-chat.men"]);
const STAY_KEY = "qt-stay";

type HandoffTokens = { accessToken: string; refreshToken: string };

type HandoffFlags = {
  /* One send attempt per page load; a failed config fetch stays put. */
  attempted: boolean;
  /* This load consumed a #zt= payload; never bounce straight back out. */
  received: boolean;
};

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripHash(): void {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

/*
 * Synchronous read: parse the hash, strip it from the URL bar/history before
 * any await, and return the tokens. Returns null (hash already stripped) when
 * the payload is missing or malformed.
 */
function readHandoffHash(): HandoffTokens | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const payload = new URLSearchParams(hash.slice(1)).get("zt");
  if (!payload) return null;

  stripHash();

  try {
    const parsed: unknown = JSON.parse(fromBase64Url(payload));
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const accessToken = typeof record["a"] === "string" ? record["a"] : "";
    const refreshToken = typeof record["r"] === "string" ? record["r"] : "";
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

function isStayOptOut(url: URL): boolean {
  if (url.searchParams.get("stay") === "1") {
    try {
      sessionStorage.setItem(STAY_KEY, "1");
    } catch {
      // Private-mode storage failures just mean no opt-out is remembered.
    }
    return true;
  }
  try {
    return sessionStorage.getItem(STAY_KEY) !== null;
  } catch {
    return false;
  }
}

async function maybeSendHandoff(session: Session | null, flags: HandoffFlags): Promise<void> {
  if (!session || flags.attempted || flags.received) return;
  if (!HANDOFF_HOSTS.has(window.location.hostname.toLowerCase())) return;

  const url = new URL(window.location.href);
  if (isStayOptOut(url)) return;
  // OAuth / consent / recovery flows must finish on the main domain.
  if (url.pathname.startsWith("/oauth") || url.pathname.startsWith("/recovery")) return;
  if (url.searchParams.has("zoauth_next")) return;

  flags.attempted = true;
  try {
    const response = await fetch("/api/quick-tunnel", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return;

    const data: unknown = await response.json();
    const zchat =
      data && typeof data === "object" ? (data as Record<string, unknown>)["zchat"] : null;
    const entry = zchat && typeof zchat === "object" ? (zchat as Record<string, unknown>) : null;
    if (entry?.["enabled"] !== true) return;

    const quickUrl = typeof entry["url"] === "string" ? entry["url"] : "";
    if (!quickUrl.startsWith("https://")) return;

    const base = quickUrl.replace(/\/+$/, "");
    const fragment = toBase64Url(
      JSON.stringify({ a: session.access_token, r: session.refresh_token }),
    );
    console.info("[quick-tunnel] handing off to quick tunnel");
    window.location.replace(`${base}/#zt=${fragment}`);
  } catch {
    // Config fetch failed: stay on the main domain silently.
  }
}

export function useQuickTunnelHandoff(): void {
  useEffect(() => {
    const flags: HandoffFlags = { attempted: false, received: false };

    const handoff = readHandoffHash();
    if (handoff) {
      flags.received = true;
      console.info("[quick-tunnel] received handoff, restoring session");
      void supabase.auth
        .setSession({
          access_token: handoff.accessToken,
          refresh_token: handoff.refreshToken,
        })
        .catch(() => undefined);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void maybeSendHandoff(session, flags);
    });

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        void maybeSendHandoff(data.session, flags);
      })
      .catch(() => undefined);

    return () => subscription.unsubscribe();
  }, []);
}

export function QuickTunnelHandoff() {
  useQuickTunnelHandoff();
  return null;
}

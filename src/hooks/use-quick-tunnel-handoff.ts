import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/*
 * Quick-tunnel session handoff + locked-host gate.
 *
 * SEND (main domain only): once the tab has a Supabase session, send the
 * browser to the current zchat quick tunnel URL with the session tokens in the
 * URL hash (#zt=<base64url({a,r})>). Hash fragments never reach a server, so
 * the tokens are only readable by the app on the quick domain, and the hash is
 * stripped from the URL bar before the receive side does anything else.
 *
 * RECEIVE (any origin): if the URL carries a #zt= payload, restore the session
 * with setSession and strip the fragment immediately, even when the tokens are
 * fake or expired. Errors stay silent. A successful restore also sets a
 * sessionStorage marker so reloads of the quick origin stay unlocked.
 *
 * GATE (locked hosts only): any hostname outside the main allowlist is
 * "locked" — this includes the rotating d-*.z-chat.men quick tunnels. A locked
 * visitor only gets the app when this load carried a #zt= handoff, the tab
 * already has the session marker, or a local Supabase session can be restored.
 * Otherwise no route content (and therefore no login UI) ever renders: a blank
 * dark page is shown instead. Main-domain behavior is unchanged.
 */

/* Hosts that serve the real app directly; the login lives only on these. */
const MAIN_HOSTS = new Set(["z-chat.men", "www.z-chat.men", "jorking-lord"]);
const JORKING_SUFFIX = ".jorking-lord";
/* The send side deliberately stays on the public domains. */
const HANDOFF_HOSTS = new Set(["z-chat.men", "www.z-chat.men"]);
const STAY_KEY = "qt-stay";
const SESSION_OK_KEY = "zt-ok";

type HandoffTokens = { accessToken: string; refreshToken: string };

type HandoffFlags = {
  /* One send attempt per page load; a failed config fetch stays put. */
  attempted: boolean;
  /* This load consumed a #zt= payload; never bounce straight back out. */
  received: boolean;
};

export function isMainHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return MAIN_HOSTS.has(host) || host.endsWith(JORKING_SUFFIX);
}

function hostnameFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

/*
 * Inline boot script for <head>. On a locked host the matched route's own
 * document title (e.g. "ZChat — Sign in") would hint at a login form that must
 * not exist there, so rewrite it to the neutral app title before the app boots.
 */
export const QUICK_TUNNEL_BOOT_SCRIPT = `(() => {
  try {
    const host = window.location.hostname.toLowerCase();
    const mainHosts = ${JSON.stringify(Array.from(MAIN_HOSTS))};
    const suffix = ${JSON.stringify(JORKING_SUFFIX)};
    if (!mainHosts.includes(host) && !host.endsWith(suffix)) document.title = "ZChat";
  } catch {}
})();`;

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

/* Presence only; the value is never read. */
function markSessionOk(): void {
  try {
    sessionStorage.setItem(SESSION_OK_KEY, "1");
  } catch {
    // Private-mode storage failures just mean the marker is not remembered.
  }
}

function hasSessionOk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SESSION_OK_KEY) !== null;
  } catch {
    return false;
  }
}

function hasHandoffHash(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  if (!hash) return false;
  return new URLSearchParams(hash.slice(1)).has("zt");
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
        .then(({ error }) => {
          if (!error) markSessionOk();
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

/*
 * Early gate state for locked hosts. `router.origin` is the request origin
 * during SSR and `window.origin` on the client, so `locked` agrees across
 * hydration and the first client render reproduces the server's decision
 * exactly. For a locked host `allowed` starts false (the caller renders a blank
 * page) and is resolved in the effect below; nothing app-like can render before
 * that resolution.
 */
export function useQuickTunnelGate(): boolean {
  const router = useRouter();
  const locked = !isMainHostname(hostnameFromOrigin(router.origin));
  const [allowed, setAllowed] = useState(!locked);
  /* Captured during the first render, before the handoff hook strips the hash. */
  const [sawHandoff] = useState(hasHandoffHash);

  useEffect(() => {
    if (!locked) return;
    let cancelled = false;

    if (sawHandoff || hasSessionOk()) {
      setAllowed(true);
      return;
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) {
          markSessionOk();
          setAllowed(true);
          return;
        }
        // Still blocked: the route's head (e.g. "ZChat — Sign in") was applied
        // during hydration, so neutralize it until the gate lets the app in.
        document.title = "ZChat";
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [locked, sawHandoff]);

  return allowed;
}

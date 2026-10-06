import { supabase } from "@/integrations/supabase/client";

// Device fingerprint used for ban-evasion prevention.
//
// Signals come only from the browser (no IP addresses): user agent/platform,
// language, timezone, screen, GPU and a canvas readback. They are hashed with
// SHA-256 so the raw values never leave the device. The hash is sent as
// `device_fingerprint` user metadata at signup, where handle_new_user()
// auto-bans new accounts whose fingerprint matches an already-banned profile.

function canvasSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 120, 30);
    ctx.fillStyle = "#069";
    ctx.fillText("ZChat-fingerprint <>", 2, 15);
    return canvas.toDataURL();
  } catch {
    return "no-canvas";
  }
}

function webglSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    if (!gl) return "no-webgl";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return `${String(vendor)}|${String(renderer)}`;
  } catch {
    return "no-webgl";
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getDeviceFingerprint(): Promise<string | null> {
  try {
    const uaData = (
      navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }
    ).userAgentData;

    const signals = {
      ua: navigator.userAgent,
      uaPlatform: uaData?.platform ?? null,
      uaMobile: uaData?.mobile ?? null,
      language: navigator.language ?? "",
      languages: (navigator.languages ?? []).join(","),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      availScreen: `${screen.availWidth}x${screen.availHeight}`,
      dpr: window.devicePixelRatio,
      platform: navigator.platform ?? "",
      cores: navigator.hardwareConcurrency ?? 0,
      touch: navigator.maxTouchPoints ?? 0,
      memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
      colorGamut: window.matchMedia("(color-gamut: p3)").matches
        ? "p3"
        : window.matchMedia("(color-gamut: srgb)").matches
          ? "srgb"
          : "unknown",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      canvas: canvasSignature(),
      webgl: webglSignature(),
    };

    return await sha256Hex(JSON.stringify(signals));
  } catch {
    return null;
  }
}

/**
 * Best-effort backfill: stores the current device fingerprint on the signed-in
 * profile when it is still NULL (accounts created before fingerprinting
 * existed). This closes the loop — a banned legacy account that logs in once
 * gets its fingerprint recorded, so a new signup from the same device is
 * auto-banned by handle_new_user().
 */
export async function recordDeviceFingerprint(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const fingerprint = await getDeviceFingerprint();
    if (!fingerprint) return;
    await supabase.rpc("backfill_device_fingerprint", { p_fingerprint: fingerprint });
  } catch {
    // Never block the app on fingerprinting.
  }
}

/**
 * Thin bridge to the Capacitor mobile shells (iOS + Android). Every call is a
 * no-op on the plain web, so the site behaves identically in a browser.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function plugin<T>(name: string): T | undefined {
  const plugins = capacitor()?.Plugins as Record<string, unknown> | undefined;
  return plugins?.[name] as T | undefined;
}

export function isNativeApp(): boolean {
  try {
    return Boolean(capacitor()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Light haptic on a tap (no-op on web). */
export async function hapticTap(): Promise<void> {
  const haptics = plugin<{ impact: (options: { style: string }) => Promise<void> }>("Haptics");
  try {
    await haptics?.impact?.({ style: "LIGHT" });
  } catch {
    /* ignore */
  }
}

/** Match the status bar to the current theme (light text on dark, vice versa). */
export async function applyStatusBar(mode: "light" | "dark"): Promise<void> {
  const statusBar = plugin<{
    setStyle: (options: { style: string }) => Promise<void>;
    setBackgroundColor: (options: { color: string }) => Promise<void>;
  }>("StatusBar");
  if (!statusBar) return;
  try {
    await statusBar.setStyle({ style: mode === "dark" ? "LIGHT" : "DARK" });
    await statusBar.setBackgroundColor?.({ color: mode === "dark" ? "#0b0d12" : "#ffffff" });
  } catch {
    /* ignore */
  }
}

/** Open a URL in the system browser (for OAuth that Apple/Google won't do in a WebView). */
export async function openInSystemBrowser(url: string): Promise<void> {
  const browser = plugin<{ open: (options: { url: string }) => Promise<void> }>("Browser");
  if (browser?.open) {
    await browser.open({ url });
    return;
  }
  window.location.assign(url);
}

export async function closeSystemBrowser(): Promise<void> {
  const browser = plugin<{ close: () => Promise<void> }>("Browser");
  try {
    await browser?.close?.();
  } catch {
    /* ignore */
  }
}

/** Fires with the deep-link URL when the app is opened by a custom scheme. */
export function onAppUrlOpen(handler: (url: string) => void): (() => void) | undefined {
  const app = plugin<{
    addListener: (event: string, cb: (info: { url: string }) => void) => { remove?: () => void } | undefined;
  }>("App");
  if (!app?.addListener) return undefined;
  const subscription = app.addListener("appUrlOpen", (info) => handler(info.url));
  return () => subscription?.remove?.();
}

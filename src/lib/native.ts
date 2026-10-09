/**
 * Thin bridge to the Capacitor iOS shell. The site is also a normal web app,
 * so every call here is a no-op when `window.Capacitor` is absent.
 *
 * Used to (a) request notification permission and (b) raise a local
 * notification when a call is ringing, so iOS shows a popup + sound alongside
 * the in-app ringtone.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

type LocalNotificationsPlugin = {
  checkPermissions: () => Promise<{ display?: string }>;
  requestPermissions: () => Promise<{ display?: string }>;
  schedule: (options: { notifications: Array<Record<string, unknown>> }) => Promise<unknown>;
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp(): boolean {
  try {
    return Boolean(capacitor()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function localNotifications(): LocalNotificationsPlugin | undefined {
  const plugins = capacitor()?.Plugins as Record<string, unknown> | undefined;
  return plugins?.["LocalNotifications"] as LocalNotificationsPlugin | undefined;
}

let askedThisSession = false;

/** Ask once per session; safe to call repeatedly. */
export async function requestNotificationPermission(): Promise<void> {
  const plugin = localNotifications();
  if (!plugin || askedThisSession) return;
  askedThisSession = true;
  try {
    const status = await plugin.checkPermissions();
    if (status?.display !== "granted") await plugin.requestPermissions();
  } catch {
    /* permission prompts are best-effort */
  }
}

/** Pop a device notification for an incoming call (iOS shell only). */
export async function notifyIncomingCall(callerName: string): Promise<void> {
  const plugin = localNotifications();
  if (!plugin) return;
  try {
    let status = await plugin.checkPermissions();
    if (status?.display !== "granted") status = await plugin.requestPermissions();
    if (status?.display !== "granted") return;
    await plugin.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title: "Incoming call",
          body: `${callerName || "Someone"} is calling you on Z Chat`,
          schedule: { at: new Date(Date.now() + 150) },
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

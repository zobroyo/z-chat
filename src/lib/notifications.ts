export type NotificationState = "unsupported" | "default" | "granted" | "denied";

console.log(
  "[notifications] VAPID public key loaded:",
  Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY),
);

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationState(): NotificationState {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission as NotificationState;
}

/** True when the app runs from the home screen instead of a browser tab. */
export function isInstalled() {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return Boolean(standalone || iosStandalone);
}

export function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

export function isTouchDevice() {
  if (typeof navigator === "undefined") return false;
  return isAppleTouchDevice() || /Android|Mobile|Tablet/i.test(navigator.userAgent);
}

/** Apple only allows notification permission once the app is on the home screen. */
export function needsHomeScreenFirst() {
  return isAppleTouchDevice() && !isInstalled();
}

export async function registerNotificationWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationState> {
  if (!notificationsSupported()) return "unsupported";
  await registerNotificationWorker();
  try {
    const result = await Notification.requestPermission();
    return result as NotificationState;
  } catch {
    return getNotificationState();
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Subscribes this device to push and saves it against the given user id. */
export async function subscribeToPush(userId: string, supabase: {
  from: (table: string) => {
    upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>;
  };
}) {
  const registration = await registerNotificationWorker();
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!registration || !vapidKey) return;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
  {
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  },
  { onConflict: "endpoint" },
);

if (error) {
  console.error("[notifications] Failed to save push subscription:", error);
  throw error;
}

console.log("[notifications] Push subscription saved successfully");}

export async function showChatNotification(title: string, body: string) {
  if (getNotificationState() !== "granted") return;
  const options: NotificationOptions = {
    body,
    icon: "/icons/z-512.png",
    badge: "/icons/z-512.png",
    tag: `z-chat-${title}`,
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through to the plain notification */
  }
  try {
    new Notification(title, options);
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
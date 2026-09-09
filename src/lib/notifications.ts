export type NotificationState = "unsupported" | "default" | "granted" | "denied";

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

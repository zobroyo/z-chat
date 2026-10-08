/**
 * Client-side web push helpers.
 *
 * The VAPID public key is served by the app at /api/push-public-key (the
 * private key never leaves the box), with VITE_VAPID_PUBLIC_KEY only as a
 * fallback for environments that build with it baked in.
 *
 * Integration for NotificationGate (one line):
 *   replace `subscribeToPush(userId, pushClient)` with
 *   `registerPushSubscription(userId)` imported from "@/lib/push".
 */
import { supabase } from "@/integrations/supabase/client";
import { getNotificationState, registerNotificationWorker } from "./notifications";

const PUBLIC_KEY_ENDPOINT = "/api/push-public-key";

let cachedPublicKey: string | null = null;

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Fetches the VAPID public key from the server, falling back to build config. */
export async function getPushPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;

  let serverKey: string | null = null;
  try {
    const response = await fetch(PUBLIC_KEY_ENDPOINT, {
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      const payload = (await response.json()) as { publicKey?: unknown };
      if (typeof payload.publicKey === "string" && payload.publicKey) {
        serverKey = payload.publicKey;
      }
    }
  } catch {
    /* fall back to the build-time key below */
  }

  const buildKey = (import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined) ?? null;
  const key = serverKey ?? buildKey;
  if (!key) throw new Error("Push notifications are not configured yet");
  cachedPublicKey = key;
  return key;
}

function subscriptionMatchesKey(subscription: PushSubscription, publicKey: string): boolean {
  const existing = subscription.options?.applicationServerKey;
  if (!existing) return true;
  return toBase64Url(new Uint8Array(existing)) === publicKey;
}

type PushClient = {
  from: (table: string) => {
    upsert: (
      row: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

// The generated client only knows the tables typed at build time; this helper
// needs a minimal upsert shape (same pattern as NotificationGate).
const pushDb = supabase as unknown as PushClient;

/**
 * Subscribes this device to web push and stores the subscription for the user.
 * Assumes Notification permission was already granted by the caller.
 * Throws on any failure so callers never treat alerts as enabled by mistake.
 */
export async function registerPushSubscription(userId: string): Promise<PushSubscription> {
  if (!userId) throw new Error("Not signed in");
  if (getNotificationState() !== "granted") {
    throw new Error("Notification permission is not granted");
  }

  const registration = await registerNotificationWorker();
  if (!registration) throw new Error("Service worker registration failed");
  if (!("pushManager" in registration)) {
    throw new Error("Push messaging is not supported in this browser");
  }

  const publicKey = await getPushPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscriptionMatchesKey(subscription, publicKey)) {
    // Left over from an older VAPID key: replace it so sends keep working.
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys["p256dh"] || !keys["auth"]) {
    throw new Error("Push subscription is incomplete");
  }

  const { error } = await pushDb.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: keys["p256dh"],
      auth: keys["auth"],
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message || "Could not save push subscription");

  return subscription;
}

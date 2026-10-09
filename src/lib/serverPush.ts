/**
 * Server-side web push (dependency-free VAPID / RFC 8291).
 *
 * Used by the admin UI when an application is approved: the browser calls
 * POST /api/push/approval with the applicant's user id, this module looks up
 * their push subscriptions (through an admin-only SECURITY DEFINER RPC) and
 * delivers a notification. Failure here must never break the approval itself,
 * so all send errors are swallowed and reported as counts.
 *
 * VAPID keys come from the box environment:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (optional)
 */
import { createECDH, createPrivateKey, randomBytes, sign } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

import { authenticate, corsPreflight, isRateLimited, json } from "./serverModeration";
import type { UserClient } from "./serverModeration";

type VapidKeys = { publicKey: string; privateKey: string; subject: string };

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type RpcResult = { data: unknown; error: { message?: string } | null };
type LooseRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/**
 * Minimal shape for service-role table access to tables not present in the
 * generated Database types (e.g. push_subscriptions, which the app normally
 * only touches through an admin RPC).
 */
type LooseResult = { data: unknown; error: { message?: string } | null };
type LooseTable = {
  select: (columns: string) => {
    eq: (column: string, value: unknown) => PromiseLike<LooseResult>;
    in: (column: string, values: unknown[]) => PromiseLike<LooseResult>;
  };
  delete: () => {
    eq: (column: string, value: unknown) => PromiseLike<{ error: { message?: string } | null }>;
  };
};
type LooseAdmin = { from: (table: string) => LooseTable };

export type PushSendResult = {
  endpoint: string;
  ok: boolean;
  status: number | null;
  dead: boolean;
  error: string | null;
};

export type PushDeliverySummary = {
  sent: number;
  failed: number;
  dead: number;
  total: number;
  error: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readVapidKeys(): VapidKeys | null {
  const publicKey = process.env["VAPID_PUBLIC_KEY"]?.trim() ?? "";
  const privateKey = process.env["VAPID_PRIVATE_KEY"]?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env["VAPID_SUBJECT"]?.trim() || "mailto:admin@z-chat.men",
  };
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function bufferToBase64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Copies a Node Buffer into a plain Uint8Array (WebCrypto/fetch typings). */
function toBytes(value: Buffer) {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

const vapidJwtCache = new Map<string, { value: string; expiresAt: number }>();

/** Builds (and caches) the ES256 VAPID authorization header for an endpoint. */
function vapidAuthorization(endpoint: string): string | null {
  const keys = readVapidKeys();
  if (!keys) return null;

  let audience: string;
  try {
    audience = new URL(endpoint).origin;
  } catch {
    return null;
  }

  const cached = vapidJwtCache.get(audience);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return `vapid t=${cached.value}, k=${keys.publicKey}`;
  }

  const privateScalar = base64UrlToBuffer(keys.privateKey);
  if (privateScalar.length !== 32) return null;
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateScalar);
  const publicPoint = ecdh.getPublicKey();

  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bufferToBase64Url(privateScalar),
    x: bufferToBase64Url(publicPoint.subarray(1, 33)),
    y: bufferToBase64Url(publicPoint.subarray(33, 65)),
  };
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });

  const header = bufferToBase64Url(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const expiresAt = Math.floor(Date.now() / 1000) + 12 * 3600;
  const claims = bufferToBase64Url(
    Buffer.from(JSON.stringify({ aud: audience, exp: expiresAt, sub: keys.subject })),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${bufferToBase64Url(signature)}`;
  vapidJwtCache.set(audience, { value: token, expiresAt: expiresAt * 1000 });
  return `vapid t=${token}, k=${keys.publicKey}`;
}

/** RFC 8291 aes128gcm payload encryption. */
async function encryptPushPayload(target: SubscriptionRow, payload: string): Promise<Buffer> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable");

  const clientPublicKey = base64UrlToBuffer(target.p256dh);
  const authSecret = base64UrlToBuffer(target.auth);
  if (clientPublicKey.length !== 65) throw new Error("Invalid p256dh key");

  const ecdh = createECDH("prime256v1");
  const ephemeralPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(clientPublicKey);

  const sharedKey = await subtle.importKey("raw", toBytes(sharedSecret), "HKDF", false, [
    "deriveBits",
  ]);
  const ikm = Buffer.from(
    await subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toBytes(authSecret),
        info: toBytes(
          Buffer.concat([
            Buffer.from("WebPush: info\0", "utf8"),
            clientPublicKey,
            ephemeralPublic,
          ]),
        ),
      },
      sharedKey,
      256,
    ),
  );

  const salt = randomBytes(16);
  const ikmKey = await subtle.importKey("raw", toBytes(ikm), "HKDF", false, ["deriveBits"]);
  const contentKey = Buffer.from(
    await subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toBytes(salt),
        info: toBytes(Buffer.from("Content-Encoding: aes128gcm\0", "utf8")),
      },
      ikmKey,
      128,
    ),
  );
  const nonce = Buffer.from(
    await subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toBytes(salt),
        info: toBytes(Buffer.from("Content-Encoding: nonce\0", "utf8")),
      },
      ikmKey,
      96,
    ),
  );

  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  const aesKey = await subtle.importKey("raw", toBytes(contentKey), "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = Buffer.from(
    await subtle.encrypt(
      { name: "AES-GCM", iv: toBytes(nonce), tagLength: 128 },
      aesKey,
      toBytes(plaintext),
    ),
  );

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([ephemeralPublic.length]),
    ephemeralPublic,
    ciphertext,
  ]);
}

/** Sends one encrypted notification. Never throws; reports the outcome. */
export async function sendWebPush(
  target: SubscriptionRow,
  payload: Record<string, unknown>,
): Promise<PushSendResult> {
  const authorization = vapidAuthorization(target.endpoint);
  if (!authorization) {
    return {
      endpoint: target.endpoint,
      ok: false,
      status: null,
      dead: false,
      error: "VAPID keys are not configured on the server",
    };
  }

  try {
    const body = await encryptPushPayload(target, JSON.stringify(payload));
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        TTL: "86400",
        Urgency: "high",
      },
      body: toBytes(body),
      signal: AbortSignal.timeout(10_000),
    });
    const dead = response.status === 404 || response.status === 410;
    if (response.ok) {
      return { endpoint: target.endpoint, ok: true, status: response.status, dead: false, error: null };
    }
    const detail = await response.text().catch(() => "");
    return {
      endpoint: target.endpoint,
      ok: false,
      status: response.status,
      dead,
      error: detail.slice(0, 200) || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      endpoint: target.endpoint,
      ok: false,
      status: null,
      dead: false,
      error: error instanceof Error ? error.message : "push failed",
    };
  }
}

/** Looks the user's subscriptions up (admin RPC) and pushes to all of them. */
async function deliverPush(
  client: UserClient,
  userId: string,
  payload: Record<string, unknown>,
): Promise<PushDeliverySummary> {
  const rpc = client as unknown as LooseRpcClient;
  const lookup = await rpc.rpc("admin_push_subscriptions", { _user_id: userId });
  if (lookup.error) {
    console.error("[push] subscription lookup failed", lookup.error);
    return { sent: 0, failed: 0, dead: 0, total: 0, error: "lookup_failed" };
  }

  const rows = Array.isArray(lookup.data) ? (lookup.data as SubscriptionRow[]) : [];
  if (rows.length === 0) return { sent: 0, failed: 0, dead: 0, total: 0, error: null };

  const results = await Promise.all(rows.map((row) => sendWebPush(row, payload)));

  let sent = 0;
  let failed = 0;
  let dead = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result) continue;
    if (result.ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    if (result.dead) {
      dead += 1;
      const row = rows[index];
      if (row) {
        try {
          const removed = await rpc.rpc("admin_delete_push_subscription", { _id: row.id });
          if (removed.error) console.error("[push] could not prune dead subscription", removed.error);
        } catch (error) {
          console.error("[push] could not prune dead subscription", error);
        }
      }
    }
  }

  return { sent, failed, dead, total: rows.length, error: null };
}

type AdminGuard = { ok: true; client: UserClient } | { ok: false; response: Response };

/** Caller must be a signed-in admin (checked against their own profile via RLS). */
async function requireAdmin(request: Request): Promise<AdminGuard> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const { data, error } = await auth.client
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) {
    return { ok: false, response: json({ error: "Could not verify admin" }, 500, request) };
  }
  if (data?.is_admin !== true) {
    return { ok: false, response: json({ error: "Not authorized" }, 403, request) };
  }
  return { ok: true, client: auth.client };
}

/** GET /api/push-public-key - public key only, safe to expose. */
export async function handlePushPublicKeyRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, request);
  const keys = readVapidKeys();
  if (!keys) return json({ error: "Push is not configured" }, 503, request);
  return json({ publicKey: keys.publicKey }, 200, request);
}

/**
 * POST /api/push/approval { user_id } - notifies an approved applicant.
 * Always returns 200 with send counts, even when push itself failed, so the
 * approval flow on the client can ignore the result safely.
 */
export async function handleApprovalPushRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, request);
  if (isRateLimited(request)) return json({ error: "Too many requests" }, 429, request);

  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) return admin.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, request);
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const userId = typeof record["user_id"] === "string" ? record["user_id"].trim() : "";
    if (!UUID_RE.test(userId)) return json({ error: "user_id is required" }, 400, request);

    const summary = await deliverPush(admin.client, userId, {
      title: "Your Z Chat application was approved!",
      body: "You're in - open Z Chat and start chatting.",
      url: "/chat",
      tag: "application-approved",
    });
    return json(summary, 200, request);
  } catch (error) {
    console.error("[push] approval push failed", error);
    return json({ sent: 0, failed: 0, dead: 0, total: 0, error: "push_failed" }, 200, request);
  }
}

/**
 * POST /api/push/test { title?, body? } - sends a test notification to the
 * calling admin's own devices, for verifying push end to end.
 */
export async function handleTestPushRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, request);
  if (isRateLimited(request)) return json({ error: "Too many requests" }, 429, request);

  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) return admin.response;
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await request.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      /* defaults below */
    }
    const title = typeof body["title"] === "string" ? body["title"].slice(0, 80) : "Z Chat test";
    const message =
      typeof body["body"] === "string"
        ? body["body"].slice(0, 200)
        : "Push notifications are working on this device.";

    const summary = await deliverPush(admin.client, auth.user.id, {
      title,
      body: message,
      url: "/chat",
      tag: "push-test",
    });
    return json(summary, 200, request);
  } catch (error) {
    console.error("[push] test push failed", error);
    return json({ sent: 0, failed: 0, dead: 0, total: 0, error: "push_failed" }, 200, request);
  }
}

// --- Admin notifications -----------------------------------------------------
// Reports, applications and ban appeals originate from regular users, so this
// route is callable by any signed-in user. To keep it from being an open spam
// channel, the copy is authored here (the caller only picks a category and an
// optional short detail) and the route is rate limited. Failures are swallowed
// so the underlying action (reporting, applying, appealing) never breaks.

type AdminNotifyKind = "report" | "application" | "appeal" | "signup";

const ADMIN_NOTIFY: Record<
  AdminNotifyKind,
  { title: string; body: string; url: string; tag: string }
> = {
  report: {
    title: "New message report",
    body: "A message was reported — review it in the admin panel.",
    url: "/admin/reports",
    tag: "admin-report",
  },
  application: {
    title: "New account application",
    body: "Someone applied to join Z Chat.",
    url: "/admin/applications",
    tag: "admin-application",
  },
  appeal: {
    title: "New Open Chat message",
    body: "A ban appeal has a new message.",
    url: "/admin/appeals",
    tag: "admin-appeal",
  },
  signup: {
    title: "New sign-up",
    body: "A new Z Chat account was created.",
    url: "/admin",
    tag: "admin-signup",
  },
};

function isAdminNotifyKind(value: unknown): value is AdminNotifyKind {
  return typeof value === "string" && value in ADMIN_NOTIFY;
}

/**
 * POST /api/push/admins { kind, detail? } — pushes a moderation alert to every
 * admin's devices (excluding the caller). Returns send counts; never fails hard.
 */
export async function handleAdminPushRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, request);
  if (isRateLimited(request)) return json({ error: "Too many requests" }, 429, request);

  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await request.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      /* use defaults */
    }

    const kind = body["kind"];
    if (!isAdminNotifyKind(kind)) {
      return json({ error: "Unknown notification kind" }, 400, request);
    }
    const copy = ADMIN_NOTIFY[kind];
    const detail =
      typeof body["detail"] === "string" ? body["detail"].trim().slice(0, 140) : "";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as LooseAdmin;

    const adminLookup = await db.from("profiles").select("id").eq("is_admin", true);
    if (adminLookup.error) throw adminLookup.error;
    const adminIds = (Array.isArray(adminLookup.data) ? (adminLookup.data as { id: string }[]) : [])
      .map((row) => row.id)
      .filter((id) => id && id !== auth.user.id);
    if (adminIds.length === 0) return json({ sent: 0, failed: 0, total: 0 }, 200, request);

    const subsLookup = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", adminIds);
    if (subsLookup.error) throw subsLookup.error;
    const subs = Array.isArray(subsLookup.data) ? (subsLookup.data as SubscriptionRow[]) : [];

    const payload = {
      title: copy.title,
      body: detail ? `${copy.body} (${detail})` : copy.body,
      url: copy.url,
      tag: copy.tag,
    };

    let sent = 0;
    let failed = 0;
    for (const sub of subs) {
      const result = await sendWebPush(sub, payload);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        if (result.dead) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }

    return json({ sent, failed, total: subs.length }, 200, request);
  } catch (error) {
    console.error("[push] admin notification failed", error);
    return json({ sent: 0, failed: 0, total: 0, error: "push_failed" }, 200, request);
  }
}

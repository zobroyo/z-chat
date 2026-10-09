import crypto from "node:crypto";

import { authenticate, corsPreflight, json } from "./serverModeration";

/*
 * Stripe billing: subscription checkout, billing portal and webhook sync.
 *
 * Plans (AED/month): free 0, pro 10, max 15. Products/prices and the webhook
 * endpoint are created automatically by the box's one-shot setup command
 * (`sudo zchat-stripe sk_live_...`); this file just uses the env it writes:
 * STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_MAX,
 * STRIPE_WEBHOOK_SECRET, STRIPE_SYNC_KEY (+ SUPABASE_URL/PUBLISHABLE_KEY from
 * the service env). Plan changes are written through the
 * stripe_sync_plan/stripe_set_customer RPCs, which require the private sync
 * key, so users can never grant themselves a plan.
 */

const STRIPE_KEY = process.env["STRIPE_SECRET_KEY"] || "";
const PRICE_PRO = process.env["STRIPE_PRICE_PRO"] || "";
const PRICE_MAX = process.env["STRIPE_PRICE_MAX"] || "";
const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] || "";
const SYNC_KEY = process.env["STRIPE_SYNC_KEY"] || "";
const SUPA_URL = (process.env["SUPABASE_URL"] || "").replace(/\/$/, "");
const SUPA_ANON = process.env["SUPABASE_PUBLISHABLE_KEY"] || "";
const APP_ORIGIN = process.env["APP_ORIGIN"] || "https://z-chat.men";

type StripeObject = Record<string, unknown>;

function asRecord(value: unknown): StripeObject {
  return value && typeof value === "object" ? (value as StripeObject) : {};
}

async function stripeRequest(path: string, params?: Record<string, string>): Promise<StripeObject> {
  const method = params === undefined ? "GET" : "POST";
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    signal: AbortSignal.timeout(10_000),
  };
  if (params !== undefined) {
    init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/x-www-form-urlencoded" };
    init.body = new URLSearchParams(params).toString();
  }
  const response = await fetch(`https://api.stripe.com${path}`, init);
  const data = (await response.json().catch(() => null)) as StripeObject | null;
  if (!response.ok) {
    throw new Error(`stripe ${path} ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data ?? {};
}

/** Read the caller's billing fields from their own profile row. */
async function readOwnBilling(accessToken: string, userId: string) {
  const response = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,stripe_customer_id`,
    { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ plan?: string; stripe_customer_id?: string | null }>;
  return rows[0] ?? null;
}

async function rpc(name: string, body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPA_ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.error(`[stripe] rpc ${name} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

function planForPrice(priceId: string): "pro" | "max" | null {
  if (priceId && priceId === PRICE_PRO) return "pro";
  if (priceId && priceId === PRICE_MAX) return "max";
  return null;
}

async function ensureCustomer(userId: string, email: string | null, existing: string | null) {
  if (existing) return existing;
  const customer = await stripeRequest("/v1/customers", {
    ...(email ? { email } : {}),
    "metadata[zchat_user]": userId,
  });
  const id = typeof customer["id"] === "string" ? customer["id"] : "";
  if (id) await rpc("stripe_set_customer", { _key: SYNC_KEY, _user: userId, _customer: id });
  return id;
}

export async function handleStripeCheckoutRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, request);
  if (!STRIPE_KEY || !PRICE_PRO || !PRICE_MAX || !SYNC_KEY) {
    return json({ error: "billing_not_configured" }, 503, request);
  }

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  let plan = "";
  try {
    const payload = (await request.json()) as { plan?: string };
    plan = typeof payload.plan === "string" ? payload.plan : "";
  } catch {
    return json({ error: "bad_request" }, 400, request);
  }
  const price = plan === "pro" ? PRICE_PRO : plan === "max" ? PRICE_MAX : "";
  if (!price) return json({ error: "unknown_plan" }, 400, request);

  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const profile = await readOwnBilling(token, auth.user.id);
    const customerId = await ensureCustomer(
      auth.user.id,
      auth.user.email ?? null,
      profile?.stripe_customer_id ?? null,
    );
    if (!customerId) throw new Error("could not create customer");

    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: auth.user.id,
      "subscription_data[metadata][zchat_user]": auth.user.id,
      success_url: `${APP_ORIGIN}/profile?billing=success`,
      cancel_url: `${APP_ORIGIN}/profile?billing=cancelled`,
    });
    const url = typeof session["url"] === "string" ? session["url"] : "";
    if (!url) throw new Error("no checkout url");
    return json({ url }, 200, request);
  } catch (error) {
    console.error("[stripe] checkout failed", error);
    return json({ error: "checkout_failed" }, 500, request);
  }
}

export async function handleStripePortalRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, request);
  if (!STRIPE_KEY) return json({ error: "billing_not_configured" }, 503, request);

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const profile = await readOwnBilling(token, auth.user.id);
    if (!profile?.stripe_customer_id) return json({ error: "no_customer" }, 400, request);

    const session = await stripeRequest("/v1/billing_portal/sessions", {
      customer: profile.stripe_customer_id,
      return_url: `${APP_ORIGIN}/profile`,
    });
    const url = typeof session["url"] === "string" ? session["url"] : "";
    if (!url) throw new Error("no portal url");
    return json({ url }, 200, request);
  } catch (error) {
    console.error("[stripe] portal failed", error);
    return json({ error: "portal_failed" }, 500, request);
  }
}

function verifyStripeSignature(raw: string, header: string, secret: string): boolean {
  const parts: Record<string, string[]> = {};
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) (parts[key.trim()] ??= []).push(value.trim());
  }
  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] ?? [];
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

async function syncFromSubscription(subscription: StripeObject): Promise<void> {
  const metadata = asRecord(subscription["metadata"]);
  const userId = typeof metadata["zchat_user"] === "string" ? metadata["zchat_user"] : "";
  if (!userId) return;
  const items = asRecord(subscription["items"])["data"];
  const firstItem = Array.isArray(items) ? asRecord(items[0]) : {};
  const price = asRecord(firstItem["price"]);
  const priceId = typeof price["id"] === "string" ? price["id"] : "";
  const status = typeof subscription["status"] === "string" ? subscription["status"] : "";
  const canceled = status === "canceled" || status === "incomplete_expired";
  const plan = canceled ? "free" : (planForPrice(priceId) ?? "free");
  const periodEnd =
    typeof subscription["current_period_end"] === "number"
      ? new Date(subscription["current_period_end"] * 1000).toISOString()
      : null;
  const customer = typeof subscription["customer"] === "string" ? subscription["customer"] : "";
  await rpc("stripe_sync_plan", {
    _key: SYNC_KEY,
    _user: userId,
    _plan: plan,
    _status: canceled ? "canceled" : status,
    _customer: customer,
    _renews: plan === "free" ? null : periodEnd,
  });
  console.log(`[stripe] plan sync user=${userId} plan=${plan} status=${status}`);
}

export async function handleStripeWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, request);
  if (!STRIPE_KEY || !WEBHOOK_SECRET || !SYNC_KEY) {
    return json({ error: "billing_not_configured" }, 503, request);
  }

  const raw = await request.text();
  const signatureHeader = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(raw, signatureHeader, WEBHOOK_SECRET)) {
    return json({ error: "bad_signature" }, 400, request);
  }

  let event: { type?: string; data?: { object?: StripeObject } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return json({ error: "bad_payload" }, 400, request);
  }

  const object = asRecord(event.data?.object);
  try {
    if (event.type === "checkout.session.completed") {
      const subscriptionId = typeof object["subscription"] === "string" ? object["subscription"] : "";
      if (subscriptionId) {
        const subscription = await stripeRequest(`/v1/subscriptions/${subscriptionId}`);
        const metadata = asRecord(subscription["metadata"]);
        if (!metadata["zchat_user"] && typeof object["client_reference_id"] === "string") {
          subscription["metadata"] = { ...metadata, zchat_user: object["client_reference_id"] };
        }
        await syncFromSubscription(subscription);
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncFromSubscription(object);
    }
    return json({ received: true }, 200, request);
  } catch (error) {
    console.error("[stripe] webhook handling failed", error);
    return json({ error: "handler_failed" }, 500, request);
  }
}

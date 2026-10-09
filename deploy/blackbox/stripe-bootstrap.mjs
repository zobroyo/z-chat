#!/usr/bin/env node
/*
 * One-shot Stripe setup for Z Chat billing (run via `sudo zchat-stripe sk_...`).
 *
 * Idempotent: re-running reuses existing products/prices (by lookup key),
 * replaces only the webhook endpoint for z-chat.men (so a fresh signing
 * secret is always stored), and reuses the existing sync key when
 * /srv/zchat/state/stripe.env already has one.
 *
 * What it does:
 *   1. verifies the key against GET /v1/balance
 *   2. ensures products/prices: Z Chat Pro (10 AED/mo), Z Chat Max (15 AED/mo)
 *   3. ensures the https://z-chat.men/api/stripe/webhook endpoint
 *   4. initializes the private DB sync key (stripe_init_sync_key RPC)
 *   5. writes /srv/zchat/state/stripe.env (0600 zchat:zchat)
 *   6. installs a systemd drop-in that loads that file and restarts the app
 *   7. probes the local app to confirm billing is switched on
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const STRIPE_API = "https://api.stripe.com";
const ENV_FILE = "/srv/zchat/state/stripe.env";
const DROPIN_DIR = "/etc/systemd/system/zchat-app.service.d";
const DROPIN_FILE = `${DROPIN_DIR}/stripe.conf`;
const WEBHOOK_URL = "https://z-chat.men/api/stripe/webhook";
const LOCAL_PROBE = "http://127.0.0.1:1298/api/stripe/checkout";

const key = (process.argv[2] || "").trim();
if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
  console.error("usage: sudo zchat-stripe sk_live_...   (sk_test_... also works)");
  process.exit(1);
}
if (typeof process.getuid === "function" && process.getuid() !== 0) {
  console.error("must run as root: sudo zchat-stripe sk_live_...");
  process.exit(1);
}
if (key.startsWith("sk_test_")) {
  console.log("note: test key - subscriptions will not charge real cards");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripe(path, method = "GET", params) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  };
  if (params !== undefined) {
    const body = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = body.toString();
  }
  const response = await fetch(STRIPE_API + path, init);
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && data.error ? `${data.error.type}: ${data.error.message}` : text.slice(0, 300);
    throw new Error(`${method} ${path} -> ${response.status} ${message}`);
  }
  return data || {};
}

function serviceEnv() {
  const out = execFileSync("systemctl", ["show", "zchat-app.service", "-p", "Environment"], {
    encoding: "utf8",
  });
  const env = {};
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    for (const token of line.slice(eq + 1).split(/\s+/)) {
      const split = token.indexOf("=");
      if (split > 0) env[token.slice(0, split)] = token.slice(split + 1);
    }
  }
  return env;
}

function readExistingSyncKey() {
  if (!existsSync(ENV_FILE)) return "";
  try {
    const match = readFileSync(ENV_FILE, "utf8").match(/^STRIPE_SYNC_KEY=([A-Fa-f0-9]+)$/m);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

async function ensurePrice(lookupKey, productName, amountAed) {
  const query = new URLSearchParams();
  query.set("active", "true");
  query.append("lookup_keys[]", lookupKey);
  query.set("limit", "1");
  const found = await stripe(`/v1/prices?${query.toString()}`);
  if (Array.isArray(found.data) && found.data.length > 0) {
    console.log(`    price ${lookupKey}: reusing ${found.data[0].id}`);
    return found.data[0].id;
  }
  const product = await stripe("/v1/products", "POST", {
    name: productName,
    "metadata[zchat_billing]": "1",
    "metadata[zchat_plan]": lookupKey,
  });
  const price = await stripe("/v1/prices", "POST", {
    currency: "aed",
    unit_amount: String(amountAed),
    "recurring[interval]": "month",
    product: product.id,
    lookup_key: lookupKey,
    nickname: productName,
  });
  console.log(`    price ${lookupKey}: created ${price.id} (${amountAed / 100} AED/month)`);
  return price.id;
}

async function ensureWebhook() {
  const list = await stripe("/v1/webhook_endpoints?limit=100");
  const existing = (Array.isArray(list.data) ? list.data : []).find((item) => item.url === WEBHOOK_URL);
  if (existing) {
    await stripe(`/v1/webhook_endpoints/${existing.id}`, "DELETE");
    console.log("    webhook: replaced the existing z-chat.men endpoint (fresh signing secret)");
  }
  const params = new URLSearchParams();
  params.set("url", WEBHOOK_URL);
  params.set("description", "Z Chat billing (managed by zchat-stripe)");
  for (const event of [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]) {
    params.append("enabled_events[]", event);
  }
  const created = await stripe("/v1/webhook_endpoints", "POST", params);
  if (!created.secret) throw new Error("webhook created but no signing secret returned");
  console.log(`    webhook: ${created.id}`);
  return created.secret;
}

async function initSyncKey(syncKey, supa) {
  const response = await fetch(`${supa.SUPABASE_URL}/rest/v1/rpc/stripe_init_sync_key`, {
    method: "POST",
    headers: {
      apikey: supa.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${supa.SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _key: syncKey }),
    signal: AbortSignal.timeout(10000),
  });
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`stripe_init_sync_key failed: ${response.status} ${text.slice(0, 200)}`);
  }
  if (text !== "true") {
    throw new Error(
      "a different sync key is already stored in the database. To rotate it, run " +
        "`delete from private.server_secrets where key = 'stripe_sync';` in the Supabase SQL " +
        "editor and re-run this command.",
    );
  }
}

async function main() {
  console.log("1/7 verifying the Stripe key...");
  const balance = await stripe("/v1/balance");
  if (!balance.object) throw new Error("unexpected response from Stripe");
  console.log(`    key OK (livemode=${balance.livemode === true})`);

  console.log("2/7 ensuring products/prices...");
  const pricePro = await ensurePrice("zchat_pro_monthly", "Z Chat Pro", 1000);
  const priceMax = await ensurePrice("zchat_max_monthly", "Z Chat Max", 1500);

  console.log("3/7 ensuring the webhook endpoint...");
  const webhookSecret = await ensureWebhook();

  console.log("4/7 initializing the database sync key...");
  const supa = serviceEnv();
  if (!supa.SUPABASE_URL || !supa.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("could not read SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY from zchat-app.service");
  }
  const existingSync = readExistingSyncKey();
  const syncKey = existingSync || crypto.randomBytes(24).toString("hex");
  await initSyncKey(syncKey, supa);
  console.log(existingSync ? "    reusing the stored sync key" : "    sync key initialized");

  console.log("5/7 writing /srv/zchat/state/stripe.env...");
  writeFileSync(
    ENV_FILE,
    [
      `STRIPE_SECRET_KEY=${key}`,
      `STRIPE_PRICE_PRO=${pricePro}`,
      `STRIPE_PRICE_MAX=${priceMax}`,
      `STRIPE_WEBHOOK_SECRET=${webhookSecret}`,
      `STRIPE_SYNC_KEY=${syncKey}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  execFileSync("chown", ["zchat:zchat", ENV_FILE]);
  chmodSync(ENV_FILE, 0o600);

  console.log("6/7 installing the systemd drop-in and restarting the app...");
  mkdirSync(DROPIN_DIR, { recursive: true });
  writeFileSync(DROPIN_FILE, `[Service]\nEnvironmentFile=${ENV_FILE}\n`, { mode: 0o644 });
  execFileSync("systemctl", ["daemon-reload"]);
  execFileSync("systemctl", ["restart", "zchat-app.service"]);

  console.log("7/7 waiting for the app and probing billing...");
  let ok = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(LOCAL_PROBE, { method: "POST", signal: AbortSignal.timeout(3000) });
      if (response.status === 401) {
        // configured: the route now requires a signed-in user
        ok = true;
        break;
      }
      if (response.status === 503) throw new Error("app still reports billing_not_configured");
    } catch (error) {
      if (String(error.message).includes("billing_not_configured")) throw error;
    }
    await sleep(1000);
  }
  if (!ok) throw new Error("app did not come back in 30s - check `systemctl status zchat-app`");

  console.log("");
  console.log("Billing is LIVE.");
  console.log("  - Checkout:  https://z-chat.men/profile -> Plans");
  console.log("  - Webhook:   " + WEBHOOK_URL);
  console.log("  - Receipts:  Stripe dashboard -> Payments");
}

main().catch((error) => {
  console.error("");
  console.error("zchat-stripe failed:");
  console.error("  " + (error && error.message ? error.message : error));
  process.exit(1);
});

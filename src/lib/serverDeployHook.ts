import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/*
 * GitHub push webhook -> instant deploy.
 *
 * GitHub POSTs here on every push to main (signature-verified with the secret
 * in /srv/zchat/deploy-hook.secret, loaded into the app's environment by
 * systemd). The handler cannot run systemctl itself - the app is sandboxed -
 * so it writes a trigger file and the root-owned zchat-deploy.path unit starts
 * zchat-deploy.service. Without the secret configured this endpoint is inert
 * and the 30-second polling timer remains the fallback.
 */

const REQUEST_FILE = process.env["ZCHAT_DEPLOY_REQUEST_FILE"] || "/srv/zchat/state/deploy-request";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleDeployHookRoute(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const secret = process.env["DEPLOY_HOOK_SECRET"] || "";
  if (!secret) {
    return json({ error: "Deploy hook is not configured" }, 503);
  }

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    signatureBytes.length !== expectedBytes.length ||
    !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const record = (payload ?? {}) as { ref?: unknown; repository?: { full_name?: unknown } };
  const ref = typeof record.ref === "string" ? record.ref : "";
  if (ref !== "refs/heads/main") {
    return json({ ok: true, ignored: true, ref }, 202);
  }

  try {
    await mkdir(dirname(REQUEST_FILE), { recursive: true });
    await writeFile(REQUEST_FILE, `${new Date().toISOString()} ${ref}\n`);
  } catch (error) {
    console.error("[deploy-hook] could not write deploy request", error);
    return json({ error: "Could not request deploy" }, 500);
  }

  console.log(`[deploy-hook] deploy requested by push to ${ref}`);
  return json({ ok: true, ref, deploy: "requested" });
}

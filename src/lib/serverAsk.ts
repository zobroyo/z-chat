import { authenticate, corsPreflight, json } from "./serverModeration";

/*
 * /api/ask - the "I'm stuck, answer it for me" helper.
 *
 * Authenticated users on Pro or Max (and admins) can ask a question and get a
 * full worked answer from DeepSeek, forwarded through the zsparx service so the
 * model/key stay server-side. Free users get a 402 with an upgrade hint.
 */

const SUPA_URL = (process.env["SUPABASE_URL"] || "").replace(/\/$/, "");
const SUPA_ANON = process.env["SUPABASE_PUBLISHABLE_KEY"] || "";
const ZSPARX_URL = process.env["ZSPARX_URL"] || "http://127.0.0.1:8823";
const ZSPARX_TOKEN = process.env["ZSPARX_TOKEN"] || "";

async function planFor(token: string, userId: string): Promise<string> {
  try {
    const response = await fetch(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,is_admin`,
      { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return "free";
    const rows = (await response.json()) as Array<{ plan?: string; is_admin?: boolean }>;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.is_admin) return "max";
    return typeof row?.plan === "string" ? row.plan : "free";
  } catch {
    return "free";
  }
}

export async function handleAskRoute(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflight(request);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, request);

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const plan = await planFor(token, auth.user.id);
  if (plan !== "pro" && plan !== "max") {
    return json(
      { error: "upgrade", message: "Getting the answer is a Pro feature. Upgrade to Pro or Max in Z Chat." },
      402,
      request,
    );
  }
  if (!ZSPARX_TOKEN) return json({ error: "not_configured" }, 503, request);

  let body: { question?: unknown; context?: unknown };
  try {
    body = (await request.json()) as { question?: unknown; context?: unknown };
  } catch {
    return json({ error: "bad_request" }, 400, request);
  }
  const question = String(body.question ?? "").trim().slice(0, 4000);
  if (!question) return json({ error: "no_question", message: "Type the question you're stuck on." }, 400, request);
  const context = body.context ? String(body.context).slice(0, 4000) : "";

  try {
    const response = await fetch(`${ZSPARX_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zsparx-token": ZSPARX_TOKEN },
      body: JSON.stringify(context ? { question, context } : { question }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await response.json().catch(() => ({}))) as { answer?: string };
    if (!response.ok) return json({ error: "ai_failed", detail: data }, 502, request);
    return json({ answer: data.answer ?? "" }, 200, request);
  } catch {
    return json({ error: "ai_failed", message: "The AI took too long. Try again." }, 502, request);
  }
}

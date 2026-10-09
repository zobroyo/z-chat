import { supabase } from "@/integrations/supabase/client";

/**
 * Pings the admin team's devices about a moderation event (new report,
 * application, ban-appeal message). The server authors the notification copy
 * from the `kind`, rate limits the calls, and never notifies the caller, so
 * this is safe to fire-and-forget after the user's own action succeeds.
 */
export type AdminNotifyKind = "report" | "application" | "appeal" | "signup";

export async function notifyAdmins(kind: AdminNotifyKind, detail?: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch("/api/push/admins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind, detail: detail?.trim().slice(0, 140) ?? "" }),
    });
  } catch {
    // Best effort: the user's action already succeeded.
  }
}

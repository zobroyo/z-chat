import { supabase } from "@/integrations/supabase/client";

/**
 * Pings the other members of a conversation on their devices that a call just
 * started. Best-effort: the in-app ring already went out, this only helps the
 * people who are offline, on another page, or have the tab backgrounded.
 */
export async function notifyIncomingCall(conversationId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || !conversationId) return;

    await fetch("/api/push/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  } catch {
    // Best effort: never block starting a call on this.
  }
}

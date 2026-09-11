// Supabase Edge Function: send-push
// Diagnostic version for testing database-webhook -> Web Push flow.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

console.log("[send-push] Function loaded");
console.log("[send-push] VAPID public key present:", !!VAPID_PUBLIC_KEY);
console.log("[send-push] VAPID private key present:", !!VAPID_PRIVATE_KEY);

webpush.setVapidDetails(
  "mailto:you@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  console.log("[send-push] Request received:", req.method);

  try {
    const payload = await req.json();

    console.log("[send-push] Payload received");
    console.log("[send-push] Has record:", !!payload?.record);

    const message = payload?.record;

    if (!message) {
      console.error("[send-push] No record in webhook payload");
      return new Response("no record", { status: 400 });
    }

    console.log("[send-push] Message ID:", message.id);
    console.log("[send-push] Conversation ID:", message.conversation_id);
    console.log("[send-push] Sender ID:", message.sender_id);

    const { data: members, error: membersError } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", message.conversation_id)
      .neq("user_id", message.sender_id);

    if (membersError) {
      console.error("[send-push] Members query failed:", membersError);
      return new Response("members query failed", { status: 500 });
    }

    console.log(
      "[send-push] Recipients found:",
      members?.length ?? 0,
    );

    if (!members?.length) {
      console.log("[send-push] No recipients");
      return new Response("no recipients", { status: 200 });
    }

    const { data: sender, error: senderError } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", message.sender_id)
      .single();

    if (senderError) {
      console.warn("[send-push] Sender profile lookup failed:", senderError);
    }

    const title = sender?.display_name ?? "New message";
    const body = message.body ?? "Sent a photo";

    console.log("[send-push] Notification title:", title);
    console.log("[send-push] Notification body:", body);

    for (const member of members) {
      console.log(
        "[send-push] Checking subscriptions for:",
        member.user_id,
      );

      const { data: subs, error: subsError } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", member.user_id);

      if (subsError) {
        console.error(
          "[send-push] Subscription query failed:",
          subsError,
        );
        continue;
      }

      console.log(
        "[send-push] Subscriptions found:",
        subs?.length ?? 0,
      );

      for (const sub of subs ?? []) {
        console.log(
          "[send-push] Sending notification to endpoint:",
          sub.endpoint,
        );

        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(
            subscription,
            JSON.stringify({
              title,
              body,
              url: "/chat",
            }),
          );

          console.log("[send-push] Notification sent successfully");
        } catch (err) {
          console.error("[send-push] Web Push failed:", err);

          const statusCode =
            typeof err === "object" &&
            err !== null &&
            "statusCode" in err
              ? (err as { statusCode?: number }).statusCode
              : undefined;

          console.error("[send-push] Web Push status:", statusCode);

          if (statusCode === 404 || statusCode === 410) {
            console.log(
              "[send-push] Removing dead subscription:",
              sub.id,
            );

            const { error: deleteError } = await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);

            if (deleteError) {
              console.error(
                "[send-push] Failed to delete dead subscription:",
                deleteError,
              );
            }
          }
        }
      }
    }

    console.log("[send-push] Finished successfully");

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[send-push] Function error:", err);

    return new Response("internal error", { status: 500 });
  }
});
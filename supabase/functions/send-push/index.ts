// Supabase Edge Function: send-push
// Triggered by a database webhook on INSERT into public.messages.
// Looks up the other conversation members and sends each of them a
// web push notification via their stored subscriptions.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:you@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const payload = await req.json();
  const message = payload.record;
  if (!message) return new Response("no record", { status: 400 });

  const { data: members } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", message.conversation_id)
    .neq("user_id", message.sender_id);

  if (!members?.length) return new Response("no recipients", { status: 200 });

  const { data: sender } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", message.sender_id)
    .single();

  const title = sender?.display_name ?? "New message";
  const body = message.body ?? "Sent a photo";

  for (const member of members) {
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", member.user_id);

    for (const sub of subs ?? []) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title, body, url: "/chat" }),
        );
      } catch (err) {
        // Subscription is dead (user revoked permission, uninstalled, etc) — clean it up.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
});
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";

export const PUBLIC_CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";

export type ConversationKind = "public" | "dm" | "group";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  last_seen: string;
};

export type Conversation = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  avatar_url: string | null;
  created_by: string | null;
  dm_key: string | null;
  created_at: string;
};

export type Member = {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
  reply_to_message_id: string | null;
};

export type MessageReceipt = {
  message_id: string;
  conversation_id: string;
  recipient_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Name needs at least 2 characters")
  .max(40, "Name must be under 40 characters");

export const groupNameSchema = z
  .string()
  .trim()
  .min(2, "Group name needs at least 2 characters")
  .max(60, "Group name must be under 60 characters");

export const messageSchema = z.string().trim().min(1).max(4000);

export function dmKeyFor(a: string, b: string) {
  return [a, b].sort().join("_");
}

export async function fetchProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, last_seen")
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function fetchConversations() {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at");
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function fetchMembers() {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id, last_read_at");
  if (error) throw error;
  return (data ?? []) as Member[];
}

export async function fetchMessages(conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, image_url, created_at, reply_to_message_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  return ((data ?? []) as Message[]).slice().reverse();
}

export async function fetchMessageReceipts(conversationId: string, messageIds: string[]) {
  if (messageIds.length === 0) return [] as MessageReceipt[];

  const results: MessageReceipt[] = [];
  for (let offset = 0; offset < messageIds.length; offset += 500) {
    const ids = messageIds.slice(offset, offset + 500);
    const { data, error } = await supabase
      .from("message_receipts")
      .select("message_id, conversation_id, recipient_id, delivered_at, read_at")
      .eq("conversation_id", conversationId)
      .in("message_id", ids);
    if (error) throw error;
    results.push(...((data ?? []) as MessageReceipt[]));
  }
  return results;
}

export async function markMessagesDelivered(
  conversationId: string,
  userId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return;
  const { error } = await supabase
    .from("message_receipts")
    .update({ delivered_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("recipient_id", userId)
    .in("message_id", messageIds)
    .is("delivered_at", null);
  if (error) throw error;
}

export async function deliverPendingMessages(userId: string) {
  while (true) {
    const { data, error } = await supabase
      .from("message_receipts")
      .select("message_id, conversation_id")
      .eq("recipient_id", userId)
      .is("delivered_at", null)
      .limit(500);
    if (error) throw error;
    const pending = data ?? [];
    if (pending.length === 0) return;

    const byConversation = new Map<string, string[]>();
    for (const receipt of pending) {
      const ids = byConversation.get(receipt.conversation_id) ?? [];
      ids.push(receipt.message_id);
      byConversation.set(receipt.conversation_id, ids);
    }
    await Promise.all(
      [...byConversation.entries()].map(([conversationId, ids]) =>
        markMessagesDelivered(conversationId, userId, ids),
      ),
    );
  }
}

export async function markMessagesRead(
  conversationId: string,
  userId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return;
  const readAt = new Date().toISOString();
  const { error } = await supabase
    .from("message_receipts")
    .update({ delivered_at: readAt, read_at: readAt })
    .eq("conversation_id", conversationId)
    .eq("recipient_id", userId)
    .in("message_id", messageIds)
    .is("read_at", null);
  if (error) throw error;
}
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  body?: string;
  imagePath?: string | null;
  replyToMessageId?: string | null;
}) {
  const trimmed = input.body?.trim() ?? "";
  if (!trimmed && !input.imagePath) return null;
  if (trimmed) messageSchema.parse(trimmed);

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      conversation_id: input.conversationId,
      body: trimmed || "",
      image_url: input.imagePath ?? null,
      reply_to_message_id: input.replyToMessageId ?? null,
    }),
  });

  const payload = (await res.json().catch(() => null)) as {
    error?: string;
    timeout_until?: string | null;
    message?: Message;
  } | null;

  if (!res.ok) {
    const error = new Error(payload?.error || "Message blocked") as Error & {
      timeoutUntil?: unknown;
    };
    if (payload?.timeout_until) error.timeoutUntil = payload.timeout_until;
    throw error;
  }

  return payload?.message as Message;
}

/** Finds the one-to-one chat with someone, creating it the first time. */
export async function ensureDirectConversation(myId: string, otherId: string) {
  const key = dmKeyFor(myId, otherId);

  const existing = await supabase
    .from("conversations")
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at")
    .eq("dm_key", key)
    .maybeSingle();
  if (existing.data) return existing.data as Conversation;

  const created = await supabase
    .from("conversations")
    .insert({ kind: "dm", dm_key: key, created_by: myId })
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at")
    .single();
  if (created.error) throw created.error;

  const { error: memberError } = await supabase.from("conversation_members").insert([
    { conversation_id: created.data.id, user_id: myId },
    { conversation_id: created.data.id, user_id: otherId },
  ]);
  if (memberError) throw memberError;

  return created.data as Conversation;
}

export async function createGroup(myId: string, name: string, memberIds: string[]) {
  const cleanName = groupNameSchema.parse(name);

  const created = await supabase
    .from("conversations")
    .insert({ kind: "group", name: cleanName, created_by: myId })
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at")
    .single();
  if (created.error) throw created.error;

  const unique = Array.from(new Set([myId, ...memberIds]));
  const { error } = await supabase
    .from("conversation_members")
    .insert(unique.map((user_id) => ({ conversation_id: created.data.id, user_id })));
  if (error) throw error;

  return created.data as Conversation;
}

export async function leaveConversation(conversationId: string, userId: string) {
  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function markConversationRead(conversationId: string, userId: string) {
  const { error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function touchPresence(userId: string) {
  await supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", userId);
}

export function isOnline(profile: Profile | undefined) {
  if (!profile) return false;
  return Date.now() - new Date(profile.last_seen).getTime() < 70_000;
}

export function initialsOf(name: string | null | undefined) {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

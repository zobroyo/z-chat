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
    .select("id, conversation_id, sender_id, body, image_url, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  body?: string;
  imagePath?: string | null;
}) {
  const trimmed = input.body?.trim() ?? "";
  if (!trimmed && !input.imagePath) return;
  if (trimmed) messageSchema.parse(trimmed);

  const { error } = await supabase.from("messages").insert({
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    body: trimmed || null,
    image_url: input.imagePath ?? null,
  });
  if (error) throw error;
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
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
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

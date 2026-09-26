import { supabase } from "@/integrations/supabase/client";
import type { Conversation, ConversationKind } from "@/lib/chat";

export const PAGE_SIZE = 25;

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  if (error) return false;
  return Boolean((data as { is_admin: boolean } | null)?.is_admin);
}

export type AdminStats = {
  users: number;
  conversations: number;
  messages: number;
  groups: number;
  dms: number;
};

export async function fetchAdminStats(): Promise<AdminStats> {
  const [users, conversations, messages, groups, dms] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("conversations").select("id", { count: "exact", head: true }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("kind", "group"),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("kind", "dm"),
  ]);
  return {
    users: users.count ?? 0,
    conversations: conversations.count ?? 0,
    messages: messages.count ?? 0,
    groups: groups.count ?? 0,
    dms: dms.count ?? 0,
  };
}

export type AdminProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  last_seen: string;
  created_at: string;
  is_admin: boolean;
  banned: boolean;
};

export async function fetchAdminUsers(page: number, search: string) {
  let query = supabase
    .from("profiles")
    .select("id, display_name, avatar_url, last_seen, created_at, is_admin, banned", {
      count: "exact",
    })
    .order("display_name")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (search.trim()) query = query.ilike("display_name", `%${search.trim()}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as AdminProfile[], count: count ?? 0 };
}

export type ConversationSummary = Conversation & {
  memberCount: number;
  messageCount: number;
  lastMessageAt: string | null;
};

export async function fetchAdminConversations(
  page: number,
  filter: "all" | ConversationKind,
  search: string,
) {
  let query = supabase
    .from("conversations")
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (filter !== "all") query = query.eq("kind", filter);
  if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
  const { data, count, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Conversation[];
  const withCounts = await Promise.all(
    rows.map(async (c): Promise<ConversationSummary> => {
      const [members, messages, last] = await Promise.all([
        supabase
          .from("conversation_members")
          .select("user_id", { count: "exact", head: true })
          .eq("conversation_id", c.id),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id),
        supabase
          .from("messages")
          .select("created_at")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        ...c,
        memberCount: members.count ?? 0,
        messageCount: messages.count ?? 0,
        lastMessageAt: (last.data as { created_at: string } | null)?.created_at ?? null,
      };
    }),
  );
  return { rows: withCounts, count: count ?? 0 };
}

export async function fetchConversationDisplayName(
  conv: Pick<Conversation, "kind" | "name" | "id">,
  profiles: Map<string, AdminProfile | { display_name: string }>,
): Promise<string> {
  if (conv.kind !== "dm") return conv.name ?? (conv.kind === "public" ? "General" : "Group");
  const { data } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conv.id);
  const names = (data ?? [])
    .map((m) => profiles.get((m as { user_id: string }).user_id)?.display_name)
    .filter(Boolean);
  return names.length ? names.join(" ↔ ") : "Direct message";
}

export type AdminMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
};

export async function searchAdminMessages(page: number, query: string) {
  let q = supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (query.trim()) q = q.ilike("body", `%${query.trim()}%`);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as AdminMessageRow[], count: count ?? 0 };
}

export async function fetchConversationById(id: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, kind, name, avatar_url, created_by, dm_key, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Conversation | null;
}

// --- Admin actions: each calls a SECURITY DEFINER function or an RLS-scoped
// mutation added specifically for admin use. None of these bypass RLS on
// their own — the database itself checks private.is_admin(auth.uid()).

export async function setUserBanned(userId: string, banned: boolean) {
  const { error } = await supabase.rpc("admin_set_banned", { _target: userId, _value: banned });
  if (error) throw error;
}

export async function setUserAdmin(userId: string, isAdmin: boolean) {
  const { error } = await supabase.rpc("admin_set_is_admin", { _target: userId, _value: isAdmin });
  if (error) throw error;
}

export async function updateUserProfile(
  userId: string,
  fields: { display_name?: string; avatar_url?: string | null },
) {
  const { error } = await supabase.from("profiles").update(fields).eq("id", userId);
  if (error) throw error;
}

export async function deleteMessageAsAdmin(messageId: string) {
  const { error } = await supabase.from("messages").delete().eq("id", messageId);
  if (error) throw error;
}

export async function renameConversationAsAdmin(conversationId: string, name: string) {
  const { error } = await supabase.from("conversations").update({ name }).eq("id", conversationId);
  if (error) throw error;
}

export async function kickMemberAsAdmin(conversationId: string, userId: string) {
  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function fetchConversationMembers(conversationId: string) {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  const userIds = (data ?? []).map((m) => (m as { user_id: string }).user_id);
  if (!userIds.length) return [];
  const { data: profs, error: profErr } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  if (profErr) throw profErr;
  return (profs ?? []) as { id: string; display_name: string; avatar_url: string | null }[];
}

export type ChatSettings = { character_limit: number; keyword_moderation_enabled: boolean };

export async function fetchChatSettings(): Promise<ChatSettings> {
  const { data, error } = await supabase
    .from("chat_settings")
    .select("character_limit, keyword_moderation_enabled")
    .eq("id", true)
    .single();
  if (error) throw error;
  return data as ChatSettings;
}

export async function updateChatSettings(fields: Partial<ChatSettings>) {
  const { error } = await supabase.from("chat_settings").update(fields).eq("id", true);
  if (error) throw error;
}

export type BlockedKeyword = { id: string; keyword: string; enabled: boolean };

export async function fetchBlockedKeywords(): Promise<BlockedKeyword[]> {
  const { data, error } = await supabase
    .from("blocked_keywords")
    .select("id, keyword, enabled")
    .order("keyword");
  if (error) throw error;
  return (data ?? []) as BlockedKeyword[];
}

export async function addBlockedKeyword(keyword: string) {
  const { error } = await supabase
    .from("blocked_keywords")
    .insert({ keyword: keyword.trim().toLowerCase() });
  if (error) throw error;
}

export async function setBlockedKeywordEnabled(id: string, enabled: boolean) {
  const { error } = await supabase.from("blocked_keywords").update({ enabled }).eq("id", id);
  if (error) throw error;
}

export async function deleteBlockedKeyword(id: string) {
  const { error } = await supabase.from("blocked_keywords").delete().eq("id", id);
  if (error) throw error;
}

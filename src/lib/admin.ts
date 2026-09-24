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
};

export async function fetchAdminUsers(page: number, search: string) {
  let query = supabase
    .from("profiles")
    .select("id, display_name, avatar_url, last_seen, created_at", { count: "exact" })
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
        supabase.from("conversation_members").select("user_id", { count: "exact", head: true }).eq("conversation_id", c.id),
        supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", c.id),
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

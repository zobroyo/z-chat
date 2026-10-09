import { supabase } from "@/integrations/supabase/client";
import { notifyAdmins } from "@/lib/notifyAdmins";

// "Open Chat" — the ban conversation. A banned user and moderators exchange
// messages in one thread keyed by the banned user's id. Works while banned.

export type OpenChatMessage = {
  id: string;
  user_id: string;
  sender_id: string;
  is_moderator: boolean;
  body: string;
  created_at: string;
};

export const OPEN_CHAT_BUCKET_LIMIT = 500;
export const OPEN_CHAT_MAX_LENGTH = 1000;

/** All messages in the thread (RLS: own thread, or any thread for admins). */
export async function fetchThreadMessages(userId: string): Promise<OpenChatMessage[]> {
  const { data, error } = await supabase
    .from("ban_appeal_messages")
    .select("id, user_id, sender_id, is_moderator, body, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(OPEN_CHAT_BUCKET_LIMIT);
  if (error) throw error;
  return (data ?? []) as OpenChatMessage[];
}

/**
 * Post a message. `isModerator` must match the caller's admin status — the
 * database enforces it (RLS), so a normal user can't post as a moderator.
 */
export async function sendThreadMessage(
  userId: string,
  senderId: string,
  body: string,
  isModerator: boolean,
): Promise<OpenChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Type a message first");
  if (trimmed.length > OPEN_CHAT_MAX_LENGTH) {
    throw new Error(`Keep it under ${OPEN_CHAT_MAX_LENGTH} characters`);
  }

  // Ensure a thread row exists (harmless if it already does).
  await supabase
    .from("ban_appeal_threads")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

  const { data, error } = await supabase
    .from("ban_appeal_messages")
    .insert({ user_id: userId, sender_id: senderId, is_moderator: isModerator, body: trimmed })
    .select("id, user_id, sender_id, is_moderator, body, created_at")
    .single();
  if (error) throw error;
  // A user's message (not an admin reply) should ping the moderation team.
  if (!isModerator) void notifyAdmins("appeal");
  return data as OpenChatMessage;
}

export type AdminThread = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  user_banned: boolean;
  resolved: boolean;
  last_body: string | null;
  last_at: string | null;
  count: number;
};

/** Admin: every thread that has at least one message, newest first. */
export async function fetchAdminThreads(): Promise<AdminThread[]> {
  const { data, error } = await supabase
    .from("ban_appeal_messages")
    .select("user_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const byUser = new Map<string, { last_body: string; last_at: string; count: number }>();
  for (const m of data ?? []) {
    const cur = byUser.get(m.user_id);
    if (cur) cur.count += 1;
    else byUser.set(m.user_id, { last_body: m.body, last_at: m.created_at, count: 1 });
  }

  const userIds = [...byUser.keys()];
  const profilesById = new Map<string, { display_name: string; avatar_url: string | null; banned: boolean }>();
  const resolvedById = new Map<string, boolean>();
  if (userIds.length > 0) {
    const [{ data: profs }, { data: threads }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, avatar_url, banned").in("id", userIds),
      supabase.from("ban_appeal_threads").select("user_id, resolved").in("user_id", userIds),
    ]);
    for (const p of profs ?? []) {
      profilesById.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url, banned: p.banned });
    }
    for (const t of threads ?? []) resolvedById.set(t.user_id, t.resolved);
  }

  return userIds
    .map((uid) => ({
      user_id: uid,
      display_name: profilesById.get(uid)?.display_name ?? null,
      avatar_url: profilesById.get(uid)?.avatar_url ?? null,
      user_banned: profilesById.get(uid)?.banned ?? false,
      resolved: resolvedById.get(uid) ?? false,
      last_body: byUser.get(uid)?.last_body ?? null,
      last_at: byUser.get(uid)?.last_at ?? null,
      count: byUser.get(uid)?.count ?? 0,
    }))
    .sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
}

export async function setThreadResolved(userId: string, resolved: boolean): Promise<void> {
  const { error } = await supabase
    .from("ban_appeal_threads")
    .upsert(
      { user_id: userId, resolved, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

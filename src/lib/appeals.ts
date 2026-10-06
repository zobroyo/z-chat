import { supabase } from "@/integrations/supabase/client";

export type BanAppeal = {
  id: string;
  user_id: string;
  message: string;
  resolved: boolean;
  created_at: string;
};

export type AdminBanAppeal = BanAppeal & {
  display_name: string | null;
  avatar_url: string | null;
  user_banned: boolean;
};

export const APPEAL_MAX_LENGTH = 1000;

/** The banned user's own appeals (RLS: select own). */
export async function fetchMyAppeals(userId: string): Promise<BanAppeal[]> {
  const { data, error } = await supabase
    .from("banned_appeals")
    .select("id, user_id, message, resolved, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as BanAppeal[];
}

/**
 * Submits an appeal. Works while banned — banned_appeals is the one channel
 * RLS deliberately keeps open regardless of ban status.
 */
export async function submitAppeal(userId: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Tell us why your ban should be reviewed");
  if (trimmed.length > APPEAL_MAX_LENGTH) {
    throw new Error(`Appeal must be ${APPEAL_MAX_LENGTH} characters or fewer`);
  }
  const { error } = await supabase
    .from("banned_appeals")
    .insert({ user_id: userId, message: trimmed });
  if (error) throw error;
}

/** Admin view: every appeal plus the profile of who filed it (RLS: admin). */
export async function fetchAllAppeals(): Promise<AdminBanAppeal[]> {
  const { data, error } = await supabase
    .from("banned_appeals")
    .select("id, user_id, message, resolved, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const appeals = (data ?? []) as BanAppeal[];
  const userIds = [...new Set(appeals.map((appeal) => appeal.user_id))];

  const profilesById = new Map<
    string,
    { display_name: string; avatar_url: string | null; banned: boolean }
  >();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, banned")
      .in("id", userIds);
    if (profileError) throw profileError;
    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        banned: profile.banned,
      });
    }
  }

  return appeals.map((appeal) => ({
    ...appeal,
    display_name: profilesById.get(appeal.user_id)?.display_name ?? null,
    avatar_url: profilesById.get(appeal.user_id)?.avatar_url ?? null,
    user_banned: profilesById.get(appeal.user_id)?.banned ?? false,
  }));
}

export async function setAppealResolved(id: string, resolved: boolean): Promise<void> {
  const { error } = await supabase.from("banned_appeals").update({ resolved }).eq("id", id);
  if (error) throw error;
}

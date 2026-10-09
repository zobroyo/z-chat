/**
 * Notification mutes ("do not notify me about this conversation / this person").
 *
 * The list is loaded once per signed-in user from `notification_mutes` (RLS:
 * owner-only rows) and cached in a module store so notification code paths can
 * check it synchronously — e.g. inside a Realtime callback that must not
 * re-subscribe when the list changes.
 *
 * Defensive rule: if the list cannot be loaded, every check returns false, so
 * notifications behave exactly as they did before mutes existed.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";

export type MuteTargetType = "conversation" | "user";

type MuteSnapshot = {
  conversations: ReadonlySet<string>;
  users: ReadonlySet<string>;
  /** True once a load attempt for the current user has finished (success or not). */
  loaded: boolean;
};

const EMPTY_SNAPSHOT: MuteSnapshot = {
  conversations: new Set<string>(),
  users: new Set<string>(),
  loaded: false,
};

let snapshot: MuteSnapshot = EMPTY_SNAPSHOT;
let currentUserId: string | null = null;
let loadedForUserId: string | null = null;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

// The generated client types predate `notification_mutes`; keep a minimal
// thenable shape for the three queries this helper needs (same pattern as
// NotificationGate / lib/push.ts).
type MutesResult = { data: unknown; error: { message?: string } | null };
type MutesFilter = {
  eq: (column: string, value: string) => MutesFilter;
  then: PromiseLike<MutesResult>["then"];
};
type MutesClient = {
  from: (table: string) => {
    select: (columns?: string) => MutesFilter;
    insert: (row: Record<string, unknown>) => PromiseLike<MutesResult>;
    delete: () => MutesFilter;
  };
};

const mutesDb = supabase as unknown as MutesClient;

function resetMutes() {
  currentUserId = null;
  loadedForUserId = null;
  loadPromise = null;
  snapshot = EMPTY_SNAPSHOT;
  emit();
}

/** Loads the signed-in user's mute list once; later calls reuse the cache. */
export function ensureMutesLoaded(userId: string | null | undefined): Promise<boolean> {
  if (!userId) {
    resetMutes();
    return Promise.resolve(false);
  }
  if (loadedForUserId === userId && loadPromise) return loadPromise;

  currentUserId = userId;
  loadedForUserId = userId;
  snapshot = EMPTY_SNAPSHOT;
  emit();

  loadPromise = (async () => {
    try {
      const { data, error } = await mutesDb
        .from("notification_mutes")
        .select("target_type, target_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message ?? "Could not load notification mutes");

      const conversations = new Set<string>();
      const users = new Set<string>();
      for (const row of Array.isArray(data) ? data : []) {
        const typed = row as { target_type?: unknown; target_id?: unknown };
        if (typeof typed.target_id !== "string") continue;
        if (typed.target_type === "conversation") conversations.add(typed.target_id);
        else if (typed.target_type === "user") users.add(typed.target_id);
      }
      snapshot = { conversations, users, loaded: true };
      emit();
      return true;
    } catch (error) {
      // Never let a failed load change notification behaviour.
      console.error("[mutes] Could not load notification mutes:", error);
      snapshot = { ...EMPTY_SNAPSHOT, loaded: true };
      emit();
      return false;
    }
  })();

  return loadPromise;
}

/** Synchronous check for notification code paths (no React required). */
export function isConversationMuted(conversationId: string | null | undefined): boolean {
  return Boolean(conversationId && snapshot.conversations.has(conversationId));
}

/** Synchronous check for notification code paths (no React required). */
export function isUserMuted(userId: string | null | undefined): boolean {
  return Boolean(userId && snapshot.users.has(userId));
}

/** True when a message notification must be suppressed (chat or sender muted). */
export function isMessageNotificationMuted(
  conversationId: string | null | undefined,
  senderId: string | null | undefined,
): boolean {
  return isConversationMuted(conversationId) || isUserMuted(senderId);
}

async function setMute(
  targetType: MuteTargetType,
  targetId: string,
  muted: boolean,
): Promise<void> {
  const userId = currentUserId;
  if (!userId) throw new Error("Not signed in");
  if (!targetId) throw new Error("Missing mute target");
  if (loadedForUserId !== userId) await ensureMutesLoaded(userId);

  const before = snapshot;
  const withTarget = (set: ReadonlySet<string>) => {
    const next = new Set(set);
    if (muted) next.add(targetId);
    else next.delete(targetId);
    return next;
  };
  // Optimistic: the bell flips immediately, reverted if the write fails.
  snapshot = {
    conversations:
      targetType === "conversation" ? withTarget(before.conversations) : before.conversations,
    users: targetType === "user" ? withTarget(before.users) : before.users,
    loaded: before.loaded,
  };
  emit();

  try {
    if (muted) {
      const { error } = await mutesDb.from("notification_mutes").insert({
        user_id: userId,
        target_type: targetType,
        target_id: targetId,
      });
      // Unique violation means it was already muted; that is success here.
      if (error && !/duplicate|unique/i.test(error.message ?? "")) {
        throw new Error(error.message ?? "Could not save the mute");
      }
    } else {
      const { error } = await mutesDb
        .from("notification_mutes")
        .delete()
        .eq("user_id", userId)
        .eq("target_type", targetType)
        .eq("target_id", targetId);
      if (error) throw new Error(error.message ?? "Could not remove the mute");
    }
  } catch (error) {
    snapshot = before;
    emit();
    throw error;
  }
}

export function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  return setMute("conversation", conversationId, muted);
}

export function setUserMuted(userId: string, muted: boolean): Promise<void> {
  return setMute("user", userId, muted);
}

/** Loads the mute list for the given user (used by pages that only need side effects). */
export function useEnsureMutesLoaded(userId: string | null | undefined) {
  useEffect(() => {
    void ensureMutesLoaded(userId ?? null);
  }, [userId]);
}

/** Reactive access to the mute list for toggle UI. */
export function useNotificationMutes(userId: string | null | undefined) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureMutesLoaded(userId ?? null);
  }, [userId]);

  const setConversation = useCallback(
    (conversationId: string, muted: boolean) => setConversationMuted(conversationId, muted),
    [],
  );
  const setUser = useCallback(
    (targetUserId: string, muted: boolean) => setUserMuted(targetUserId, muted),
    [],
  );

  return {
    loaded: state.loaded,
    isConversationMuted: (conversationId: string | null | undefined) =>
      Boolean(conversationId && state.conversations.has(conversationId)),
    isUserMuted: (userIdToCheck: string | null | undefined) =>
      Boolean(userIdToCheck && state.users.has(userIdToCheck)),
    setConversationMuted: setConversation,
    setUserMuted: setUser,
  };
}

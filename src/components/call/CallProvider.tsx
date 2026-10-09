import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { CallOverlay } from "@/components/call/CallOverlay";
import { useAuth } from "@/hooks/use-auth";
import { useCall } from "@/hooks/use-call";
import { checkIsAdmin } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";

type CallState = ReturnType<typeof useCall>;

type CallContextValue = {
  /** The live call state, shared by every screen. */
  call: CallState;
  /** Tell the call which conversation "join" should default to (the open chat). */
  setContextConversation: (conversationId: string | null) => void;
};

const CallContext = createContext<CallContextValue | null>(null);

/**
 * Mounts the WebRTC call engine once, at the app root, so a call survives
 * navigation between screens (chat, admin panel, embedded Z services, …).
 * The full-screen overlay (and its minimised pill) is rendered here too, which
 * means the incoming-call ring now works on every page, not just /chat.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [me, setMe] = useState<{ id: string; name: string; avatar: string | null }>({
    id: user?.id ?? "",
    name: "You",
    avatar: null,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [contextConversation, setContextConversation] = useState<string | null>(null);
  const [title, setTitle] = useState("Call");

  // Resolve the caller identity (display name + avatar) for the call frames.
  useEffect(() => {
    if (!user?.id) {
      setMe({ id: "", name: "You", avatar: null });
      setIsAdmin(false);
      return;
    }

    let cancelled = false;
    const meta = user.user_metadata ?? {};
    const fallback = String(
      meta["display_name"] ?? meta["full_name"] ?? meta["name"] ?? user.email?.split("@")[0] ?? "You",
    );
    setMe({ id: user.id, name: fallback, avatar: null });

    void checkIsAdmin(user.id).then((value) => {
      if (!cancelled) setIsAdmin(value);
    });

    void supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as { display_name?: string | null; avatar_url?: string | null } | null;
        setMe({
          id: user.id,
          name: row?.display_name || fallback,
          avatar: row?.avatar_url ?? null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const call = useCall(contextConversation, me, { isAdmin });

  // A readable label for the overlay header / minimised pill.
  useEffect(() => {
    const id = call.conversationId;
    if (!id) return;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("name, kind")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { name?: string | null; kind?: string } | null;

      if (row?.name) {
        setTitle(row.name);
        return;
      }

      // Direct messages have no name: use the other member's display name.
      if (row?.kind === "dm" && user?.id) {
        const { data: members } = await supabase
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", id);
        const otherId = (members ?? [])
          .map((m) => (m as { user_id: string }).user_id)
          .find((uid) => uid !== user.id);
        if (otherId) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("id", otherId)
            .maybeSingle();
          if (cancelled) return;
          setTitle((profile as { display_name?: string } | null)?.display_name || "Call");
          return;
        }
      }

      setTitle("Call");
    })();

    return () => {
      cancelled = true;
    };
  }, [call.conversationId, user?.id]);

  return (
    <CallContext.Provider value={{ call, setContextConversation }}>
      {children}
      <CallOverlay call={call} conversationTitle={title} />
    </CallContext.Provider>
  );
}

export function useCallContext(): CallContextValue {
  const value = useContext(CallContext);
  if (!value) throw new Error("useCallContext must be used within a CallProvider");
  return value;
}

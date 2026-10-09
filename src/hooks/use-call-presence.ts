import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Counts how many people are currently in a conversation's call WITHOUT joining
 * it. We subscribe to the call channel's presence but never call `track()`, so
 * the participants' host election / WebRTC mesh never sees us — we are a pure
 * observer. Disable it whenever the local user is already in the call.
 */
export function useCallPresence(conversationId: string | null, enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || !conversationId) {
      setCount(0);
      return;
    }

    const channel = supabase.channel(`call:${conversationId}`, {
      config: { presence: { key: `watch-${Math.random().toString(36).slice(2)}` } },
    });

    const readCount = () => {
      try {
        setCount(Object.keys(channel.presenceState()).length);
      } catch {
        setCount(0);
      }
    };

    channel.on("presence", { event: "sync" }, readCount);
    channel.subscribe();

    return () => {
      setCount(0);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, enabled]);

  return count;
}

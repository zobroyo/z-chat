import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type CallPerson = { userId: string; name: string };

type PresenceMeta = {
  userId?: string;
  name?: string;
  key?: string;
};

function watcherKey() {
  return `watch-${Math.random().toString(36).slice(2)}`;
}

function readParticipants(channel: {
  presenceState: () => Record<string, PresenceMeta[]>;
}): CallPerson[] {
  try {
    const state = channel.presenceState();
    const seen = new Map<string, CallPerson>();
    for (const metas of Object.values(state)) {
      for (const meta of metas) {
        const id = (meta && (meta.userId || meta.key)) || "";
        if (!id || seen.has(id)) continue;
        seen.set(id, { userId: meta.userId || "", name: meta.name || "" });
      }
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}

/**
 * Who is currently in a conversation's call WITHOUT joining it. We subscribe to
 * the call channel's presence but never call `track()`, so we are a pure
 * observer and the participants' host election never sees us.
 */
export function useCallParticipants(conversationId: string | null, enabled: boolean): CallPerson[] {
  const [people, setPeople] = useState<CallPerson[]>([]);

  useEffect(() => {
    if (!enabled || !conversationId) {
      setPeople([]);
      return;
    }

    const channel = supabase.channel(`call:${conversationId}`, {
      config: { presence: { key: watcherKey() } },
    });

    const read = () => setPeople(readParticipants(channel));
    channel.on("presence", { event: "sync" }, read);
    channel.subscribe();

    return () => {
      setPeople([]);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, enabled]);

  return people;
}

/** Count only (kept for existing callers). */
export function useCallPresence(conversationId: string | null, enabled: boolean): number {
  return useCallParticipants(conversationId, enabled).length;
}

/**
 * Presence counts for many conversations at once, for the sidebar so an active
 * call is visible before you open the chat. Bounded by the visible list.
 */
export function useCallPresenceMap(conversationIds: string[], enabled: boolean): Record<string, number> {
  const signature = conversationIds.filter(Boolean).slice().sort().join(",");
  const [map, setMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled || !signature) {
      setMap({});
      return;
    }

    const ids = signature.split(",");
    const channels = ids.map((id) => {
      const channel = supabase.channel(`call:${id}`, {
        config: { presence: { key: watcherKey() } },
      });
      const read = () => {
        const count = readParticipants(channel).length;
        setMap((previous) => (previous[id] === count ? previous : { ...previous, [id]: count }));
      };
      channel.on("presence", { event: "sync" }, read);
      channel.subscribe();
      return channel;
    });

    return () => {
      setMap({});
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [signature, enabled]);

  return map;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { PhoneCall, PhoneOff } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { initialsOf } from "@/lib/chat";
import { startRingtone, type RingtoneHandle } from "@/lib/ringtone";

type RingPayload = {
  conversationId?: string;
  callerId?: string;
  callerName?: string;
  title?: string | null;
};

type IncomingRing = {
  userId: string;
  name: string;
  conversationId: string;
  conversationTitle: string | null;
};

const RING_PREFIX = "call-ring:";

/**
 * App-wide incoming-call ringer. `useCall` already rings inside `/chat`, so
 * this only activates on every OTHER page — letting a call reach someone who is
 * reading their profile, the admin panel or the services page. Accepting hands
 * off to the `/call/<id>` page, which joins as the signed-in user.
 */
export function GlobalCallRinger() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const pathname = location.pathname;
  const active =
    !!user?.id && !pathname.startsWith("/chat") && !pathname.startsWith("/call/");

  const [ring, setRing] = useState<IncomingRing | null>(null);
  const ringRef = useRef<IncomingRing | null>(null);
  const ringtoneRef = useRef<RingtoneHandle | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const stopRing = useCallback(() => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    ringRef.current = null;
    setRing(null);
  }, []);

  // Best-effort one-shot broadcast to the caller's personal ring channel.
  const replyToCaller = useCallback((userId: string, event: string, payload: Record<string, unknown>) => {
    if (!userId) return;
    try {
      const channel = supabase.channel(`${RING_PREFIX}${userId}`, {
        config: { broadcast: { self: false } },
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel
            .send({ type: "broadcast", event, payload })
            .catch(() => undefined);
          window.setTimeout(() => void supabase.removeChannel(channel), 1_500);
        }
      });
    } catch {
      // Ignore: the caller also stops ringing on its own.
    }
  }, []);

  useEffect(() => {
    if (!active || !user?.id) {
      stopRing();
      return;
    }

    const me = user.id;
    const channel = supabase.channel(`${RING_PREFIX}${me}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "ring" }, (message) => {
        const data = message["payload"] as RingPayload | null;
        if (!data?.conversationId || !data.callerId || data.callerId === me) return;
        if (ringRef.current) return; // already ringing; ignore announce retries
        const next: IncomingRing = {
          userId: data.callerId,
          name: data.callerName ?? "Someone",
          conversationId: data.conversationId,
          conversationTitle: data.title ?? null,
        };
        ringRef.current = next;
        setRing(next);
        try {
          ringtoneRef.current = startRingtone();
        } catch {
          ringtoneRef.current = null;
        }
        timeoutRef.current = window.setTimeout(stopRing, 45_000);
      })
      .on("broadcast", { event: "ring-cancel" }, (message) => {
        const data = message["payload"] as { conversationId?: string } | null;
        const current = ringRef.current;
        if (!current || current.conversationId !== data?.conversationId) return;
        stopRing();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      stopRing();
    };
  }, [active, user?.id, stopRing]);

  const accept = useCallback(() => {
    const current = ringRef.current;
    stopRing();
    if (!current) return;
    replyToCaller(current.userId, "ring-accept", {
      conversationId: current.conversationId,
      userId: userIdRef.current,
      name: "",
    });
    void navigate({
      to: "/call/$conversationId",
      params: { conversationId: current.conversationId },
    });
  }, [navigate, replyToCaller, stopRing]);

  const decline = useCallback(() => {
    const current = ringRef.current;
    stopRing();
    if (!current) return;
    replyToCaller(current.userId, "ring-decline", {
      conversationId: current.conversationId,
      userId: userIdRef.current,
      name: "",
      reason: "declined",
    });
  }, [replyToCaller, stopRing]);

  if (!ring) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-background/80 p-4 backdrop-blur-xl sm:items-center">
      <div className="call-incoming-enter w-full max-w-sm rounded-3xl border border-border bg-surface p-6 text-center shadow-2xl">
        <Avatar className="mx-auto size-20">
          <AvatarFallback className="bg-surface-2 font-display text-2xl font-semibold text-muted-foreground">
            {initialsOf(ring.name)}
          </AvatarFallback>
        </Avatar>

        <p className="mt-4 font-display text-lg font-semibold">{ring.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {ring.conversationTitle
            ? `is calling in ${ring.conversationTitle}…`
            : "is calling you…"}
        </p>

        <div className="mt-6 flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="size-14 rounded-full"
            aria-label="Decline call"
            onClick={decline}
          >
            <PhoneOff className="size-6" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="size-14 rounded-full bg-green-600 text-white hover:bg-green-500"
            aria-label="Accept call"
            onClick={accept}
          >
            <PhoneCall className="size-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}

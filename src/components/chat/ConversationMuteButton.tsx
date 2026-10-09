import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNotificationMutes } from "@/lib/mutes";
import { cn } from "@/lib/utils";

/**
 * Bell toggle in the active conversation header: mutes/unmutes notifications
 * for that conversation only. Unread badges are unaffected.
 */
export function ConversationMuteButton({
  conversationId,
  userId,
  title,
}: {
  conversationId: string;
  userId?: string | null | undefined;
  title?: string | undefined;
}) {
  const { loaded, isConversationMuted, setConversationMuted } = useNotificationMutes(userId);
  const [busy, setBusy] = useState(false);

  const label = title && title.trim() ? title : "this chat";
  const muted = isConversationMuted(conversationId);

  const toggle = async () => {
    if (busy || !conversationId) return;
    setBusy(true);
    try {
      const next = !muted;
      await setConversationMuted(conversationId, next);
      toast.success(
        next ? `Notifications muted for ${label}` : `Notifications unmuted for ${label}`,
      );
    } catch {
      toast.error("Could not update notifications for this chat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", muted ? "text-destructive" : "text-muted-foreground")}
      aria-label={muted ? `Unmute notifications for ${label}` : `Mute notifications for ${label}`}
      aria-pressed={muted}
      title={
        muted
          ? "Notifications are muted for this chat (click to unmute)"
          : "Mute notifications for this chat"
      }
      onClick={() => void toggle()}
      disabled={!conversationId || !loaded || busy}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : muted ? (
        <BellOff className="size-4" />
      ) : (
        <Bell className="size-4" />
      )}
    </Button>
  );
}

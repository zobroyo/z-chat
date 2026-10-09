import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useNotificationMutes } from "@/lib/mutes";
import { cn } from "@/lib/utils";

/**
 * "Mute notifications from this person" toggle for the profile card.
 * Hidden for your own profile. Unread badges are unaffected.
 */
export function PersonMuteToggle({
  personId,
  currentUserId,
  displayName,
}: {
  personId: string;
  currentUserId?: string | null | undefined;
  displayName?: string | undefined;
}) {
  const { loaded, isUserMuted, setUserMuted } = useNotificationMutes(currentUserId);
  const [busy, setBusy] = useState(false);

  if (!personId || personId === currentUserId) return null;

  const name = displayName && displayName.trim() ? displayName : "this person";
  const muted = isUserMuted(personId);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await setUserMuted(personId, next);
      toast.success(next ? `Notifications muted for ${name}` : `Notifications unmuted for ${name}`);
    } catch {
      toast.error(`Could not update notifications for ${name}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label
      className={cn(
        "mt-4 flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors",
        muted ? "bg-destructive/10" : "bg-surface-2 hover:bg-surface",
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        {muted ? (
          <BellOff className="size-4 shrink-0 text-destructive" />
        ) : (
          <Bell className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">
          {muted ? "Notifications muted for this person" : "Mute notifications from this person"}
        </span>
      </span>

      <Switch
        checked={muted}
        disabled={!loaded || busy}
        aria-label={muted ? `Unmute notifications from ${name}` : `Mute notifications from ${name}`}
        onCheckedChange={(next) => void toggle(next)}
      />
    </label>
  );
}

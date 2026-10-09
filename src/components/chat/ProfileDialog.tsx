import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PersonMuteToggle } from "@/components/chat/PersonMuteToggle";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type CardProfile = {
  id: string;
  display_name: string;
  username: string | null;
  bio: string;
  avatar_url: string | null;
  created_at: string;
  r6_profile: string | null;
};

/** Small profile card shown when a name/avatar is clicked in chat. */
export function ProfileDialog({
  userId,
  currentUserId,
  onClose,
}: {
  userId: string | null;
  currentUserId?: string | null;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<CardProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("id, display_name, username, bio, avatar_url, created_at, r6_profile")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setProfile((data as CardProfile | null) ?? null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Dialog
      open={Boolean(userId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>
        {loading || !profile ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col items-center pb-2 text-center">
            <UserAvatar
              name={profile.display_name}
              path={profile.avatar_url}
              className="size-20 text-2xl"
            />
            <p className="mt-3 text-lg font-bold">{profile.display_name}</p>
            <p className="text-sm text-muted-foreground">@{profile.username ?? "unknown"}</p>
            {profile.bio ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                {profile.bio}
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No bio yet.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Joined {new Date(profile.created_at).toLocaleDateString()}
            </p>
            {profile.r6_profile && profile.r6_profile.startsWith("https://") && (
              <a
                href={profile.r6_profile}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface"
              >
                R6 Tracker profile ↗
              </a>
            )}

            <PersonMuteToggle
              personId={profile.id}
              currentUserId={currentUserId}
              displayName={profile.display_name}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

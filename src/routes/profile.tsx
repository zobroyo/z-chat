import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { displayNameSchema, type Profile } from "@/lib/chat";
import { uploadAvatar } from "@/lib/media";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — ZChat" },
      {
        name: "description",
        content: "Change your display name and profile picture in ZChat.",
      },
      { property: "og:title", content: "Your profile — ZChat" },
      {
        property: "og:description",
        content: "Change your display name and profile picture in ZChat.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, last_seen")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (data) {
          setProfile(data as Profile);
          setName((data as Profile).display_name);
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  const save = async () => {
    if (!user) return;
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) return toast.error(parsed.error.issues[0]!.message);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: parsed.data })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error("Could not save your name");
    toast.success("Profile updated");
  };

  const pickPhoto = async (file: File | null) => {
    if (!file || !user) return;
    setUploading(true);
    try {
      const path = await uploadAvatar(user.id, file);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (error) throw error;
      setProfile((current) => (current ? { ...current, avatar_url: path } : current));
      toast.success("Photo updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that photo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to chats">
          <Link to="/chat">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Your profile</h1>
      </div>

      <div className="surface-panel rounded-3xl p-6 shadow-lift">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <UserAvatar
              name={profile?.display_name ?? name}
              path={profile?.avatar_url}
              className="size-24 text-2xl"
            />
            <button
              type="button"
              aria-label="Change photo"
              onClick={() => fileRef.current?.click()}
              className="absolute -right-1 -bottom-1 rounded-full bg-primary p-2 text-primary-foreground shadow-glow"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
              className="hidden"
              onChange={(event) => void pickPhoto(event.target.files?.[0] ?? null)}
            />
          </div>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>

        <div className="mt-8 space-y-2">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
          />
          <p className="text-xs text-muted-foreground">
            This is the name people see on your messages.
          </p>
        </div>

        <Button className="mt-6 w-full" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save changes
        </Button>
      </div>

      <Button variant="ghost" className="mt-6 w-full text-muted-foreground" onClick={signOut}>
        <LogOut className="mr-2 size-4" />
        Sign out
      </Button>
    </main>
  );
}

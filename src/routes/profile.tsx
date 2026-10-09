import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, Laptop, Loader2, LogOut, Moon, Sun } from "lucide-react";
import { toast } from "sonner";

import { AvatarCropDialog } from "@/components/AvatarCropDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { displayNameSchema, type Profile } from "@/lib/chat";
import { IMAGE_ACCEPT, uploadAvatar } from "@/lib/media";
import { useTheme, type ThemeAccent, type ThemeMode } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";

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
  const [username, setUsername] = useState("");
  const [initialUsername, setInitialUsername] = useState("");
  const [bio, setBio] = useState("");
  const [usernameChangedAt, setUsernameChangedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mode, accent, setMode, setAccent } = useTheme();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadError(null);
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, last_seen, username, bio, username_changed_at, r6_profile")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadError("We couldn't load your profile. Check your connection and try again.");
          return;
        }
        if (data) {
          setProfile(data as unknown as Profile);
          const row = data as unknown as {
            display_name: string;
            username: string | null;
            bio: string;
            username_changed_at: string | null;
          };
          setName(row.display_name);
          setUsername(row.username ?? "");
          setInitialUsername((row.username ?? "").toLowerCase());
          setBio(row.bio ?? "");
          setUsernameChangedAt(row.username_changed_at);
        } else {
          setLoadError("We couldn't find your profile details.");
        }
      });
    return () => {
      active = false;
    };
  }, [user, reloadKey]);

  const save = async () => {
    if (!user) return;
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    const cleanedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(cleanedUsername)) {
      toast.error("Usernames are 3-20 characters: letters, numbers, underscore");
      return;
    }
    const patch: { display_name: string; bio: string; username?: string } = {
      display_name: parsed.data,
      bio: bio.slice(0, 300),
    };
    if (cleanedUsername !== initialUsername) patch.username = cleanedUsername;
    setSaving(true);
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    setSaving(false);
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("2 weeks")) {
        toast.error("You can only change your username once every 2 weeks");
      } else if (message.includes("duplicate") || message.includes("unique")) {
        toast.error("That username is already taken");
      } else {
        toast.error("Could not save your profile");
      }
      return;
    }
    setInitialUsername(cleanedUsername);
    if (patch.username) setUsernameChangedAt(new Date().toISOString());
    toast.success("Profile updated");
  };

  const applyCroppedPhoto = async (blob: Blob) => {
    if (!user) return;
    setUploading(true);
    try {
      const file = new File([blob], "avatar.png", { type: blob.type || "image/png" });
      const path = await uploadAvatar(user.id, file);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (error) throw error;
      setProfile((current) => (current ? { ...current, avatar_url: path } : current));
      toast.success("Photo updated");
      setCropOpen(false);
      setCropFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that photo");
    } finally {
      setUploading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-md px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to chats">
          <Link to="/chat">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Your profile</h1>
      </div>

      <section className="mb-5" aria-labelledby="appearance-title">
        <div className="mb-3">
          <h2 id="appearance-title" className="font-display text-sm font-semibold">Appearance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose how ZChat looks on this device.</p>
        </div>

        <div className="surface-panel rounded-2xl p-3 shadow-lift">
          <div className="grid grid-cols-3 gap-2" aria-label="Color mode">
            {([
              { value: "system", label: "System", icon: Laptop },
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ] satisfies { value: ThemeMode; label: string; icon: typeof Laptop }[]).map((option) => {
              const Icon = option.icon;
              const selected = mode === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={selected ? "secondary" : "ghost"}
                  aria-pressed={selected}
                  onClick={() => setMode(option.value)}
                  className="h-auto min-w-0 flex-col gap-1.5 px-2 py-3"
                >
                  <Icon className="size-4" />
                  <span>{option.label}</span>
                </Button>
              );
            })}
          </div>

          <div className="my-3 h-px bg-border" />

          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-sm font-medium">Accent</span>
            <div className="flex gap-2" aria-label="Accent color">
              {([
                { value: "blue", label: "Blue" },
                { value: "teal", label: "Teal" },
                { value: "coral", label: "Coral" },
              ] satisfies { value: ThemeAccent; label: string }[]).map((option) => {
                const selected = accent === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={`${option.label} accent`}
                    aria-pressed={selected}
                    data-accent-preview={option.value}
                    onClick={() => setAccent(option.value)}
                    className={cn(
                      "accent-swatch flex size-9 items-center justify-center rounded-full border border-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                  >
                    {selected && <Check className="size-4 text-primary-foreground" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="mb-3">{loadError}</p>
          <Button size="sm" variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </div>
      )}

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
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                if (fileRef.current) fileRef.current.value = "";
                if (picked) {
                  setCropFile(picked);
                  setCropOpen(true);
                }
              }}
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

        <div className="mt-5 space-y-2">
          <Label htmlFor="profile-username">Username</Label>
          <Input
            id="profile-username"
            value={username}
            maxLength={20}
            autoComplete="off"
            onChange={(event) =>
              setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            placeholder="yourname"
          />
          <p className="text-xs text-muted-foreground">
            Your unique handle — people add you by this.{" "}
            {usernameChangedAt
              ? `Last changed ${new Date(usernameChangedAt).toLocaleDateString()}. `
              : ""}
            You can change it once every 2 weeks.
          </p>
          {(profile as unknown as { r6_profile?: string | null } | null)?.r6_profile?.startsWith("https://") && (
            <a
              href={(profile as unknown as { r6_profile: string }).r6_profile}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              R6 Tracker profile ↗
            </a>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="profile-bio">Bio</Label>
          <textarea
            id="profile-bio"
            value={bio}
            maxLength={300}
            rows={3}
            onChange={(event) => setBio(event.target.value)}
            placeholder="A little about you"
            className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{bio.length}/300</p>
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

      <AvatarCropDialog
        file={cropFile}
        open={cropOpen}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) setCropFile(null);
        }}
        onApply={applyCroppedPhoto}
        applying={uploading}
      />
    </main>
  );
}


import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

import { displayNameSchema } from "@/lib/chat";
import { getDeviceFingerprint } from "@/lib/fingerprint";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ZChat — Sign in" },
      {
        name: "description",
        content:
          "Sign in to ZChat and message friends one-to-one or in groups, with photos and instant alerts.",
      },
      { property: "og:title", content: "ZChat — Sign in" },
      {
        property: "og:description",
        content: "Message friends one-to-one or in groups, with photos and instant alerts.",
      },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("That email address doesn't look right").max(255);
const passwordSchema = z.string().min(8, "Password needs at least 8 characters").max(72);
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Usernames are 3-20 characters: letters, numbers, underscore");

function friendlyAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "Email or password is incorrect.";
  if (lower.includes("already registered")) return "Unable to create account. Please check your details and try again.";
  if (lower.includes("rate")) return "Too many attempts. Wait a moment and try again.";
  return message;
}

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  useEffect(() => {
    if (loading || !session) return;

    // Returning from the Z Games OAuth consent flow: send the user straight back there.
    const zoauthNext = new URLSearchParams(window.location.search).get("zoauth_next");
    if (zoauthNext && zoauthNext.startsWith("/") && !zoauthNext.startsWith("//")) {
      window.location.replace(zoauthNext);
      return;
    }

    void navigate({ to: "/chat" });
  }, [loading, session, navigate]);

  useEffect(() => {
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setUsernameState(username.length ? "invalid" : "idle");
      return;
    }
    setUsernameState("checking");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void supabase
        .rpc("username_available", { _username: parsed.data })
        .then(({ data, error }) => {
          if (cancelled) return;
          setUsernameState(error ? "idle" : data ? "ok" : "taken");
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username]);

  const logIn = async () => {
    const email = emailSchema.safeParse(loginEmail);
    if (!email.success) {
      toast.error(email.error.issues[0]!.message);
      return;
    }

    setBusy(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.data,
      password: loginPassword,
    });

    setBusy(false);

    if (error) toast.error(friendlyAuthError(error.message));
  };

  const signUp = async () => {
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) {
      toast.error(parsedName.error.issues[0]!.message);
      return;
    }

    const parsedUsername = usernameSchema.safeParse(username);
    if (!parsedUsername.success) {
      toast.error(parsedUsername.error.issues[0]!.message);
      return;
    }

    const email = emailSchema.safeParse(signupEmail);
    if (!email.success) {
      toast.error(email.error.issues[0]!.message);
      return;
    }

    const password = passwordSchema.safeParse(signupPassword);
    if (!password.success) {
      toast.error(password.error.issues[0]!.message);
      return;
    }

    const { data: available } = await supabase.rpc("username_available", {
      _username: parsedUsername.data,
    });
    if (available === false) {
      toast.error("That username was just taken — pick another.");
      return;
    }

    setBusy(true);

    // Device fingerprint lets handle_new_user() auto-ban new accounts created
    // from the browser of an already-banned account (no IP addresses used).
    const fingerprint = await getDeviceFingerprint();

    const { data, error } = await supabase.auth.signUp({
      email: email.data,
      password: password.data,
      options: {
        data: {
          display_name: parsedName.data,
          username: parsedUsername.data,
          ...(fingerprint ? { device_fingerprint: fingerprint } : {}),
        },
        emailRedirectTo: `${window.location.origin}/chat`,
      },
    });

    setBusy(false);

    if (error) {
      toast.error(friendlyAuthError(error.message));
      return;
    }

    if (data.session) {
      toast.success("Account created — an admin reviews new accounts next (usually 3:30–7pm weekdays).");
      return;
    }

    toast.success("Check your email to confirm your account. After that, an admin reviews it — usually 3:30–7pm weekdays.");

  };

  const withGoogle = async () => {
    setBusy(true);

    const zoauthNext = new URLSearchParams(window.location.search).get("zoauth_next");
    const redirectTo =
      zoauthNext && zoauthNext.startsWith("/") && !zoauthNext.startsWith("//")
        ? `${window.location.origin}/?zoauth_next=${encodeURIComponent(zoauthNext)}`
        : `${window.location.origin}/chat`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setBusy(false);
      toast.error("Google sign-in didn't work. Try email instead.");
    }
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom relative flex min-h-screen items-center justify-center overflow-x-hidden px-5 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary font-display text-lg font-extrabold text-primary-foreground">
            Z
          </span>

          <div>
            <h1 className="text-2xl font-bold">ZChat</h1>
            <p className="text-sm text-muted-foreground">Talk to anyone. Instantly.</p>
          </div>
        </div>

        <div className="surface-panel rounded-3xl p-6 shadow-lift">
          <Tabs defaultValue="login">
            <TabsList className="mb-5 grid w-full grid-cols-2 bg-surface-2">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <Button className="w-full" disabled={busy} onClick={logIn}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Log in
              </Button>

              <Button
                variant="link"
                className="w-full"
                onClick={() => void navigate({ to: "/recovery" })}
              >
                Forgot password?
              </Button>
            </TabsContent>

            <TabsContent value="signup" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-name">Your name</Label>
                <Input
                  id="signup-name"
                  value={name}
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Zobro"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-username">Username</Label>
                <Input
                  id="signup-username"
                  value={username}
                  maxLength={20}
                  autoComplete="off"
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="yourname"
                />
                <p
                  className={cn(
                    "text-xs",
                    usernameState === "taken" || usernameState === "invalid"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {usernameState === "checking"
                    ? "Checking availability…"
                    : usernameState === "ok"
                      ? "Username is available"
                      : usernameState === "taken"
                        ? "That username is taken"
                        : usernameState === "invalid"
                          ? "3–20 characters: letters, numbers, underscore"
                          : "Your unique handle — friends add you by this."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  placeholder="8+ characters"
                />
              </div>

              <Button className="w-full" disabled={busy} onClick={signUp}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create account
              </Button>

              <p className="text-xs leading-5 text-muted-foreground">
                New accounts are reviewed by an admin first — usually accepted{" "}
                <strong className="text-foreground">3:30pm–7pm on weekdays</strong>.
              </p>
            </TabsContent>
          </Tabs>

          <div className="my-5 flex items-center gap-3 text-[11px] tracking-widest text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="secondary" className="w-full" disabled={busy} onClick={withGoogle}>
            Continue with Google
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Your messages and photos are only visible to the people in your chats.
        </p>
      </div>
    </main>
  );
}


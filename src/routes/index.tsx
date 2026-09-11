
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

function friendlyAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "Email or password is incorrect.";
  if (lower.includes("already registered")) return "That email already has an account.";
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
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/chat" });
  }, [loading, session, navigate]);

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

    setBusy(true);

    const { error } = await supabase.auth.signUp({
      email: email.data,
      password: password.data,
      options: {
        data: { display_name: parsedName.data },
        emailRedirectTo: `${window.location.origin}/chat`,
      },
    });

    setBusy(false);

    if (error) {
      toast.error(friendlyAuthError(error.message));
      return;
    }

    toast.success("Account created. You're in!");
  };

  const withGoogle = async () => {
    setBusy(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/chat`,
      },
    });

    if (error) {
      setBusy(false);
      toast.error("Google sign-in didn't work. Try email instead.");
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
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


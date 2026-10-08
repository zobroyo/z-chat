import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import {
  clearAuthRedirectError,
  extractAuthRedirectError,
  friendlyAuthError,
  friendlyRedirectError,
} from "@/lib/auth-security";

export const Route = createFileRoute("/recovery")({
  head: () => ({ meta: [{ title: "Reset your password — ZChat" }] }),
  component: RecoveryPage,
});

const emailSchema = z.string().trim().email("Enter a valid email");
const passwordSchema = z.string().min(8, "Password needs at least 8 characters").max(72);

type Stage = "request" | "code" | "reset";

const RESEND_SECONDS = 60;

function RecoveryPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [linkInvalid, setLinkInvalid] = useState(false);

  // A recovery email may be used either way: a 6-digit code (verifyOtp) or a
  // link that returns here with recovery tokens in the URL / auth event.
  useEffect(() => {
    const redirectError = extractAuthRedirectError();
    if (redirectError) {
      toast.error(friendlyRedirectError(redirectError.code, redirectError.description));
      clearAuthRedirectError();
      if (redirectError.code.toLowerCase().includes("otp_expired")) {
        setLinkInvalid(true);
      }
    }

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("type=recovery") || new URLSearchParams(window.location.search).has("code")) {
      setStage("reset");
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStage("reset");
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const requestCode = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check what you entered.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/recovery`,
      });
      if (error) {
        toast.error(friendlyAuthError(error), { duration: 10000 });
        return;
      }
      setEmail(parsed.data);
      setCode("");
      setStage("code");
      setResendIn(RESEND_SECONDS);
      toast.success("We emailed you a reset code and link. Check your inbox (and spam).");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/recovery`,
      });
      if (error) {
        toast.error(friendlyAuthError(error), { duration: 10000 });
        return;
      }
      setResendIn(RESEND_SECONDS);
      toast.success("New code sent. Check your inbox (and spam).");
    } catch {
      toast.error("Couldn't send the email right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      toast.error("Enter the 6-digit code from the email.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "recovery",
      });
      if (error) {
        if (error.code === "otp_expired") {
          toast.error("That code has expired. Request a new one below.", { duration: 10000 });
          setResendIn(0);
        } else {
          toast.error(friendlyAuthError(error), { duration: 10000 });
        }
        setCode("");
        return;
      }
      setStage("reset");
      toast.success("Code confirmed — choose a new password.");
    } catch {
      toast.error("Couldn't verify that code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async () => {
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("The two passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data });
      if (error) {
        if (error.code === "reauthentication_needed") {
          toast.error("For security, request a fresh reset code and try again.", {
            duration: 10000,
          });
          setStage("request");
          return;
        }
        toast.error(friendlyAuthError(error), { duration: 10000 });
        return;
      }
      toast.success("Password updated. You're signed in.");
      void navigate({ to: "/chat" });
    } catch {
      toast.error("Couldn't update your password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 p-6">
      <button
        type="button"
        onClick={() => void navigate({ to: "/" })}
        className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to sign in
      </button>

      {stage === "request" && (
        <>
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Enter the email on your account. We&apos;ll send you a 6-digit code and a reset link.
          </p>
          {linkInvalid && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
              That reset link was invalid or has expired. Request a new code below.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email</Label>
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void requestCode();
              }}
              placeholder="you@example.com"
            />
          </div>
          <Button onClick={() => void requestCode()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <MailCheck className="mr-2 size-4" />
            )}
            Send reset code
          </Button>
        </>
      )}

      {stage === "code" && (
        <>
          <h1 className="text-xl font-semibold">Enter your code</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            We sent a 6-digit code to <strong className="text-foreground">{email}</strong>. It
            expires shortly, so enter it soon.
          </p>
          <div className="flex justify-center py-2">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(value) => setCode(value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoFocus
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="h-12 w-11 rounded-lg border text-base"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button onClick={() => void verifyCode()} disabled={loading || code.length !== 6}>
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Confirm code
          </Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => void navigate({ to: "/recovery" })}
              className="underline-offset-4 hover:underline"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={() => void resendCode()}
              disabled={resendIn > 0 || loading}
              className="underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            You can also tap the link in the email — it brings you back here to choose a new
            password.
          </p>
        </>
      )}

      {stage === "reset" && (
        <>
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Pick something at least 8 characters long that you haven&apos;t used here before.
          </p>
          <div className="space-y-2">
            <Label htmlFor="recovery-password">New password</Label>
            <Input
              id="recovery-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8+ characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-password-confirm">Confirm new password</Label>
            <Input
              id="recovery-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void updatePassword();
              }}
              placeholder="8+ characters"
            />
          </div>
          <Button onClick={() => void updatePassword()} disabled={loading}>
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Update password
          </Button>
          <button
            type="button"
            onClick={() => setStage("request")}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Didn&apos;t get a code? Start over
          </button>
        </>
      )}
    </main>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/recovery")({
  component: RecoveryPage,
});

const emailSchema = z.string().email("Enter a valid email");
const passwordSchema = z.string().min(8, "Password needs at least 8 characters").max(72);

function RecoveryPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<"request" | "reset">(
    typeof window !== "undefined" && window.location.hash.includes("type=recovery")
      ? "reset"
      : "request",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const sendResetEmail = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/recovery`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Check your email for a reset link.");
  };

  const updatePassword = async () => {
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated. You can sign in now.");
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">
        {stage === "request" ? "Reset your password" : "Choose a new password"}
      </h1>

      {stage === "request" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email</Label>
            <Input
              id="recovery-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button onClick={sendResetEmail} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : "Send reset link"}
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="recovery-password">New password</Label>
            <Input
              id="recovery-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button onClick={updatePassword} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : "Update password"}
          </Button>
        </>
      )}
    </div>
  );
}
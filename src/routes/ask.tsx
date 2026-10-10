import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/ask")({
  component: AskPage,
});

function AskPage() {
  const { user, loading } = useAuth();
  const [plan, setPlan] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setPlan(null);
      return;
    }
    void supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setPlan((data as { plan?: string } | null)?.plan ?? "free"));
  }, [user]);

  const allowed = plan === "pro" || plan === "max";

  const ask = async () => {
    const value = question.trim();
    if (!value || busy) return;
    setBusy(true);
    setAnswer("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { answer?: string; message?: string };
      if (response.status === 402) {
        toast.error(payload.message || "Upgrade to Pro to use this.");
        setPlan("free");
        return;
      }
      if (!response.ok || !payload.answer) throw new Error(payload.message || "The AI couldn't answer. Try again.");
      setAnswer(payload.answer);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="standalone-scroll-page ios-safe-top ios-safe-bottom mx-auto min-h-screen w-full max-w-md px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/chat">←</Link>
        </Button>
        <div>
          <h1 className="font-display text-xl font-bold">Stuck? Get the answer</h1>
          <p className="text-xs text-muted-foreground">
            Type the question — you get the full working and the answer.
          </p>
        </div>
      </div>

      {loading || !user ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : "Please sign in to use this."}
        </p>
      ) : !allowed ? (
        <div className="surface-panel rounded-3xl p-6 text-center shadow-lift">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="size-6" />
          </div>
          <h2 className="font-display text-lg font-bold">Pro &amp; Max only</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Getting the answer is included with Pro and Max. Free plans can look but not use it.
          </p>
          <Button asChild className="mt-4">
            <Link to="/profile" hash="plans">
              See plans
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="e.g. Solve 3x + 5 = 20, showing all steps"
            className="w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm"
          />
          <Button className="mt-3 w-full" disabled={busy || !question.trim()} onClick={() => void ask()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
            {busy ? "Working it out…" : "Answer it for me"}
          </Button>
          {answer && (
            <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm leading-6 whitespace-pre-wrap">
              {answer}
            </div>
          )}
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Best used when you're properly stuck — read the working so you can do the next one.
          </p>
        </>
      )}
    </main>
  );
}

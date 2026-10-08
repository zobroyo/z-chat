import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/applications")({
  component: AdminApplications,
});

type Application = {
  id: string;
  display_name: string;
  username: string | null;
  created_at: string;
  application_answers: Record<string, string>;
  application_submitted_at: string | null;
};

type Question = {
  id: string;
  label: string;
  sort_order: number;
  enabled: boolean;
};

type ReviewResult = { data: unknown; error: { message?: string } | null };
type ReviewQuery = PromiseLike<ReviewResult> & {
  select: (columns: string) => ReviewQuery;
  eq: (column: string, value: unknown) => ReviewQuery;
  order: (column: string, options?: { ascending?: boolean }) => ReviewQuery;
};
type ReviewClient = { from: (table: string) => ReviewQuery };

// application_form and the answers columns are newer than the generated types,
// so these reads use a minimal structural type (writes still go through the
// admin-gated review_application RPC).
const db = supabase as unknown as ReviewClient;

function asApplications(value: unknown): Application[] {
  if (!Array.isArray(value)) return [];
  const rows: Application[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    if (!id) continue;
    rows.push({
      id,
      display_name: typeof record["display_name"] === "string" ? record["display_name"] : "",
      username: typeof record["username"] === "string" ? record["username"] : null,
      created_at: typeof record["created_at"] === "string" ? record["created_at"] : "",
      application_answers: asAnswers(record["application_answers"]),
      application_submitted_at:
        typeof record["application_submitted_at"] === "string"
          ? record["application_submitted_at"]
          : null,
    });
  }
  return rows;
}

function asAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") answers[key] = raw;
  }
  return answers;
}

function asQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  const questions: Question[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    if (!id) continue;
    questions.push({
      id,
      label: typeof record["label"] === "string" ? record["label"] : "Question",
      sort_order: typeof record["sort_order"] === "number" ? record["sort_order"] : 0,
      enabled: record["enabled"] !== false,
    });
  }
  return questions.sort((a, b) => a.sort_order - b.sort_order);
}

function orderedAnswers(
  answers: Record<string, string>,
  questions: Question[],
): { id: string; label: string; value: string }[] {
  const ordered: { id: string; label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined) continue;
    seen.add(question.id);
    ordered.push({ id: question.id, label: question.label, value });
  }
  // Answers to questions that have since been deleted still deserve a label.
  for (const [id, value] of Object.entries(answers)) {
    if (seen.has(id)) continue;
    ordered.push({ id, label: "Removed question", value });
  }
  return ordered;
}

async function sendApprovalPush(userId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/push/approval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!response.ok) {
      console.warn("[applications] approval push request failed", response.status);
    }
  } catch (error) {
    // Push is best-effort: never let it surface as an approval failure.
    console.warn("[applications] approval push failed", error);
  }
}

function AdminApplications() {
  const [rows, setRows] = useState<Application[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [profilesResult, questionsResult] = await Promise.all([
      db
        .from("profiles")
        .select(
          "id, display_name, username, created_at, application_answers, application_submitted_at",
        )
        .eq("application_status", "pending")
        .order("created_at", { ascending: true }),
      db
        .from("application_form")
        .select("id, label, sort_order, enabled")
        .order("sort_order", { ascending: true }),
    ]);
    if (profilesResult.error) toast.error(profilesResult.error.message ?? "Could not load applications");
    setRows(asApplications(profilesResult.data));
    setQuestions(asQuestions(questionsResult.data));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    const { error } = await supabase.rpc("review_application", {
      _user_id: id,
      _approve: approve,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(approve ? "Application approved" : "Application rejected");
    setRows((current) => current.filter((row) => row.id !== id));
    if (approve) void sendApprovalPush(id);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            People waiting to join. Review hours: usually 3:30pm&ndash;7pm on weekdays.
          </p>
        </div>
        <Button variant="outline" className="h-9 px-3" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </header>

      {rows.length === 0 && !loading && (
        <p className="rounded-2xl bg-surface-2 p-6 text-sm text-muted-foreground">
          No pending applications right now.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const answers = orderedAnswers(row.application_answers, questions);
          return (
            <div
              key={row.id}
              className="rounded-2xl border border-border bg-surface p-3"
            >
              <div className="flex items-center gap-3">
                <UserAvatar name={row.display_name} className="size-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {row.display_name || "New user"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{row.username ?? "no-username"} &middot; applied{" "}
                    {new Date(row.created_at).toLocaleString()}
                    {row.application_submitted_at
                      ? ` · answered ${new Date(row.application_submitted_at).toLocaleString()}`
                      : " · no answers yet"}
                  </p>
                </div>
                <Button
                  className="h-9 px-3"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, true)}
                >
                  <Check className="mr-1 size-4" /> Approve
                </Button>
                <Button
                  variant="outline"
                  className="h-9 px-3"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, false)}
                >
                  <X className="size-4" />
                </Button>
              </div>

              {answers.length > 0 ? (
                <dl className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                  {answers.map(({ id, label, value }) => (
                    <div key={id} className="rounded-xl bg-surface-2 px-3 py-2">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  This user signed up before the application form existed, or hasn&rsquo;t submitted
                  it yet.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

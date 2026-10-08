import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, LogOut, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { requestNotificationPermission, type NotificationState } from "@/lib/notifications";
import { registerPushSubscription } from "@/lib/push";

type Props = { status: "pending" | "rejected" };

type Question = {
  id: string;
  label: string;
  placeholder: string;
  sort_order: number;
};

type GateResult = { data: unknown; error: { message?: string } | null };
type GateQuery = PromiseLike<GateResult> & {
  select: (columns: string) => GateQuery;
  eq: (column: string, value: unknown) => GateQuery;
  order: (column: string, options?: { ascending?: boolean }) => GateQuery;
  maybeSingle: () => PromiseLike<GateResult>;
};
type GateClient = {
  from: (table: string) => GateQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<GateResult>;
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
    signOut: () => Promise<unknown>;
  };
};

// The generated client is typed to known tables; this form is new, so use a
// minimal structural type for the two tables and the submit RPC.
const db = supabase as unknown as GateClient;

/** Keep answers short: one line each, 200 characters, like the review UI says. */
const MAX_ANSWER_LENGTH = 200;

function asQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  const questions: Question[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const label = typeof record["label"] === "string" ? record["label"] : "";
    if (!id || !label) continue;
    questions.push({
      id,
      label,
      placeholder: typeof record["placeholder"] === "string" ? record["placeholder"] : "",
      sort_order: typeof record["sort_order"] === "number" ? record["sort_order"] : 0,
    });
  }
  return questions.sort((a, b) => a.sort_order - b.sort_order);
}

function asAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") answers[key] = raw;
  }
  return answers;
}

/** Every enabled question needs a non-empty answer of at most 200 characters. */
function isComplete(questions: Question[], answers: Record<string, string>): boolean {
  return questions.every((question) => {
    const value = answers[question.id]?.trim() ?? "";
    return value.length > 0 && value.length <= MAX_ANSWER_LENGTH;
  });
}

/** Shown in place of the chat when a new account is waiting for admin review. */
export function ApplicationGate({ status }: Props) {
  const [loading, setLoading] = useState(status === "pending");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [notifyState, setNotifyState] = useState<NotificationState | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [alertsFailed, setAlertsFailed] = useState(false);

  useEffect(() => {
    if (status !== "pending") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const userResult = await db.auth.getUser();
        const userId = userResult.data.user?.id ?? null;
        const [questionsResult, profileResult] = await Promise.all([
          db
            .from("application_form")
            .select("id, label, placeholder, sort_order")
            .eq("enabled", true)
            .order("sort_order", { ascending: true }),
          userId
            ? db
                .from("profiles")
                .select("application_answers")
                .eq("id", userId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (cancelled) return;
        setAccountId(userId);
        const loadedQuestions = asQuestions(questionsResult.data);
        const savedAnswers = asAnswers(
          profileResult.data && typeof profileResult.data === "object"
            ? (profileResult.data as Record<string, unknown>)["application_answers"]
            : null,
        );
        setQuestions(loadedQuestions);
        setAnswers(savedAnswers);
        setSubmitted(
          loadedQuestions.length === 0 || isComplete(loadedQuestions, savedAnswers),
        );
      } catch {
        if (!cancelled) setError("Could not load the application form. Refresh to try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Approval happens while this screen is still showing, so NotificationGate
  // will not have run yet. Subscribe this device here so a pending user who
  // never opened chat can still receive the "approved" push.
  useEffect(() => {
    if (status !== "pending" || !accountId) return;
    if (typeof Notification === "undefined") {
      setNotifyState("unsupported");
      return;
    }
    const current = Notification.permission as NotificationState;
    setNotifyState(current);
    if (current === "granted") {
      // Idempotent: reuses the existing subscription or replaces a stale key.
      void registerPushSubscription(accountId).catch(() => undefined);
    }
  }, [status, accountId]);

  const enableAlerts = async () => {
    if (alertsBusy) return;
    setAlertsBusy(true);
    setAlertsFailed(false);
    try {
      const next = await requestNotificationPermission();
      setNotifyState(next);
      if (next === "granted" && accountId) {
        await registerPushSubscription(accountId);
      }
    } catch {
      // Alerts are a bonus here: never block the application form on failure.
      setAlertsFailed(true);
    } finally {
      setAlertsBusy(false);
    }
  };

  const updateAnswer = useCallback((id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  }, []);

  const submit = async () => {
    const cleaned: Record<string, string> = {};
    for (const question of questions) {
      const value = (answers[question.id] ?? "").trim();
      if (!value) {
        setError(`Please answer "${question.label}".`);
        return;
      }
      if (value.length > MAX_ANSWER_LENGTH) {
        setError(`"${question.label}" must be ${MAX_ANSWER_LENGTH} characters or fewer.`);
        return;
      }
      cleaned[question.id] = value;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await db.rpc("submit_application", { _answers: cleaned });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || "Could not submit your application. Try again.");
      return;
    }
    setAnswers(cleaned);
    setSubmitted(true);
  };

  // Permission is granted → registration runs automatically above, so only the
  // "default" (ask nicely) and "denied" (quiet hint) cases need on-screen UI.
  const alertsPrompt =
    status !== "pending" || !accountId || notifyState === null || notifyState === "unsupported"
      ? null
      : notifyState === "granted"
        ? null
        : notifyState === "denied" ? (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Alerts are off for this site, so we can&rsquo;t ping you when you&rsquo;re
              approved. Allow notifications for ZChat in your browser settings to get the
              heads-up.
            </p>
          ) : (
            <div className="mt-6">
              <Button
                type="button"
                className="w-full"
                disabled={alertsBusy}
                onClick={() => void enableAlerts()}
              >
                {alertsBusy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Bell className="mr-2 size-4" />
                )}
                Enable alerts — get told when you&rsquo;re approved
              </Button>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                We&rsquo;ll ping this device the moment an admin approves you.
              </p>
              {alertsFailed && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  Couldn&rsquo;t turn on alerts on this device. You can still check back here.
                </p>
              )}
            </div>
          );

  const signOutButton = (
    <Button
      variant="outline"
      className="mt-6 w-full"
      onClick={() => void db.auth.signOut()}
    >
      <LogOut className="mr-2 size-4" />
      Sign out
    </Button>
  );

  return (
    <main className="standalone-scroll-page relative flex min-h-screen items-center justify-center px-5 py-10">
      <section className="surface-panel w-full max-w-md rounded-3xl p-7 text-center shadow-lift sm:p-9">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="size-6" />
        </div>

        {status === "rejected" ? (
          <>
            <h1 className="text-2xl font-bold">Application not accepted</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              An admin reviewed your account and it wasn&rsquo;t accepted. If you think this is a
              mistake, reach out using the feedback link on the sign-in page.
            </p>
            {signOutButton}
          </>
        ) : loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : submitted ? (
          <>
            <h1 className="text-2xl font-bold">Application received</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A ZChat admin needs to approve your account before you can chat. Applications are
              usually reviewed{" "}
              <strong className="text-foreground">3:30pm–7pm on weekdays</strong>.
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              You&rsquo;ll get straight into chat as soon as you&rsquo;re approved — just check
              back or refresh.
            </p>
            {alertsPrompt}
            {signOutButton}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Join Z Chat</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Answer a few quick questions so an admin can approve your account.
            </p>

            <div className="mt-6 space-y-4 text-left">
              {questions.map((question) => {
                const value = answers[question.id] ?? "";
                return (
                  <div key={question.id} className="space-y-1.5">
                    <label
                      htmlFor={`application-${question.id}`}
                      className="block text-sm font-medium text-foreground"
                    >
                      {question.label}
                    </label>
                    <Input
                      id={`application-${question.id}`}
                      value={value}
                      maxLength={MAX_ANSWER_LENGTH}
                      placeholder={question.placeholder}
                      autoComplete="off"
                      disabled={busy}
                      onChange={(event) => updateAnswer(question.id, event.target.value)}
                    />
                    <p className="text-right text-[11px] text-muted-foreground">
                      {value.length}/{MAX_ANSWER_LENGTH}
                    </p>
                  </div>
                );
              })}
            </div>

            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button className="mt-6 w-full" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Submit application
            </Button>

            {alertsPrompt}
            {signOutButton}
          </>
        )}
      </section>
    </main>
  );
}
